import asyncio

import httpx

from spotbot.api import create_app
from spotbot.providers import ProviderError
from tests.test_rentals import rental_env as rental_env  # noqa: F401


async def test_concurrent_checkouts_serialize_quota_admission_and_keep_idempotency(
    rental_env, monkeypatch
):
    env = rental_env

    async def admit(service, rules):
        await asyncio.sleep(0.01)  # Let both requests reach the same critical section.
        if service.rentals.db.list("rental"):
            raise ProviderError("quota_insufficient", retryable=True)

    monkeypatch.setattr("spotbot.capacity.admit", admit)
    app = create_app(env.service.settings, env.service)
    headers = {"Authorization": "Bearer " + "a" * 32, "X-SpotBot-Quota-Admission": "true"}
    payload = env.request.model_dump(mode="json")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://bot"
    ) as client:

        async def create(key):
            return await client.post(
                "/v1/rentals", json=payload, headers={**headers, "Idempotency-Key": key}
            )

        one, two = await asyncio.gather(create("first"), create("second"))
        assert sorted([one.status_code, two.status_code]) == [200, 409]
        assert len(env.engine.db.list("rental")) == 1
        key = "first" if one.status_code == 200 else "second"
        retry = await create(key)
        assert retry.status_code == 200 and retry.json()["created"] is False
