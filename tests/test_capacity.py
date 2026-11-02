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
