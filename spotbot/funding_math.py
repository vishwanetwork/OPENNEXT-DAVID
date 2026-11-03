"""Exact effective-price math and server-owned funding views."""

import math
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal

from spotbot.rentals import at


def ceil_cents(value):
    return int(Decimal(value).to_integral_value(rounding=ROUND_CEILING))


def seconds(start, end):
    delta = at(end) - at(start)
    return Decimal(delta.days * 86400 + delta.seconds) + Decimal(delta.microseconds) / 1_000_000


def retail_cents(source_hourly, markup_bps, storage_hourly_cents=0):
    source = Decimal(str(source_hourly))
    if not source.is_finite() or source <= 0 or not 0 <= markup_bps <= 10000:
        raise ValueError("invalid_effective_price")
    return ceil_cents(source * (10000 + markup_bps) / 100) + storage_hourly_cents


def position(cycle, baseline, remaining, next_hour, projected):
    remaining = max(0, remaining)
    warnings = []
    if baseline and remaining * 5 <= baseline:
        warnings.append("remaining_20_percent")
    if projected is not None and projected > remaining:
        warnings.append("projected_shortfall")
    if next_hour is not None and next_hour > remaining:
        warnings.append("next_hour_unfunded")
    return dict(
        cycleId=cycle, baselineCents=baseline, remainingCents=remaining,
        remainingPercent=round(remaining * 100 / baseline, 4) if baseline else None,
        nextHourRequiredCents=next_hour, projectedRemainingCents=projected,
        status="unavailable" if next_hour is None else "insufficient"
        if "next_hour_unfunded" in warnings else "low"
        if warnings else "healthy",
        warnings=warnings,
    )


def required(order, rate, duration):
    """Incremental cost, rounding the order's cumulative amount only once."""
    if rate is None:
        return None
    raw = Decimal(order.get("raw_compute_cents", "0"))
    return max(0, ceil_cents(raw + Decimal(rate) * Decimal(str(duration)) / 3600)
               - order.get("nominal_compute_cents", 0))


def order_view(order):
    remaining = max(0, order["purchased_seconds"] - order.get("used_seconds", 0))
    rate = order.get("current_hourly_cents")
    funds = order["funded_cents"] - order["compute_cents"]
    next_hour = required(order, rate, min(3600, remaining))
    projected = required(order, rate, remaining)
    return dict(
        orderId=order["id"], instanceId=order.get("rental_id"), model=order["model"],
        paymentMethod=order["payment_method"], initialPaymentCents=order["initial_payment_cents"],
        initialHourlyCents=order["initial_hourly_cents"], currentHourlyCents=rate,
        purchasedSeconds=order["purchased_seconds"], remainingSeconds=remaining,
        runtimeState=order["runtime_state"], retention=order.get("retention", "pending"),
        storageReserveCents=order["storage_funded_cents"] - order["storage_cents"],
        retentionExpiresAt=order.get("retention_expires_at"),
        maxHourlyCents=order["agreement"]["max_hourly_cents"],
        maxTotalCents=order["agreement"]["max_total_cents"],
        totalFundedCents=order["funded_cents"] + order["storage_funded_cents"],
        storageReserveTargetCents=order["agreement"]["storage_reserve_cents"],
        pauseReason=order.get("pause_reason"),
        funding=position(order["cycle_id"], order["cycle_baseline_cents"], funds,
                         next_hour, projected),
    )


def split_intervals(rental, prices, since, until):
    """Clip verified service to effective rates and UTC clock hours; reject price gaps."""
    rates = sorted(prices, key=lambda p: at(p["effective_at"]))
    for span in rental.get("service_intervals") or []:
        begin = max(at(span["start"]), at(since) if since else at(span["start"]))
        end = min(at(span["end"]) if span.get("end") else at(until), at(until))
        while begin < end:
            eligible = [p for p in rates if at(p["effective_at"]) <= begin
                        and (not p.get("valid_until") or at(p["valid_until"]) > begin)]
            if not eligible:
                raise ValueError("effective_price_coverage_unavailable")
            rate = eligible[-1]
            next_changes = [at(p["effective_at"]) for p in rates if at(p["effective_at"]) > begin]
            hour = begin.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            boundary = min(end, hour, *(next_changes[:1] or [end]),
                           at(rate["valid_until"]) if rate.get("valid_until") else end)
            if boundary <= begin:
                raise ValueError("effective_price_coverage_unavailable")
            yield dict(started_at=begin.isoformat(), ended_at=boundary.isoformat(), **rate)
            begin = boundary


def final_adjustment(order):
    used = Decimal(str(order.get("used_seconds", 0)))
    if not used:
        return 0
    rate = order.get("last_hourly_cents") or order["initial_hourly_cents"]
    padding = Decimal(math.ceil(used / 60) * 60) - used
    target = max(order.get("minimum_hourly_cents", rate), ceil_cents(
        Decimal(order["raw_compute_cents"]) + padding * rate / 3600))
    return max(0, target - order["nominal_compute_cents"])


def envelope(user_id, now=None):
    return dict(confirmed=True, pricingVersion="spot-hourly-v1", accountId=user_id,
                demo=False, observedAt=(now or datetime.now(UTC)).isoformat(), currency="USD")
