"""Gateway records use the same CAS contracts on every supported database."""

import httpx

from spotbot.gateway import Gateway
from spotbot.gateway_config import GatewaySettings
from tests.test_gateway import event
from tests.test_storage import storage as storage  # noqa: F401


async def test_gateway_routing_intent_is_durable_and_tenant_scoped(storage):
    from uuid import uuid4

    config = GatewaySettings(
        _env_file=None,
        bot_url="https://bot.example.com",
        bot_token="b" * 40,
        api_key="a" * 40,
        webhook_secret="w" * 40,
        public_ssh_host="ssh.example.com",
    )
    storage.acquire()
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    gateway = Gateway(config, store=storage, client=client)
    assert gateway.backend_client is not gateway.client
    rental_id = str(uuid4())
    try:
        await gateway.ingest(event({"id": rental_id}))
        await gateway.ingest(event({"id": rental_id}, version=12, state="RECOVERING"))
        await gateway.ingest(event({"id": rental_id}, version=9, state="ACTIVE"))
        assert gateway.db.get("gateway", rental_id)["desired_version"] == 12
        assert gateway.db.list("gateway", "tenant-b") == []
        assert len(gateway.db.list("gateway", "tenant-a")) == 1
        restarted = Gateway(config, store=storage, client=client, backend_client=client)
        assert restarted.db.get("gateway", rental_id)["desired_version"] == 12
        assert not restarted.authorized(rental_id)
    finally:
        await gateway.close()
        await client.aclose()
