"""Model catalog reads must not wait for live cloud quota requests."""

import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from tests.test_opennext_market import env as env


async def primed_market(client):
    market = client._transport.app.state.ops.paid_purchases.market
    await market.offers(with_quota=False)
    # Legacy test fixtures omit native IDs; real catalog rows always include them.
    for offer in market._offers.values():
        offer.raw["offer_id"] = offer.id
    return market


async def test_model_catalog_does_not_read_quota(env):
    client, _, calls = env
    market = await primed_market(client)
    market.inference_presets = AsyncMock(return_value={"presets": []})
    response = await client.get(
        "/api/marketplace/inference-presets", params={"offerId": "spotbot-us-west-2-g6.xlarge"}
    )
    assert response.status_code == 200
    assert response.json() == {"presets": []}
    assert any(call.url.path == "/v1/prices/latest" for call in calls)
    assert not any(call.url.path == "/v1/capacity/availability" for call in calls)


async def test_cold_model_read_fetches_only_its_region_and_sku_then_reuses_it(env):
    client, _, calls = env
    market = client._transport.app.state.ops.paid_purchases.market
    market.inference_presets = AsyncMock(return_value={"presets": []})
    for _ in range(2):
        result = await client.get("/api/marketplace/inference-presets", params={
            "offerId": "spotbot-us-west-2-g6.xlarge"
        })
        assert result.status_code == 200
    reads = [call for call in calls if call.url.path == "/v1/prices/latest"]
    assert len(reads) == 1
    assert reads[0].url.params["region"] == "us-west-2"
    assert reads[0].url.params["sku"] == "g6.xlarge"
    assert market._loaded is None  # A partial read must not populate the whole catalog.


async def test_model_read_rejects_regions_outside_the_enrolled_catalog(env):
    client, _, calls = env
    result = await client.get("/api/marketplace/inference-presets", params={
        "offerId": "spotbot-ap-northeast-1-g6.xlarge"
    })
    assert result.status_code == 404
    assert not any(call.url.path == "/v1/prices/latest" for call in calls)


async def test_cold_options_use_one_rpc_but_manual_refresh_reads_current_admission(env):
    client, _, calls = env
    market = client._transport.app.state.ops.paid_purchases.market
    original = market.bot
    first = {"presets": [{"id": "test", "enabled": False}]}

    async def bundled(method, path, **kwargs):
        response = await original(method, path, **kwargs)
        if path == "/v1/prices/latest":
            body = response.json()
            for group in body["groups"]:
                for row in group["offers"]:
                    row["offer_id"] = "native-offer"
                    row["inference_presets"] = first
            return httpx.Response(200, json=body, request=response.request)
        return response

    market.bot = bundled
    refreshed = {"presets": [{"id": "test", "enabled": True}]}
    market.inference_presets = AsyncMock(return_value=refreshed)
    params = {"offerId": "spotbot-us-west-2-g6.xlarge"}
    assert (await client.get("/api/marketplace/inference-presets", params=params)).json() == first
    market.inference_presets.assert_not_awaited()
    assert len(calls) == 1
    assert calls[0].url.params["include_inference"] == "true"
    assert (await client.get("/api/marketplace/inference-presets", params=params)).json() == refreshed
    market.inference_presets.assert_awaited_once()


@pytest.mark.parametrize("failure", [httpx.ReadTimeout("slow"), httpx.ConnectError("offline")])
async def test_model_read_retries_only_transient_transport_failures_once(env, failure):
    client, _, _ = env
    market = client._transport.app.state.ops.paid_purchases.market
    success = httpx.Response(200, json={"presets": []})
    market.bot = AsyncMock(side_effect=[failure, success])
    assert await market._model_read("/v1/inference/presets", params={}) is success
    assert market.bot.await_count == 2
    assert all(call.args[0] == "GET" for call in market.bot.await_args_list)
    market.bot = AsyncMock(side_effect=failure)
    with pytest.raises(type(failure)):
        await market._model_read("/v1/inference/presets", params={})
    assert market.bot.await_count == 2


async def test_slow_quota_lookup_does_not_hold_the_catalog_lock(env):
    client, _, _ = env
    market = await primed_market(client)
    original = market.bot
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow_quota(method, path, **kwargs):
        if path == "/v1/capacity/availability":
            entered.set()
            await release.wait()
            return httpx.Response(200, json={"offers": {}},
                                  request=httpx.Request(method, "http://bot.test" + path))
        return await original(method, path, **kwargs)

    market.bot = slow_quota
    market.inference_presets = AsyncMock(return_value={"presets": []})
    public = asyncio.create_task(market.offers())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        response = await asyncio.wait_for(
            client.get("/api/marketplace/inference-presets", params={
                "offerId": "spotbot-us-west-2-g6.xlarge"
            }), 1
        )
        assert response.status_code == 200
        assert not public.done()
    finally:
        release.set()
        await public


async def test_compatibility_reuses_hardware_but_a_price_quote_refreshes_prices(env):
    client, _, calls = env
    market = await primed_market(client)
    market._loaded -= 120
    market.inference_presets = AsyncMock(return_value={"presets": []})
    before = sum(call.url.path == "/v1/prices/latest" for call in calls)
    options = await client.get("/api/marketplace/inference-presets", params={
        "offerId": "spotbot-us-west-2-g6.xlarge"
    })
    assert options.status_code == 200
    assert sum(call.url.path == "/v1/prices/latest" for call in calls) == before
    quote = await client.post("/api/marketplace/inference-quote", json={
        "offerId": "spotbot-us-west-2-g6.xlarge", "durationHours": 1,
        "inferencePresetId": None
    })
    assert quote.status_code == 200
    assert sum(call.url.path == "/v1/prices/latest" for call in calls) == before + 1
    assert not any(call.url.path == "/v1/capacity/availability" for call in calls)


@pytest.mark.parametrize("failure", [TimeoutError(), ValueError("unavailable")])
async def test_unavailable_model_service_never_fabricates_compatible_models(env, failure):
    client, _, _ = env
    market = client._transport.app.state.ops.paid_purchases.market
    market.inference_presets = AsyncMock(side_effect=failure)
    response = await client.get("/api/marketplace/inference-presets", params={
        "offerId": "spotbot-us-west-2-g6.xlarge"
    })
    assert response.status_code == 503
    assert "GPU" in response.json()["error"]
    assert "presets" not in response.json()
