import csv
import io
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from spotbot.api import create_app
from spotbot.list_history import backfill, parse_prices, select_versions
from spotbot.service import Service
from spotbot.spot_history import iso
from tests.test_spot_history import Client, Session

VERSION = "20260925174521"
FIELDS = [
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


def row(**changes):
    return {
        "Instance Type": "g5.xlarge",
        "TermType": "OnDemand",
        "Operating System": "Linux",
        "Tenancy": "Shared",
        "Pre Installed S/W": "NA",
        "License Model": "No License required",
        "CapacityStatus": "Used",
        "MarketOption": "OnDemand",
        "Region Code": "us-west-2",
        "Currency": "USD",
        "Unit": "Hrs",
        "PricePerUnit": "1.006",
        "LeaseContractLength": "",
        "PurchaseOption": "",
        "OfferingClass": "",
        "EffectiveDate": "2026-09-01",
        "StartingRange": "0",
        "EndingRange": "Inf",
        "SKU": "aws-product",
        "OfferTermCode": "ondemand",
        "RateCode": "rate",
        "Product Family": "Compute Instance",
        **changes,
    }


def reserved(**changes):
    return row(
        **{
            "TermType": "Reserved",
            "OfferTermCode": "reserved",
            "PricePerUnit": ".63378",
            "LeaseContractLength": "1yr",
            "PurchaseOption": "No Upfront",
            "OfferingClass": "standard",
            "EffectiveDate": "2026-09-25",
            **changes,
        }
    )


def csv_data(rows, version=VERSION):
    file = io.StringIO()
    writer = csv.writer(file)
    for pair in [
        ("FormatVersion", "v1.0"),
        ("Disclaimer", "fixture"),
        ("Publication Date", "2026-09-25"),
        ("Version", version),
        ("OfferCode", "AmazonEC2"),
    ]:
        writer.writerow(pair)
    writer.writerow(FIELDS)
    for r in rows:
        writer.writerow([r.get(field, "") for field in FIELDS])
    return file.getvalue().splitlines(keepends=True)


def test_archive_filters_and_exact_effective_dates():
    rows = [
        row(),
        reserved(),
        reserved(
            **{"OfferTermCode": "convertible", "OfferingClass": "convertible", "PricePerUnit": ".7"}
        ),
    ]
    rows += [
        row(**change)
        for change in [
            {"Operating System": "Windows"},
            {"Tenancy": "Dedicated"},
            {"Region Code": "us-east-1"},
            {"MarketOption": "CapacityBlock"},
            {"Pre Installed S/W": "SQL Std"},
            {"Currency": "EUR"},
            {"Instance Type": "c5.xlarge"},
        ]
    ]
    rows += [
        reserved(**{"PurchaseOption": "All Upfront", "PricePerUnit": ".1"}),
        reserved(**{"LeaseContractLength": "3yr", "PricePerUnit": ".1"}),
    ]
    prices = parse_prices(csv_data(rows), {"g5.xlarge": {}}, "us-west-2", VERSION)
    assert prices["g5.xlarge"]["on_demand"]["price_hourly"] == "1.006"
    assert prices["g5.xlarge"]["reserved"]["price_hourly"] == "0.63378"
    assert prices["g5.xlarge"]["reserved"]["effective_at"] == "2026-09-25T00:00:00.000000+00:00"
    assert prices["g5.xlarge"]["reserved"]["offering_class"] == "standard"
    invalid = parse_prices(
        csv_data([row(), reserved(), reserved(**{"Unit": "Quantity", "PricePerUnit": "10"})]),
        {"g5.xlarge": {}},
        "us-west-2",
        VERSION,
    )
    assert "reserved" not in invalid["g5.xlarge"]
    with pytest.raises(ValueError, match="metadata_mismatch"):
        parse_prices(
            csv_data([row()], version="20260101000000"), {"g5.xlarge": {}}, "us-west-2", VERSION
        )


@pytest.mark.asyncio
async def test_backfill_caches_committed_versions_and_retries_failed_versions(settings):
    service = Service(settings)
    calls = []
    version2 = "20261015191316"
    index = {
        "versions": {
            VERSION: {
                "versionEffectiveBeginDate": "2026-09-01T00:00:00Z",
                "versionEffectiveEndDate": "2026-10-01T00:00:00Z",
            },
            version2: {
                "versionEffectiveBeginDate": "2026-10-01T00:00:00Z",
                "versionEffectiveEndDate": "",
            },
        }
    }
    end = datetime(2026, 10, 17, tzinfo=UTC)

    def load(region, version, specs):
        calls.append(version)
        if version == version2 and len(calls) == 2:
            raise ValueError("fixture incomplete download")
        return parse_prices(csv_data([row(), reserved()], version=version), specs, region, version)

    try:
        first = await backfill(
            settings,
            service.list_history,
            session=Session(Client()),
            clock=lambda: end,
            index_loader=lambda: index,
            price_loader=load,
        )
        assert first["completed"] == 1 and first["failed"] == 1
        partial = service.list_history.query(
            "us-west-2", "g5.xlarge", iso(end - timedelta(days=90)), iso(end)
        )
        assert partial["pending"] and partial["missing_versions"] == [version2]
        second = await backfill(
            settings,
            service.list_history,
            session=Session(Client()),
            clock=lambda: end,
            index_loader=lambda: index,
            price_loader=load,
        )
        assert second == {"completed": 1, "cached": 1, "failed": 0}
        assert calls == [VERSION, version2, version2]
        assert service.store.latest(provider="aws") == []
        assert service.store.history(provider="aws")[0] == 0
    finally:
        await service.close()


def test_archive_api_preserves_missing_ranges_and_requires_auth(settings):
    service = Service(settings)
    version = {
        "version": VERSION,
        "begin": "2026-09-01T00:00:00.000000+00:00",
        "end": "2026-10-01T00:00:00.000000+00:00",
    }
    service.list_history.save(
        "us-west-2",
        "STATUS",
        {
            "versions": [version],
            "spec_hash": "hash",
            "since": version["begin"],
            "checked_at": "2026-10-17T00:00:00.000000+00:00",
        },
    )
    service.list_history.save(
        "us-west-2",
        VERSION,
        {
            "spec_hash": "hash",
            "prices": parse_prices(
                csv_data([row(), reserved()]), {"g5.xlarge": {}}, "us-west-2", VERSION
            ),
        },
    )
    with TestClient(create_app(settings, service)) as client:
        url = "/v1/prices/aws-list-history"
        params = {
            "region": "us-west-2",
            "sku": "g5.xlarge",
            "since": "2026-09-01T00:00:00Z",
            "until": "2026-10-17T00:00:00Z",
        }
        assert client.get(url, params=params).status_code == 401
        auth = {"Authorization": "Bearer test-token"}
        data = client.get(url, params=params, headers=auth).json()
        assert data["kind"] == "published_price_intervals"
        assert data["total"] == 2
        reserve = next(r for r in data["items"] if r["market"] == "reserved")
        assert reserve["valid_from"] == "2026-09-25T00:00:00.000000+00:00"
        assert reserve["valid_until"] == "2026-10-01T00:00:00.000000+00:00"
        assert (
            client.get(
                url, params=dict(params, since="2026-01-01T00:00:00Z"), headers=auth
            ).status_code
            == 400
        )


def test_version_boundaries_include_left_predecessor_and_exclude_future():
    index = {
        "versions": {
            "20260601000000": {
                "versionEffectiveBeginDate": "2026-06-01T00:00:00Z",
                "versionEffectiveEndDate": "2026-07-01T00:00:00Z",
            },
            VERSION: {
                "versionEffectiveBeginDate": "2026-07-01T00:00:00Z",
                "versionEffectiveEndDate": "2026-10-01T00:00:00Z",
            },
            "20261101000000": {
                "versionEffectiveBeginDate": "2026-11-01T00:00:00Z",
                "versionEffectiveEndDate": "",
            },
        }
    }
    assert [
        r["version"]
        for r in select_versions(
            index, "2026-07-18T00:00:00.000000+00:00", "2026-10-17T00:00:00.000000+00:00"
        )
    ] == [VERSION]
