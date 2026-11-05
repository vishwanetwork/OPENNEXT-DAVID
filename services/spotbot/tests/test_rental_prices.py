"""Allocation pricing coverage, private account routing, and retention evidence."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from spotbot.models import utcnow
from spotbot.providers import ProviderError
from spotbot.rental_prices import evidence


def engine():
    now = utcnow()
    row = dict(id="rental", state="ACTIVE", rfq=dict(funding={}),
               created_at=(now-timedelta(hours=2)).isoformat(), updated_at=now.isoformat())
    row["rfq"]["funding"] = dict(pricing_version="spot-hourly-v1")
    gen = dict(id="gen", instance_id="i-1", state="RUNNING", generation=1,
               created_at=(now-timedelta(hours=2)).isoformat(),
               verified_at=(now-timedelta(hours=1)).isoformat(), region="us-west-2",
               offer=dict(sku="p5.test", availability_zone="us-west-2b"))
    backend = SimpleNamespace(call=AsyncMock())
    value = SimpleNamespace(get=lambda rid, tenant: row, generations=lambda r: [gen],
                            backups=lambda r: [], backend=backend,
                            settings=SimpleNamespace(spotbot_aws_account_name="b300"))
    return value, now, row, gen


def price(now, hour, amount, **extra):
    return dict(Timestamp=now+timedelta(hours=hour), SpotPrice=amount,
                AvailabilityZone="us-west-2b", InstanceType="p5.test",
                ProductDescription="Linux/UNIX", **extra)


async def test_exact_zone_account_and_price_before_start_survive_pagination(monkeypatch):
    value, now, row, gen = engine()
    monkeypatch.setattr("spotbot.rental_prices.public", lambda r: r)
    value.backend.call.side_effect = [
        dict(SpotPriceHistory=[price(now, -.5, "4.00")], NextToken="next"),
        dict(SpotPriceHistory=[price(now, -2, "3.00")]),
    ]
    result = await evidence(value, "rental", "tenant")
    assert [p["source_hourly"] for p in result["prices"]] == ["3.00", "4.00"]
    assert result["prices"][0]["effective_at"] == gen["verified_at"]
    assert result["prices"][0]["source_effective_at"] == (now-timedelta(hours=2)).isoformat()
    assert result["prices"][0]["aws_account"] == "b300"
    assert value.backend.call.call_args.kwargs["AvailabilityZone"] == "us-west-2b"
    assert value.backend.call.call_args.kwargs["NextToken"] == "next"


async def test_missing_coverage_or_wrong_zone_never_fabricates_a_price(monkeypatch):
    value, now, _, _ = engine()
    value.backend.call.return_value = dict(SpotPriceHistory=[price(now, -.5, "4.00")])
    with pytest.raises(ProviderError, match="coverage"):
        await evidence(value, "rental", "tenant")
    wrong = price(now, -2, "3.00")
    wrong["AvailabilityZone"] = "us-west-2a"
    value.backend.call.return_value = dict(SpotPriceHistory=[wrong])
    with pytest.raises(ProviderError, match="invalid_allocation"):
        await evidence(value, "rental", "tenant")
