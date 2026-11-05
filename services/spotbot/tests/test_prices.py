import copy
from datetime import timedelta
from decimal import Decimal

import httpx

from spotbot.models import gpu_model, utcnow
from tests.conftest import (
    LAMBDA_CATALOG,
    SHADE_CATALOG,
    TENSOR_CATALOG,
    VULTR_CATALOG,
    catalog_handler,
)


async def test_all_provider_units_and_market_availability(service_factory):
    svc = service_factory(catalog_handler)
    results = await svc.collect()
    assert all(r["status"] == "ok" for r in results)
    rows = svc.store.latest()
    shade = [o for o in rows if o.provider == "shadeform"]
    assert {(o.market, o.price_hourly, o.available) for o in shade} == {
        ("spot", Decimal("1.5"), True),
        ("on_demand", Decimal("2.5"), False),
    }
    tensor = next(o for o in rows if o.provider == "tensordock")
    assert tensor.price_hourly == Decimal("2.233")  # GPU + CPU + RAM + disk, not GPU-only
    assert tensor.price_kind == "estimated"
    vultr = [o for o in rows if o.provider == "vultr"]
    assert {(o.market, o.price_hourly) for o in vultr} == {
        ("spot", Decimal("2.1")),
        ("on_demand", Decimal("3.5")),
    }
    assert next(o for o in vultr if o.market == "spot").orderable is False
    assert next(o for o in rows if o.provider == "lambda").memory_unit == "GiB"
    assert all(o.gpu_model in {"H100", "L40S"} for o in rows)


async def test_history_appends_and_empty_catalog_removes_latest(service_factory):
    current = copy.deepcopy(SHADE_CATALOG)
    svc = service_factory(lambda _: httpx.Response(200, json=current))
    await svc.collect("shadeform")
    old = svc.store.latest()[0]
    await svc.collect("shadeform")
    assert svc.store.history(provider="shadeform")[0] == 4
    current["instance_types"] = []
    await svc.collect("shadeform")
    assert svc.store.latest() == []
    assert svc.store.history(offer_id=old.offer_id)[0] == 2


async def test_failed_collection_does_not_replace_good_prices(service_factory):
    responses = [
        httpx.Response(200, json=SHADE_CATALOG),
        httpx.Response(401, json={"error": "secret vendor token"}),
    ]
    svc = service_factory(lambda _: responses.pop(0))
    await svc.collect("shadeform")
    result = await svc.collect("shadeform")
    assert result[0]["error"] == "http_401"
    assert len(svc.store.latest()) == 2
    assert "secret" not in str(svc.store.collection_status())


async def test_pagination_cursor_is_followed_and_repeat_rejected(service_factory):
    requests = []

    def handler(req):
        requests.append(req)
        page = copy.deepcopy(VULTR_CATALOG)
        if len(requests) == 1:
            page["meta"]["links"]["next"] = "next-page"
        else:
            page["plans"][0]["id"] = "opaque-other-plan"
        return httpx.Response(200, json=page)

    svc = service_factory(handler)
    assert (await svc.collect("vultr"))[0]["count"] == 4
    assert requests[1].url.params["cursor"] == "next-page"
    bad = copy.deepcopy(VULTR_CATALOG)
    bad["meta"]["links"]["next"] = "repeat"
    svc.providers["vultr"].client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=bad))
    )
    assert (await svc.collect("vultr"))[0]["error"] == "invalid_pagination"
    assert len(svc.store.latest()) == 4


async def test_missing_price_schema_is_not_zero_or_on_demand_spot(service_factory):
    bad = copy.deepcopy(SHADE_CATALOG)
    del bad["instance_types"][0]["availability"][1]["hourly_price"]
    svc = service_factory(lambda _: httpx.Response(200, json=bad))
    assert (await svc.collect("shadeform"))[0]["status"] == "error"
    assert svc.store.latest() == []


async def test_tensordock_no_dedicated_ip_is_visible_but_not_orderable(service_factory):
    data = copy.deepcopy(TENSOR_CATALOG)
    data["data"]["locations"][0]["gpus"][0]["network_features"]["dedicated_ip_available"] = False
    svc = service_factory(lambda _: httpx.Response(200, json=data))
    await svc.collect("tensordock")
    offer = svc.store.latest()[0]
    assert offer.available and not offer.orderable


def test_gpu_normalization_and_stale_quote(service_factory):
    assert gpu_model("NVIDIA RTX A6000 48GB") == "RTX A6000"
    assert gpu_model("AMD_MI355X") == "MI355X"
    assert gpu_model("NVIDIA H100 SXM5 80GB") == "H100"
    cases = {
        "NVIDIA A10G": "A10G",
        "A10 (24 GB PCIe)": "A10",
        "NVIDIA L4": "L4",
        "L40S": "L40S",
        "NVIDIA RTX PRO SERVER 6000": "RTX PRO 6000",
        "RTXPRO6000": "RTX PRO 6000",
        "NVIDIA RTX PRO 4500": "RTX PRO 4500",
        "RTX4090": "RTX 4090",
        "RTX 6000": "RTX 6000",
        "RTX6000ADA": "RTX 6000 ADA",
        "A6000 (48 GB)": "RTX A6000",
        "GH200": "GH200",
        "GB200": "GB200",
        "T4G": "T4G",
        "B200_sxm6x8_NVLINK": "B200",
        "GAUDI2": "GAUDI2",
    }
    assert {text: gpu_model(text) for text in cases} == cases


async def test_stale_available_quote_flag(service_factory):
    svc = service_factory(catalog_handler)
    await svc.collect("shadeform")
    offer = svc.store.latest()[0]
    offer.observed_at = (utcnow() - timedelta(hours=1)).isoformat()
    assert offer.public(600)["stale"]


async def test_missing_keys_skip_only_private_catalogs(service_factory):
    from pydantic import SecretStr

    svc = service_factory(
        catalog_handler,
        lambda_api_key=SecretStr(""),
        shadeform_api_key=SecretStr(""),
        tensordock_api_key=SecretStr(""),
    )
    results = await svc.collect()
    assert sum(r["status"] == "skipped" for r in results) == 3
    assert next(r for r in results if r["provider"] == "vultr")["status"] == "ok"


async def test_disabled_provider_never_calls_vendor_or_erases_history(service_factory):
    svc = service_factory(catalog_handler)
    await svc.collect("tensordock")
    svc.settings.spotbot_enabled_providers = "lambda,vultr,shadeform"
    results = await svc.collect()
    assert {r["provider"] for r in results} == {"lambda", "vultr", "shadeform"}
    assert await svc.collect("tensordock") == [
        {"provider": "tensordock", "status": "disabled", "count": 0}
    ]
    assert svc.store.history(provider="tensordock")[0] == 1


async def test_lambda_live_catalog_cpu_only_types_do_not_break_gpu_collection(service_factory):
    catalog = copy.deepcopy(LAMBDA_CATALOG)
    cpu = copy.deepcopy(catalog["data"]["gpu_1x_h100"])
    cpu["instance_type"].update(
        name="cpu_8x",
        gpu_description="",
        specs={"vcpus": 8, "memory_gib": 32, "storage_gib": 100, "gpus": 0},
    )
    catalog["data"]["cpu_8x"] = cpu
    svc = service_factory(lambda _: httpx.Response(200, json=catalog))
    result = await svc.collect("lambda")
    assert result == [{"provider": "lambda", "status": "ok", "count": 1}]
    assert svc.store.latest()[0].gpu_count == 1


async def test_shadeform_live_catalog_cpu_only_types_do_not_break_gpu_collection(service_factory):
    catalog = copy.deepcopy(SHADE_CATALOG)
    cpu = copy.deepcopy(catalog["instance_types"][0])
    cpu.update(shade_instance_type="CPU", cloud_instance_type="cpu-type")
    cpu["configuration"].update(num_gpus=0, gpu_type="")
    catalog["instance_types"].append(cpu)
    svc = service_factory(lambda _: httpx.Response(200, json=catalog))
    assert await svc.collect("shadeform") == [{"provider": "shadeform", "status": "ok", "count": 2}]
    assert all(o.gpu_count >= 1 for o in svc.store.latest())
