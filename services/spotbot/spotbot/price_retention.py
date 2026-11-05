"""Tiered retention for price collection snapshots.

Every collection cycle stores a full snapshot of every offer (thousands of rows every five
minutes), so the `prices` table grows by hundreds of megabytes a day. Current prices only need
each provider's newest successful collection; AWS Spot and list price history live in their own
change tables. Older snapshots are thinned instead of kept at full resolution:

- younger than `raw_days`: every collection
- up to `hourly_days`: the earliest successful collection per provider and hour
- up to `daily_days`: the earliest successful collection per provider and day
- older: removed

Each provider's newest successful collection is never removed, whatever its age.
"""

from datetime import datetime, timedelta


def plan(collections, now, *, raw_days, hourly_days, daily_days):
    """Collection ids to remove. `collections` holds `(id, provider, observed_at, status)`."""
    newest = {}
    for cid, provider, _, status in collections:
        if status == "ok" and cid > newest.get(provider, -1):
            newest[provider] = cid
    raw, hourly, daily = (now - timedelta(days=d) for d in (raw_days, hourly_days, daily_days))
    kept, remove = set(), []
    for cid, provider, observed_at, status in sorted(collections):
        if cid == newest.get(provider):
            continue
        at = datetime.fromisoformat(observed_at)
        if at >= raw:
            continue
        if at < daily:
            remove.append(cid)
            continue
        bucket = (provider, observed_at[:13] if at >= hourly else observed_at[:10])
        if status == "ok" and bucket not in kept:
            kept.add(bucket)
        else:
            remove.append(cid)
    return remove
