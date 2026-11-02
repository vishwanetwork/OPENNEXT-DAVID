import json
from unittest.mock import AsyncMock

import pytest

from spotbot.inference import InferenceSpec, priced
from tests.test_opennext_market import body, buy  # noqa: F401
from tests.test_opennext_market import env as env
from tests.test_opennext_ops import transfer


@pytest.fixture
def model_market(env):
    client, fakes, calls = env
    market = client._transport.app.state.ops.paid_purchases.market
    spec = InferenceSpec(
        preset_id="deepseek-r1-distill-7b",
        revision="a" * 40,
        image="vllm/vllm-openai@sha256:" + "b" * 64,
        tensor_parallel=1,
        disk_gib=100,
        preparation_seconds=1800,
    )

    async def prepare(offer, preset):
        assert preset == spec.preset_id
        return priced(offer, spec, market.storage_rate)

    market.prepare_offer = prepare
    return client, fakes, calls, market, spec


async def test_model_purchase_freezes_storage_and_inference_while_preserving_gpu_bid(model_market):
    client, fakes, _, market, spec = model_market
    offer = (await market.offers())[body()["offerId"]]
    prepared = await market.prepare_offer(offer, spec.preset_id)
    payload = body(cents=prepared.cents, inferencePresetId=spec.preset_id)
    assert (await buy(client, payload)).status_code == 400
    payload["inferenceBillingAcknowledged"] = True
    result = await buy(client, payload)
    assert result.status_code == 200, result.text
    rfq = fakes.created[0]
    assert rfq["inference"] == spec.model_dump() and rfq["retail_hourly_cents"] == prepared.cents
    assert rfq["data_disks"] == [dict(device="/dev/sdf", size_gib=100)] and rfq["http_port"] == 8000
    assert rfq["max_price_hourly"] == "0.468"  # Native GPU price, excluding model storage.
    assert (await buy(client, payload)).status_code == 200
    assert len(fakes.created) == 1
    assert (await buy(client, dict(payload, inferencePresetId=None))).status_code == 409


async def test_direct_pay_intent_keeps_original_model_when_runtime_catalog_changes(model_market):
    client, _, _, market, spec = model_market
    offer = (await market.offers())[body()["offerId"]]
    prepared = await market.prepare_offer(offer, spec.preset_id)
    payload = dict(
        purpose="order",
        amountCents=prepared.cents,
        currency="USD",
        offerId=offer.id,
        durationHours=1,
        idempotencyKey="model-direct-pay",
        inferencePresetId=spec.preset_id,
        inferenceBillingAcknowledged=True,
    )
    result = await transfer(client, payload)
    assert result.status_code == 200, result.text
    ops = client._transport.app.state.ops
    doc = await ops.get_transfer(result.json()["id"])
    assert doc["pricing_snapshot"]["inference"] == spec.model_dump()
    market.prepare_offer = AsyncMock(side_effect=ValueError("preset disabled"))
    assert (await transfer(client, payload)).json() == result.json()
    changed = await transfer(client, dict(payload, inferencePresetId=None))
    assert changed.status_code == 409


async def test_inference_status_is_owned_and_service_changes_require_csrf(model_market):
    client, fakes, _, _, spec = model_market
    result = await buy(client, body())
    rid = result.json()["orderId"]
    fakes.rentals[0]["inference"] = dict(
        preset_id=spec.preset_id,
        state="downloading",
        version=1,
        billing_start="gpu_delivery",
        downloaded_bytes=12,
        total_bytes=24,
    )
    path = f"/api/marketplace/instances/{rid}/inference"
    response = await client.get(path, headers={"Cookie": "session=buyer"})
    assert response.status_code == 200 and response.json()["status"]["state"] == "downloading"
    assert response.json()["connection"] is None and "apiKey" not in json.dumps(response.json())
    assert (await client.get(path, headers={"Cookie": "session=other"})).status_code == 404
    assert (
        await client.post(
            path, json=dict(action="stop", expectedVersion=1), headers={"Cookie": "session=buyer"}
        )
    ).status_code == 403
