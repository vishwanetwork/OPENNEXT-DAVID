"""Read-only AWS Spot backfill. This module never creates capacity or submits orders."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from spotbot.aws_provider import AWSProvider

logger = logging.getLogger(__name__)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def fetch_events(client, sku, since, until):
    events = {}
    for page in client.get_paginator("describe_spot_price_history").paginate(
        InstanceTypes=[sku],
        ProductDescriptions=["Linux/UNIX"],
        StartTime=since,
        EndTime=until,
    ):
        for row in page["SpotPriceHistory"]:
            if (
                row["InstanceType"] != sku
                or row.get("ProductDescription", "Linux/UNIX") != "Linux/UNIX"
            ):
                continue
            at, zone = row["Timestamp"], row["AvailabilityZone"]
            price = Decimal(row["SpotPrice"])
            if at > until or not price.is_finite() or price <= 0:
                continue
            events[(iso(at), zone)] = {
                "effective_at": iso(at),
                "availability_zone": zone,
                "price_hourly": str(price),
            }
    return sorted(events.values(), key=lambda e: (e["effective_at"], e["availability_zone"]))


async def backfill(settings, store, *, session=None, clock=lambda: datetime.now(UTC)):
    import boto3
    from botocore.config import Config

    session = session or boto3.Session()
    config = Config(
        connect_timeout=10, read_timeout=30, retries={"mode": "standard", "max_attempts": 3}
    )
    results = {"completed": 0, "failed": 0, "events_received": 0}
    for region in dict.fromkeys(settings.spotbot_aws_regions.split(",")):
        region = region.strip()
        if not region:
            continue
        client = session.client("ec2", region_name=region, config=config)
        try:
            _, specs = await asyncio.to_thread(AWSProvider._instance_types, client)
            for sku in sorted(specs):
                try:
                    until = clock()
                    since = until - timedelta(days=90) + timedelta(minutes=1)
                    previous = await asyncio.to_thread(store.coverage, region, sku)
                    # A small overlap makes the daily refresh safe across endpoint boundaries.
                    if previous and previous["since"] <= iso(since):
                        since = max(
                            since, datetime.fromisoformat(previous["until"]) - timedelta(hours=1)
                        )
                    events = await asyncio.to_thread(fetch_events, client, sku, since, until)
                    coverage = {
                        "since": min(previous["since"], iso(since)) if previous else iso(since),
                        "until": iso(until),
                        "retrieved_at": iso(clock()),
                        "source": "aws_describe_spot_price_history",
                        "unit": "USD / instance-hour",
                    }
                    await asyncio.to_thread(store.save, region, sku, events, coverage)
                    results["completed"] += 1
                    results["events_received"] += len(events)
                    logger.info(
                        "AWS Spot history saved: region=%s sku=%s events=%d",
                        region,
                        sku,
                        len(events),
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    results["failed"] += 1
                    logger.warning(
                        "AWS Spot history failed: region=%s sku=%s error_type=%s",
                        region,
                        sku,
                        type(exc).__name__,
                    )
        finally:
            client.close()
    return results
