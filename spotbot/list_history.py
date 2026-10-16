"""Stream official EC2 archives; keep only Linux shared GPU tariff references."""

import asyncio
import csv
import hashlib
import json
import logging
import re
import time
import urllib.request
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from spotbot.aws_provider import AWSProvider
from spotbot.spot_history import iso

logger = logging.getLogger(__name__)
ORIGIN = "https://pricing.us-east-1.amazonaws.com"
INDEX = ORIGIN + "/offers/v1.0/aws/AmazonEC2/index.json"


def date(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return iso(parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed)


def select_versions(index, since, until):
    versions = []
    for version, row in index["versions"].items():
        if not re.fullmatch(r"\d{14}", version):
            raise ValueError("invalid_aws_archive_version")
        begin = date(row["versionEffectiveBeginDate"])
        end = date(row["versionEffectiveEndDate"]) if row.get("versionEffectiveEndDate") else None
        if begin < until and (end is None or end > since):
            versions.append({"version": version, "begin": begin, "end": end})
    return sorted(versions, key=lambda r: r["begin"])


def fetch_index():
    with urllib.request.urlopen(INDEX, timeout=45) as response:
        body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise ValueError("aws_archive_index_too_large")
        return json.loads(body)


def parse_prices(lines, specs, region, version):
    reader = csv.reader(lines)
    metadata = dict(next(reader)[:2] for _ in range(5))
    if metadata.get("Version") != version or metadata.get("OfferCode") != "AmazonEC2":
        raise ValueError("aws_archive_metadata_mismatch")
    header = next(reader)
    fields = {
        name: header.index(name)
        for name in [
            "Instance Type",
            "TermType",
            "Operating System",
            "Tenancy",
            "Pre Installed S/W",
            "License Model",
            "CapacityStatus",
            "MarketOption",
            "Region Code",
            "Currency",
            "Unit",
            "PricePerUnit",
            "LeaseContractLength",
            "PurchaseOption",
            "OfferingClass",
            "EffectiveDate",
            "StartingRange",
            "EndingRange",
            "SKU",
            "OfferTermCode",
            "RateCode",
            "Product Family",
        ]
    }
    candidates, invalid = {}, set()
    expected = {
        "Operating System": "Linux",
        "Tenancy": "Shared",
        "Pre Installed S/W": "NA",
        "License Model": "No License required",
        "CapacityStatus": "Used",
        "MarketOption": "OnDemand",
        "Region Code": region,
        "Currency": "USD",
        "Product Family": "Compute Instance",
    }
    for row in reader:
        if len(row) != len(header):
            raise ValueError("invalid_aws_archive_row")
        sku, term = row[fields["Instance Type"]], row[fields["TermType"]]
        if sku not in specs or term not in {"OnDemand", "Reserved"}:
            continue
        if any(row[fields[k]] != v for k, v in expected.items()):
            continue
        reserved = term == "Reserved"
        if reserved and (
            row[fields["LeaseContractLength"]] != "1yr"
            or row[fields["PurchaseOption"]] != "No Upfront"
            or row[fields["OfferingClass"]] not in {"standard", "convertible"}
        ):
            continue
        price = Decimal(row[fields["PricePerUnit"]])
        if not price.is_finite() or price < 0:
            raise ValueError("invalid_aws_archive_price")
        identity = (row[fields["SKU"]], row[fields["OfferTermCode"]])
        unit = row[fields["Unit"]]
        if reserved and unit == "Quantity" and price > 0:
            invalid.add(identity)
        if (
            unit != "Hrs"
            or price <= 0
            or row[fields["StartingRange"]] != "0"
            or row[fields["EndingRange"]] not in {"Inf", "Infinity"}
        ):
            continue
        record = {
            "price_hourly": str(price),
            "effective_at": date(row[fields["EffectiveDate"]]),
            "aws_sku": identity[0],
            "rate_code": row[fields["RateCode"]],
        }
        if reserved:
            record.update(
                lease_contract_length="1yr",
                purchase_option="No Upfront",
                offering_class=row[fields["OfferingClass"]],
            )
        candidates[identity] = (sku, "reserved" if reserved else "on_demand", record)
    result = {}
    for identity, (sku, market, record) in candidates.items():
        if identity in invalid:
            continue
        previous = result.setdefault(sku, {}).get(market)
        if previous is None or Decimal(record["price_hourly"]) < Decimal(previous["price_hourly"]):
            result[sku][market] = record
    if not any("on_demand" in p for p in result.values()):
        raise ValueError("aws_archive_has_no_gpu_prices")
    return result


def fetch_prices(region, version, specs):
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d+", region) or not re.fullmatch(
        r"\d{14}", version
    ):
        raise ValueError("invalid_aws_archive_location")
    url = f"{ORIGIN}/offers/v1.0/aws/AmazonEC2/{version}/{region}/index.csv"
    started = time.monotonic()
    with urllib.request.urlopen(url, timeout=45) as response:
        if response.geturl() != url:
            raise ValueError("unexpected_aws_archive_redirect")

        def lines():
            size = 0
            for line in response:
                size += len(line)
                if size > 2 * 1024**3 or time.monotonic() - started > 900:
                    raise ValueError("aws_archive_download_limit")
                yield line.decode("utf-8-sig")

        return parse_prices(lines(), specs, region, version)


async def backfill(
    settings,
    store,
    *,
    session=None,
    clock=lambda: datetime.now(UTC),
    index_loader=fetch_index,
    price_loader=fetch_prices,
):
    import boto3
    from botocore.config import Config

    session = session or boto3.Session()
    index = await asyncio.to_thread(index_loader)
    checked = iso(clock())
    since = iso(clock() - timedelta(days=90))
    versions = select_versions(index, since, checked)
    if not versions:
        raise ValueError("aws_archive_index_has_no_history")
    results = {"completed": 0, "cached": 0, "failed": 0}
    for region in dict.fromkeys(settings.spotbot_aws_regions.split(",")):
        region = region.strip()
        if not region:
            continue
        client = session.client(
            "ec2",
            region_name=region,
            config=Config(
                connect_timeout=10, read_timeout=30, retries={"mode": "standard", "max_attempts": 3}
            ),
        )
        try:
            _, specs = await asyncio.to_thread(AWSProvider._instance_types, client)
        finally:
            client.close()
        spec_hash = hashlib.sha256(json.dumps(sorted(specs)).encode()).hexdigest()
        await asyncio.to_thread(
            store.save,
            region,
            "STATUS",
            {"versions": versions, "since": since, "checked_at": checked, "spec_hash": spec_hash},
        )
        for metadata in versions:
            version = metadata["version"]
            try:
                cached = await asyncio.to_thread(store.get, region, version)
                if cached and cached["spec_hash"] == spec_hash:
                    results["cached"] += 1
                    continue
                prices = await asyncio.to_thread(price_loader, region, version, specs)
                document = {
                    "spec_hash": spec_hash,
                    "prices": prices,
                    "retrieved_at": iso(clock()),
                    "source": f"{ORIGIN}/offers/v1.0/aws/AmazonEC2/{version}/{region}/index.csv",
                }
                await asyncio.to_thread(store.save, region, version, document)
                results["completed"] += 1
                logger.info(
                    "AWS list archive saved: region=%s version=%s types=%d",
                    region,
                    version,
                    len(prices),
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                results["failed"] += 1
                logger.warning(
                    "AWS list archive failed: region=%s version=%s error_type=%s",
                    region,
                    version,
                    type(exc).__name__,
                )
    return results
