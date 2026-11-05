"""Read-only provider preflight must never allocate resources or promise inventory."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from spotbot.api import create_app
from spotbot.providers import ProviderError
from tests.test_rentals import rental_env  # noqa: F401


def test_live_preflight_is_tenant_guarded_and_never_allocates(rental_env):  # noqa: F811
    env = rental_env
    env.cloud.preflight = AsyncMock(return_value=None)
    client = TestClient(create_app(env.service.settings, env.service))
    url, payload = "/v1/rentals/preflight", env.request.model_dump(mode="json")
    assert client.post(url, json=payload).status_code == 401
    headers = {"Authorization": "Bearer " + "a" * 32}
    good = client.post(url, json=payload, headers=headers)
    assert good.status_code == 200, good.text
    assert good.json()["eligible"] is True and good.json()["capacityGuaranteed"] is False
    assert not env.cloud.creates and env.engine.db.list("rental") == []
    env.cloud.preflight.side_effect = ProviderError("quota_insufficient", retryable=True)
    assert client.post(url, json=payload, headers=headers).json()["eligible"] is False
    env.cloud.preflight.side_effect = ProviderError("access_denied")
    assert client.post(url, json=payload, headers=headers).status_code == 503
    assert not env.cloud.creates
