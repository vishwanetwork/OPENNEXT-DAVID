from types import SimpleNamespace

import pytest

from spotbot.capacity import availability


@pytest.fixture
def capacity_env():
    rows, generations = [], []
    usage = dict(p=192, g=4)
    specs = {
        "p5.test": {"VCpuInfo": {"DefaultVCpus": 192}},
        "p6.test": {"VCpuInfo": {"DefaultVCpus": 384}},
    }

    class Provider:
        def _client(self, *args):
            return self

        def _instance_types(self, _):
            return specs, None

        def _quota_family(self, sku):
            return "p" if sku.startswith("p") else "g"

        def _quota_usage(self, ec2, specs, *, seen):
            seen.add("i-counted")
            return dict(usage), dict(p=True, g=True)

        def get_service_quota(self, **kw):
            return dict(Quota=dict(Value=768))

        async def _execute(self, fn):
            return fn()

    provider = Provider()
    db = SimpleNamespace(list=lambda kind: rows if kind == "rental" else generations)
    svc = SimpleNamespace(providers=dict(aws=provider), rentals=SimpleNamespace(db=db))
    offer = SimpleNamespace(details={}, region="us-west-2", sku="p5.test", gpu_count=8)
    return svc, offer, rows, generations, usage


async def test_shared_quota_subtracts_other_models_queued_orders_without_double_count(capacity_env):
    service, offer, rows, generations, _ = capacity_env
    generations.append(dict(id="g1", instance_id="i-counted", state="RUNNING"))
    base = dict(
        rfq=dict(regions=["us-west-2"], instance_types=["p5.test"]),
        state="ACTIVE",
        current_generation_id="g1",
    )
    rows.append(base)
    first = await availability(service, offer)
    assert first["maxInstances"] == 3 and first["maxGpus"] == 24
    assert first["capacityGuaranteed"] is False
    rows.append(dict(rfq=dict(regions=["us-west-2"], instance_types=["p6.test"]), state="QUEUED"))
    second = await availability(service, offer)
    assert second["reservedVcpus"] == 384 and second["maxInstances"] == 1
    b300 = SimpleNamespace(details={}, region=offer.region, sku="p6.test", gpu_count=8)
    third = await availability(service, b300)
    assert third["maxInstances"] == 0 and third["sharedPoolId"] == second["sharedPoolId"]
    rows[-1]["rfq"]["account"] = "other"
    assert (await availability(service, offer))["maxInstances"] == 3


async def test_unknown_usage_never_reports_fake_inventory(capacity_env):
    svc, offer, rows, _, _ = capacity_env
    rows.append(
        dict(rfq=dict(regions=[offer.region], instance_types=["p-unknown"]), state="QUEUED")
    )
    result = await availability(svc, offer)
    assert result["maxInstances"] is None and result["maxGpus"] is None


async def test_page_loads_use_the_snapshot_and_refresh_it_in_the_background(
    capacity_env, monkeypatch
):
    import asyncio

    from spotbot import capacity

    service, offer, _, _, usage = capacity_env
    provider = service.providers["aws"]
    reads, clock = [], [1000.0]
    original = provider._quota_usage

    def counted(*args, **kwargs):
        reads.append(1)
        return original(*args, **kwargs)

    provider._quota_usage = counted
    monkeypatch.setattr(capacity.time, "monotonic", lambda: clock[0])
    assert (await availability(service, offer))["usedVcpus"] == 192 and len(reads) == 1
    usage["p"] = 384
    await availability(service, offer)
    assert len(reads) == 1  # Fresh: no AWS reads.
    clock[0] += capacity.FRESH_SECONDS + 1
    stale = await availability(service, offer)
    assert stale["usedVcpus"] == 192  # Answered from the snapshot at once...
    await asyncio.sleep(0)
    assert len(reads) == 2  # ...while one background refresh reads AWS.
    assert (await availability(service, offer))["usedVcpus"] == 384
    clock[0] += capacity.STALE_SECONDS + 1
    usage["p"] = 576
    assert (await availability(service, offer))["usedVcpus"] == 576  # Too old: read now.
    assert (await availability(service, offer, force=True))["usedVcpus"] == 576
    assert len(reads) == 4  # Purchase admission always reads AWS.
