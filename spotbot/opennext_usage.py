"""One Spot instance's usage timeline and billing ledger (the Terminal's usage port).

The snapshot follows OPENNEXT-DAVID `src/lib/instance-usage.ts`: connected and interrupted
intervals, lifecycle events, and hourly billing entries whose cents add up exactly to what
the order is charged (usage per started minute with a one-hour minimum and any frozen historical fee,
never above the purchase hold). GPU utilization is not measured yet, so it is null.
"""

import math
from datetime import timedelta

from spotbot.models import utcnow
from spotbot.opennext_ledger import billing_view
from spotbot.opennext_market import purchased
from spotbot.rentals import at

HOUR = timedelta(hours=1)


def allocate(total, weights):
    """Split `total` cents over `weights` in proportion, largest remainders first."""
    whole = sum(weights)
    if not whole:
        return [0] * len(weights)
    shares = [total * w / whole for w in weights]
    result = [math.floor(s) for s in shares]
    order = sorted(range(len(weights)), key=lambda i: shares[i] - result[i], reverse=True)
    for i in order[: total - sum(result)]:
        result[i] += 1
    return result


def periods(rental, now):
    """Service periods as datetimes, the open one ending now; zero-length ones are dropped."""
    result = []
    for p in rental.get("service_intervals") or []:
        start, end = at(p["start"]), at(p["end"]) if p["end"] else now
        if end > start:
            result.append((start, min(end, now), p))
    if not result and rental.get("delivering_at"):
        # Delivered before service periods were recorded: one period from the handoff.
        start = at(rental["delivering_at"])
        end = at(rental["closed_at"]) if rental.get("closed_at") else now
        if end > start:
            result.append((start, end, {"end_reason": "ended"}))
    return result


def billing_entries(spans, total_cents, base_cents, now):
    """Hourly entries from the billing start; each covers at most one hour of the timeline."""
    if not spans:
        return []
    start, stop = spans[0][0], max(end for _, end, _ in spans)
    buckets = []
    while start < stop:
        end = min(start + HOUR, stop, now)
        seconds = sum(max(0.0, (min(end, b) - max(start, a)).total_seconds()) for a, b, _ in spans)
        if seconds > 0:
            buckets.append((start, end, seconds))
        start += HOUR
    weights = [b[2] for b in buckets]
    base = min(base_cents, total_cents)
    computes = allocate(base, weights)
    fees = allocate(total_cents - base, weights)
    return [
        dict(
            id=f"hour-{n + 1}",
            startedAt=a.isoformat(),
            endedAt=b.isoformat(),
            billableSeconds=round(seconds, 3),
            computeCents=computes[n],
            feeCents=fees[n],
            totalCents=computes[n] + fees[n],
        )
        for n, (a, b, seconds) in enumerate(buckets)
    ]


def usage_snapshot(user_id, rental, charge, now=None):
    now = now or utcnow()
    spans = periods(rental, now)
    ended = rental["state"] in {"ENDING", "CLOSED"} or rental.get("end_requested")
    window_start = spans[0][0] if spans else at(rental["created_at"])
    window_end = now
    if ended and spans:
        window_end = min(
            now, max(spans[-1][1], at(rental.get("closed_at") or spans[-1][1].isoformat()))
        )
    if window_end <= window_start:
        window_end = min(now, window_start + timedelta(seconds=1))
    intervals, events = [], []
    for n, (start, end, raw) in enumerate(spans):
        intervals.append(
            dict(
                startedAt=start.isoformat(),
                endedAt=end.isoformat(),
                state="connected",
                utilizationPercent=None,
            )
        )
        events.append(
            dict(
                id=f"event-{len(events) + 1}",
                at=start.isoformat(),
                type="started" if n == 0 else "reconnected",
                initiatedBy="platform",
                description="Your server was ready."
                if n == 0
                else "A replacement server was ready with your restored disk.",
            )
        )
        last = n == len(spans) - 1
        closed_period = raw.get("end") is not None or (last and ended)
        if not closed_period:
            continue
        gap_end = spans[n + 1][0] if not last else window_end
        if raw.get("end_reason") == "ended" or (raw.get("end_reason") is None and last and ended):
            expiry = at(rental["rfq"]["expires_at"])
            by_user = end < expiry - timedelta(minutes=1)
            events.append(
                dict(
                    id=f"event-{len(events) + 1}",
                    at=end.isoformat(),
                    type="ended",
                    initiatedBy="user" if by_user else "platform",
                    description="You ended the instance."
                    if by_user
                    else "The purchased time ended.",
                )
            )
            continue
        events.append(
            dict(
                id=f"event-{len(events) + 1}",
                at=end.isoformat(),
                type="interrupted",
                initiatedBy="provider",
                description="The cloud provider reclaimed the Spot capacity. Billing paused.",
            )
        )
        if gap_end > end:
            intervals.append(
                dict(
                    startedAt=end.isoformat(),
                    endedAt=min(gap_end, window_end).isoformat(),
                    state="interrupted",
                    utilizationPercent=None,
                )
            )
    intervals = [i for i in intervals if at(i["endedAt"]) > at(i["startedAt"])]
    events = [e for e in events if window_start <= at(e["at"]) <= window_end]
    billing = None
    if charge and charge.get("hourly_cents"):
        view = billing_view(charge, rental, now)
        seconds = view["usedSeconds"]
        minutes = max(60, math.ceil(seconds / 60)) if seconds else 0
        base = math.ceil(charge["hourly_cents"] * minutes / 60)
        serving = rental["state"] == "ACTIVE" and not rental.get("end_requested")
        billing = dict(
            currency="USD",
            startedAt=spans[0][0].isoformat() if spans else None,
            stoppedAt=None if serving or not spans else spans[-1][1].isoformat(),
            totalCents=view["chargedCents"],
            complete=view["final"],
            entries=billing_entries(spans, view["chargedCents"], base, now),
        )
    return dict(
        confirmed=True,
        accountId=user_id,
        instanceId=rental["id"],
        demo=False,
        observedAt=now.isoformat(),
        windowStart=window_start.isoformat(),
        windowEnd=window_end.isoformat(),
        purchasedHours=purchased(rental)["hours"],
        # Every rental disk is backed up and restored onto replacements by the bot.
        retainedDataConfirmed=bool(rental.get("current_backup_id")),
        intervals=intervals,
        events=events,
        billing=billing,
    )
