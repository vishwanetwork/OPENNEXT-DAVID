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
