"""Private allocation-specific AWS price evidence; never a marketplace minimum."""

from datetime import timedelta
from decimal import Decimal

from spotbot.models import utcnow
from spotbot.providers import ProviderError
from spotbot.rental_tasks import public
from spotbot.rentals import at


async def evidence(engine, rental_id, tenant, since=None):
    row = engine.get(rental_id, tenant)
    if not row["rfq"].get("funding"):
        raise ValueError("floating_agreement_required")
    observed = min(utcnow(), at(row["updated_at"]))
    start = since or at(row["created_at"])
    if start < observed-timedelta(days=89) or start > utcnow()+timedelta(seconds=5):
        raise ValueError("invalid_effective_price_window")
    result = []
    for gen in engine.generations(row):
        if not gen.get("instance_id") or gen["state"] == "REJECTED":
            continue
        lower = max(start, at(gen.get("verified_at") or gen["created_at"]))
        upper = min(observed, at(gen["ended_at"]) if gen.get("ended_at") else observed)
        if upper <= lower:
            continue
        offer = gen["offer"]
        query = dict(
            AvailabilityZone=offer["availability_zone"], InstanceTypes=[offer["sku"]],
            ProductDescriptions=["Linux/UNIX"], StartTime=lower, EndTime=upper, MaxResults=1000,
        )
        prices = []
        for _ in range(100):
            page = await engine.backend.call(gen["region"], "describe_spot_price_history", **query)
            for price in page.get("SpotPriceHistory", []):
                value = Decimal(price["SpotPrice"])
                if (price["AvailabilityZone"] != offer["availability_zone"]
                        or price["InstanceType"] != offer["sku"]
                        or price.get("ProductDescription") != "Linux/UNIX"
                        or not value.is_finite() or value <= 0):
                    raise ProviderError("invalid_allocation_price_evidence")
                prices.append(price)
            token = page.get("NextToken")
            if not token:
                break
            query["NextToken"] = token
        else:
            raise ProviderError("effective_price_evidence_page_limit")
        prices.sort(key=lambda p: p["Timestamp"])
        if not prices or prices[0]["Timestamp"] > lower:
            raise ProviderError("effective_price_coverage_unavailable")
        for index, price in enumerate(prices):
            next_time = prices[index+1]["Timestamp"] if index+1 < len(prices) else upper
            begin = max(lower, price["Timestamp"])
            end = min(upper, next_time)
            if end > begin:
                result.append(dict(
                    generation=gen["generation"], effective_at=begin.isoformat(),
                    valid_until=end.isoformat(), source_effective_at=price["Timestamp"].isoformat(),
                    source_hourly=price["SpotPrice"], region=gen["region"],
                    availability_zone=offer["availability_zone"], sku=offer["sku"],
                    aws_account=engine.settings.spotbot_aws_account_name,
                ))
    backups = engine.backups(row)
    generations = engine.generations(row)
    available = any(b["state"] == "AVAILABLE" and (
        b["id"] == row.get("current_backup_id") or row["state"] == "CLOSED" and b.get("final")
    ) for b in backups)
    deadline = row.get("funding_retention_until")
    if not deadline and row.get("closed_at"):
        deadline = (at(row["closed_at"]) + timedelta(
            seconds=row["rfq"]["backup"]["final_retention_seconds"])).isoformat()
    cleaned = row["state"] == "CLOSED" and all(b["state"] == "DELETED" for b in backups) and all(
        all(v["volume_id"] in g.get("deleted_volumes", []) for v in g.get("volumes", []))
        for g in generations
    )
    return dict(rental=public(row), observed_at=observed.isoformat(), prices=result,
                retention_observed_at=utcnow().isoformat(), retention_verified=available,
                retention_until=deadline, storage_cleaned=cleaned)
