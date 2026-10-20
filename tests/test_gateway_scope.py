"""A compromised delivery credential cannot execute paid procurement commands."""

import json

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from spotbot.api import create_app
from spotbot.config import Settings
from tests.test_rentals import rental_env as rental_env  # noqa: F401


async def test_gateway_token_has_a_limited_delivery_view_and_no_execution_rights(rental_env):
    env = rental_env
    token = "gateway-delivery-only-" * 3
    env.service.settings.spotbot_rental_gateway_token = SecretStr(token)
    row, _ = env.engine.create(env.request, "tenant-a", "gateway-scope")
    base = "/v1/rentals/" + row["id"]
    headers = {"Authorization": "Bearer " + token, "X-SpotBot-Tenant": "tenant-a"}
    app = create_app(env.service.settings, env.service)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="https://bot.example.com"
        ) as client:
            response = await client.get(base, headers=headers)
            assert response.status_code == 200
            view = response.json()
            assert view["authorization_scope"] == "gateway_delivery"
            assert view["id"] == row["id"] and view["tenant_id"] == "tenant-a"
            assert set(view["rfq"]) == {"expires_at", "ssh_user", "http_port", "http_health_path"}
            assert "budget_usd" not in response.text and "estimated_cost_usd" not in response.text
            assert "upstream_order_id" not in response.text
            assert (await client.get(base + "/connection", headers=headers)).status_code == 200
            wrong = dict(headers, **{"X-SpotBot-Tenant": "tenant-b"})
            assert (await client.get(base, headers=wrong)).status_code == 404
            assert (
                await client.get(base, headers={"Authorization": "Bearer " + token})
            ).status_code == 401
            for suffix in ("", "/backups", "/events", "/generations"):
                path = "/v1/rentals" if not suffix else base + suffix
                assert (await client.get(path, headers=headers)).status_code == 401
            commands = [
                ("/v1/rentals", env.request.model_dump(mode="json")),
                (base + "/release", None),
                (base + "/recover", {}),
                (base + "/backups", None),
                (base + "/reconcile", {}),
                (
                    base + "/renew",
                    {"expected_version": 1, "rfq": env.request.rfq.model_dump(mode="json")},
                ),
                (
                    base + "/policy-revisions",
                    {"expected_version": 1, "rfq": env.request.rfq.model_dump(mode="json")},
                ),
            ]
            for path, body in commands:
                result = await client.post(
                    path,
                    json=body,
                    headers=dict(headers, **{"Idempotency-Key": "must-not-purchase"}),
                )
                assert result.status_code == 401, (path, result.text)
            assert (await client.get("/v1/providers", headers=headers)).status_code == 401
            assert env.cloud.creates == []
            assert len(env.engine.db.list("rental")) == 1
            assert env.engine.get(row["id"], "tenant-a")["state"] == "QUEUED"
            # Existing scheduler/administrator responses keep the full RFQ contract.
            admin = {
                "Authorization": "Bearer "
                + env.service.settings.spotbot_api_key.get_secret_value(),
                "X-SpotBot-Tenant": "tenant-a",
            }
            assert "budget_usd" in (await client.get(base, headers=admin)).json()["rfq"]
    finally:
        await env.service.close()


@pytest.mark.parametrize("other", ["admin", "tenant", "signing", "too_short"])
def test_gateway_credential_must_be_distinct_and_errors_hide_input(other):
    secret = "must-never-be-an-execution-key-1234567890"
    values = {"_env_file": None, "spotbot_rental_gateway_token": secret}
    if other == "admin":
        values["spotbot_api_key"] = secret
    elif other == "tenant":
        values["spotbot_rental_tenant_tokens"] = json.dumps({"tenant": secret})
    elif other == "signing":
        values["spotbot_gateway_webhook_secret"] = secret
    else:
        secret = "private-short-secret"
        values["spotbot_rental_gateway_token"] = secret
    with pytest.raises(ValidationError) as error:
        Settings(**values)
    assert secret not in str(error.value)
