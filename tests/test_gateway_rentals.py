"""The actual bot API/outbox and gateway coordinate a complete simulated rental."""

from pydantic import SecretStr

from spotbot.api import create_app
from spotbot.gateway import create_gateway_app
from tests.test_gateway import environment as environment  # noqa: F401
from tests.test_rentals import cycle, report_ready
from tests.test_rentals import rental_env as rental_env  # noqa: F401


async def test_bot_to_gateway_handoff_recovery_and_release(rental_env, environment, monkeypatch):
    import httpx

    env, gwenv = rental_env, environment
    gateway = gwenv["gateway"]
    monkeypatch.setattr("spotbot.gateway.utcnow", env.clock.now)
    env.service.settings.spotbot_api_key = SecretStr("administrator" * 4)
    env.service.settings.spotbot_rental_gateway_token = SecretStr("b" * 40)
    env.service.settings.spotbot_gateway_webhook_secret = SecretStr("w" * 40)
    env.service.settings.spotbot_gateway_webhook_url = (
        "https://gateway.example.com/v1/gateway/events"
    )
    bot_app = create_app(env.service.settings, env.service)
    gateway_app = create_gateway_app(gwenv["config"], gateway)
    bot_client = httpx.AsyncClient(transport=httpx.ASGITransport(bot_app))
    event_client = httpx.AsyncClient(transport=httpx.ASGITransport(gateway_app))
    original = gateway.client
    gateway.client = bot_client
    env.service.client = event_client
    try:
        row, _ = env.engine.create(env.request, "tenant-a", "gateway-integration")
        rental_id = row["id"]

        async def serve():
            for _ in range(30):
                current = env.engine.get(rental_id, "tenant-a")
                gen = env.engine.current(current)
                if gen and gen.get("instance_id") and gen["state"] not in {"STOPPED", "REJECTED"}:
                    await report_ready(env, rental_id)
                await cycle(env)
                await env.service._deliver_events()
                await gateway.tick()
                current = env.engine.get(rental_id, "tenant-a")
                if current["state"] == "ACTIVE" and gateway.authorized(rental_id):
                    return current
            raise AssertionError("Rental failed to become active through gateway acknowledgement")

        first = await serve()
        assert first["generation"] == 1
        public = gateway.public(gateway.db.get("gateway", rental_id))
        old_gen = env.engine.current(first)
        for volume in old_gen["volumes"]:
            env.cloud.files[volume["volume_id"]]["model-weights"] = "new-customer-content"

        await env.engine.handle_interruption(
            {
                "source": "aws.ec2",
                "detail-type": "EC2 Spot Instance Interruption Warning",
                "region": old_gen["region"],
                "detail": {"instance-id": old_gen["instance_id"]},
            }
        )
        await env.service._deliver_events()
        assert not gateway.authorized(rental_id)
        env.clock.advance(11)
        await cycle(env, 8)
        env.clock.advance(31)
        second = await serve()
        assert second["generation"] == 2
        assert gateway.public(gateway.db.get("gateway", rental_id))["ssh"] == public["ssh"]
        for volume in env.engine.current(second)["volumes"]:
            assert env.cloud.files[volume["volume_id"]]["model-weights"] == "new-customer-content"

        await env.engine.release(rental_id, "tenant-a")
        await env.service._deliver_events()
        assert not gateway.authorized(rental_id)
        env.clock.advance(11)
        await cycle(env, 15)
        assert env.engine.get(rental_id, "tenant-a")["state"] == "CLOSED"
        assert len(env.cloud.creates) == 2
    finally:
        gateway.client = original
        await bot_client.aclose()
        await event_client.aclose()
        await env.service.close()
