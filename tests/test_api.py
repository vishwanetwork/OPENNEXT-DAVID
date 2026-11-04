import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from spotbot.api import create_app
from spotbot.config import Settings
from spotbot.models import LaunchOptions, OrderRequest
from tests.conftest import catalog_handler

AUTH = {"Authorization": "Bearer test-token"}


def client_setup(service_factory):
    svc = service_factory(catalog_handler)
    asyncio.run(svc.collect())
    return svc, create_app(svc.settings, svc)


def test_api_auth_grouping_history_and_gpu_filters(service_factory):
    svc, app = client_setup(service_factory)
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/v1/prices/latest").status_code == 401
        latest = client.get("/v1/prices/latest", headers=AUTH).json()
        assert len(latest["groups"]) == 4 and latest["total"] == 6
        found = client.get(
            "/v1/gpus", params={"model": "H100", "market": "spot"}, headers=AUTH
        ).json()
        assert found["gpus"][0]["providers"] == ["shadeform"]
        assert found["gpus"][0]["offers"][0]["price_hourly"] == "1.50"
        unavailable = client.get(
            "/v1/prices/latest",
            params={"provider": "shadeform", "market": "on_demand", "available_only": True},
            headers=AUTH,
        ).json()
        assert unavailable["total"] == 0
        h = client.get(
            "/v1/prices/history", params={"provider": "shadeform", "limit": 1}, headers=AUTH
        ).json()
        assert h["total"] == 2 and len(h["items"]) == 1
        assert (
            client.get(
                "/v1/prices/history", params={"since": "2026-01-01T00:00:00"}, headers=AUTH
            ).status_code
            == 400
        )
        assert client.get("/v1/prices/latest", params={"limit": 0}, headers=AUTH).status_code == 422
        compressed = client.get("/v1/prices/latest", headers={**AUTH, "Accept-Encoding": "gzip"})
        assert compressed.headers["content-encoding"] == "gzip"
        assert compressed.json() == latest


def test_latest_catalog_filters_region_and_sku_before_rendering_offers(service_factory):
    svc, app = client_setup(service_factory)
    offer = svc.store.latest()[0]
    params = dict(provider=offer.provider, market=offer.market,
                  region=offer.region, sku=offer.sku)
    with TestClient(app) as client:
        body = client.get("/v1/prices/latest", params=params, headers=AUTH).json()
        rows = [row for group in body["groups"] for row in group["offers"]]
        assert rows and all(row["region"] == offer.region and row["sku"] == offer.sku
                            for row in rows)
        for changed in [dict(params, region="missing-region"), dict(params, sku="missing-sku")]:
            assert client.get("/v1/prices/latest", params=changed,
                              headers=AUTH).json()["total"] == 0


def test_api_order_idempotency_redaction_handoff_and_live_guard(service_factory):
    svc, app = client_setup(service_factory)
    offer = next(o for o in svc.store.latest() if o.provider == "shadeform" and o.market == "spot")
    request = OrderRequest(
        offer_id=offer.offer_id,
        max_price_hourly="2",
        dry_run=True,
        launch=LaunchOptions(ssh_key_id="key", cloud_init="SECRET-BOOTSTRAP"),
    )
    body = request.model_dump(mode="json")
    with TestClient(app) as client:
        headers = dict(AUTH, **{"Idempotency-Key": "api-order"})
        created = client.post("/v1/orders", json=body, headers=headers)
        assert created.status_code == 200, created.text
        assert "SECRET-BOOTSTRAP" not in created.text
        order_id = created.json()["order"]["id"]
        plan = client.get(f"/v1/orders/{order_id}/plan", headers=AUTH)
        assert "SECRET-BOOTSTRAP" not in plan.text and "[redacted]" in plan.text
        assert client.get(f"/v1/orders/{order_id}/handoff", headers=AUTH).status_code == 409
        assert not client.post("/v1/orders", json=body, headers=headers).json()["created"]
        assert (
            client.post(
                "/v1/orders",
                json=dict(body, dry_run=False),
                headers=dict(AUTH, **{"Idempotency-Key": "live"}),
            ).status_code
            == 409
        )
        assert (
            client.post(f"/v1/orders/{order_id}/cancel", headers=AUTH).json()["state"]
            == "cancelled"
        )


def test_sf_compute_plan_units_and_no_execution(service_factory):
    svc, app = client_setup(service_factory)
    with TestClient(app) as client:
        result = client.post(
            "/v1/sfcompute/plan",
            headers=AUTH,
            json={
                "pool": "dev pool",
                "sku": "sku_test",
                "image": "public-image",
                "node_count": 2,
                "duration_hours": 3,
                "max_rate_per_node_hour": "20.00",
            },
        ).json()
        assert not result["executed"] and result["maximum_compute_cost_usd"] == "120.00"
        assert result["unit"] == "8_gpu_node_hour"
        assert "'dev pool'" in result["commands"][1]["command"]
        assert "--allow-standing" in result["commands"][1]["argv"]


def test_config_rejects_live_without_service_token(tmp_path):
    with pytest.raises(ValidationError, match="SPOTBOT_API_KEY"):
        Settings(
            _env_file=None,
            spotbot_database_path=tmp_path / "a.db",
            spotbot_live_orders_enabled=True,
        )


def test_mutations_require_auth_and_idempotency_header(service_factory):
    svc, app = client_setup(service_factory)
    offer = next(o for o in svc.store.latest() if o.provider == "shadeform" and o.market == "spot")
    with TestClient(app) as client:
        body = {
            "offer_id": offer.offer_id,
            "max_price_hourly": "2",
            "launch": {"ssh_key_id": "key"},
        }
        assert client.post("/v1/orders", json=body).status_code == 401
        assert client.post("/v1/orders", json=body, headers=AUTH).status_code == 422
        assert client.post("/v1/collections").status_code == 401
        assert client.post("/v1/worker/tick").status_code == 401


def test_disabled_provider_is_hidden_from_latest_and_rejects_new_orders(service_factory):
    svc, app = client_setup(service_factory)
    offer = next(o for o in svc.store.latest() if o.provider == "tensordock")
    svc.settings.spotbot_enabled_providers = "lambda,vultr,shadeform"
    with TestClient(app) as client:
        rows = client.get("/v1/prices/latest", headers=AUTH).json()
        assert "tensordock" not in {g["provider"] for g in rows["groups"]}
        status = client.get("/v1/providers", headers=AUTH).json()
        assert (
            next(p for p in status["providers"] if p["provider"] == "tensordock")["enabled"]
            is False
        )
        result = client.post(
            "/v1/orders",
            headers=dict(AUTH, **{"Idempotency-Key": "disabled"}),
            json={
                "offer_id": offer.offer_id,
                "max_price_hourly": "5",
                "launch": {"ssh_public_key": "ssh-ed25519 test-public"},
            },
        )
        assert result.status_code == 400 and result.json()["detail"] == "provider_disabled"
        assert (
            client.get("/v1/prices/history?provider=tensordock", headers=AUTH).json()["total"] == 1
        )
