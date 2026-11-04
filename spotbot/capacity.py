"""Live, account-scoped quota estimates. These are never a promise of Spot inventory."""

import asyncio
import hashlib
import time

from spotbot.models import timestamp
from spotbot.providers import ProviderError


def rental_documents(service):
    """Rentals and generations for usage counting; synchronous, so callers run it in a thread."""
    return (
        service.rentals.db.list("rental"),
        {g["id"]: g for g in service.rentals.db.list("generation")},
    )


async def availability(service, offer, *, force=False, documents=None):
    account = offer.details.get("aws_account", "default")
    provider = service.providers["aws"]
    if account != "default":
        provider = provider.fulfillment_providers().get(account)
        if provider is None:
            raise ValueError("aws_account_not_enrolled")
    rows, generations = documents or await asyncio.to_thread(rental_documents, service)
    family = provider._quota_family(offer.sku)
    if not family:
        raise ValueError("unsupported_instance_quota_family")
    snapshot = await quota_snapshot(service, provider, account, offer.region, family, force)

    def check():
        _, specs, used, known, seen, quota, checked = snapshot
        known = dict(known)
        if offer.sku not in specs:
            raise ValueError("unsupported_instance_quota_family")
        reserved = 0
        for row in rows:
            rfq = row["rfq"]
            if (
                rfq.get("account", "default") != account
                or offer.region not in rfq["regions"]
                or row["state"] == "CLOSED"
            ):
                continue
            gen = generations.get(row.get("current_generation_id")) or {}
            if gen.get("instance_id") in seen:
                continue  # Already counted by AWS; never subtract it twice.
            if row["state"] not in {
                "QUEUED",
                "WAITING_CAPACITY",
                "PROVISIONING",
                "VERIFYING",
                "DELIVERING",
                "ACTIVE",
                "RECOVERING",
                "NEEDS_RECONCILIATION",
            }:
                if gen.get("state") not in {"SUBMITTING", "NEEDS_RECONCILIATION"}:
                    continue
            skus = [s for s in rfq.get("instance_types", []) if provider._quota_family(s) == family]
            if not skus:
                continue
            if any(s not in specs for s in skus):
                known[family] = False
                continue
            reserved += max(specs[s]["VCpuInfo"]["DefaultVCpus"] for s in skus)
        remaining = max(0, int(quota) - used[family] - reserved)
        per_instance = specs[offer.sku]["VCpuInfo"]["DefaultVCpus"]
        maximum = remaining // per_instance if known[family] else None
        return dict(
            quotaLimitVcpus=int(quota),
            usedVcpus=used[family],
            reservedVcpus=reserved,
            remainingVcpus=remaining if known[family] else None,
            vcpusPerInstance=per_instance,
            maxInstances=maximum,
            maxGpus=maximum * offer.gpu_count if maximum is not None else None,
            usageKnown=known[family],
            capacityGuaranteed=False,
            checkedAt=checked,
            # Opaque grouping identifies shared limits without exposing supplier accounts.
            sharedPoolId=hashlib.sha256(
                f"{account}:{offer.region}:{family}:spot".encode()
            ).hexdigest()[:16],
            capacityStatus="unknown",
            basis="quota_estimate",
        )

    return check()


# A quota snapshot (instance types, usage and the Spot quota of one account, Region and
# instance family) costs several paginated AWS calls, serialized per account. Page loads use
# a snapshot up to STALE_SECONDS old and refresh it in the background once it is older than
# FRESH_SECONDS; purchase admission (force=True) always reads AWS. checkedAt shows the age.
FRESH_SECONDS = 15
STALE_SECONDS = 300


async def quota_snapshot(service, provider, account, region, family, force=False):
    key = (account, region, family)
    cache = service.__dict__.setdefault("_capacity_cache", {})
    inflight = service.__dict__.setdefault("_capacity_inflight", {})

    def read():
        ec2 = provider._client(region)
        specs, _ = provider._instance_types(ec2)
        seen = set()
        used, known = provider._quota_usage(ec2, specs, seen=seen)
        quota = provider._client(region, "service-quotas").get_service_quota(
            ServiceCode="ec2", QuotaCode="L-3819A6DF" if family == "g" else "L-7212CCBC"
        )["Quota"]["Value"]
        return specs, used, dict(known), seen, quota, timestamp()

    async def refresh():
        try:
            entry = (time.monotonic(), *(await provider._execute(read)))
            cache[key] = entry
            return entry
        finally:
            if inflight.get(key) is asyncio.current_task():
                inflight.pop(key)

    def start():
        task = asyncio.ensure_future(refresh())
        inflight[key] = task
        # A background refresh that fails keeps the previous snapshot; nobody awaits it.
        task.add_done_callback(lambda t: t.cancelled() or t.exception())
        return task

    if force:
        return await refresh()
    cached = cache.get(key)
    age = time.monotonic() - cached[0] if cached else None
    if cached and age < STALE_SECONDS:
        if age >= FRESH_SECONDS and key not in inflight:
            start()
        return cached
    return await asyncio.shield(inflight.get(key) or start())


async def admit(service, rules):
    candidates = await asyncio.to_thread(service.rentals.candidates, rules)
    if not candidates:
        raise ValueError("no_eligible_offer")
    for offer in candidates[:8]:
        value = await availability(service, offer, force=True)
        if value["usageKnown"] and value["maxInstances"] >= 1:
            return
    raise ProviderError("quota_insufficient", retryable=True)


def install(app, service, auth):
    from fastapi import HTTPException

    @app.get("/v1/capacity/availability", dependencies=auth)
    async def get_availability(offer_id: str):
        # Database reads stay off the event loop, which serves every other request.
        offer = await asyncio.to_thread(service.store.get_offer, offer_id)
        if not offer or offer.provider != "aws" or offer.market != "spot":
            raise HTTPException(404, "offer_not_found")
        try:
            return await availability(service, offer)
        except (ProviderError, ValueError, KeyError):
            raise HTTPException(503, "quota_snapshot_unavailable") from None

    @app.post("/v1/capacity/availability", dependencies=auth)
    async def batch_availability(offer_ids: list[str]):
        if len(offer_ids) > 200 or any(len(i) > 200 for i in offer_ids):
            raise HTTPException(400, "too_many_offers")
        result = {}
        documents = await asyncio.to_thread(rental_documents, service)
        for offer_id in dict.fromkeys(offer_ids):
            try:
                offer = await asyncio.to_thread(service.store.get_offer, offer_id)
                if not offer or offer.provider != "aws" or offer.market != "spot":
                    raise ValueError("offer_not_found")
                result[offer_id] = await availability(service, offer, documents=documents)
            except (ProviderError, ValueError, KeyError):
                result[offer_id] = dict(
                    maxInstances=None,
                    maxGpus=None,
                    usageKnown=False,
                    capacityGuaranteed=False,
                    capacityStatus="unknown",
                    basis="quota_estimate",
                )
        return dict(offers=result)
