import asyncio
import copy
import hashlib
import hmac
import json
from datetime import timedelta

import httpx
import pytest
from pydantic import SecretStr

from spotbot.models import LaunchOptions, OrderRequest, utcnow
from tests.conftest import SHADE_CATALOG


class FakeShade:
    def __init__(self):
        self.catalog = copy.deepcopy(SHADE_CATALOG)
        self.creates = []
        self.deletes = 0
        self.status = "active"
        self.create_response = None
        self.deleted = False
        self.name = None

    def __call__(self, req):
        if req.url.path == "/v1/instances/types":
            return httpx.Response(200, json=self.catalog)
        if req.url.path == "/v1/instances/create":
            payload = json.loads(req.content)
            self.creates.append(payload)
            self.name = payload["name"]
            if self.create_response:
                return self.create_response
            return httpx.Response(200, json={"id": "instance-test"})
        if req.url.path.endswith("/delete"):
            self.deletes += 1
            self.deleted = True
            return httpx.Response(204)
        if self.deleted:
            return httpx.Response(404)
        return httpx.Response(
            200,
            json={
                "name": self.name,
                "status": self.status,
                "ip": "203.0.113.1",
                "ssh_port": 22,
                "ssh_user": "shadeform",
                "status_details": "preempted" if self.status == "deleting" else "",
            },
        )


async def order_setup(service_factory, fake=None, dry_run=False):
    fake = fake or FakeShade()
    svc = service_factory(fake, spotbot_live_orders_enabled=True)
    await svc.collect("shadeform")
    offer = next(o for o in svc.store.latest() if o.market == "spot")
    request = OrderRequest(
        offer_id=offer.offer_id,
        max_price_hourly="2",
        dry_run=dry_run,
        launch=LaunchOptions(ssh_key_id="key-test"),
        inference_port=8000,
    )
    order, _ = svc.create_order(request, "test-idempotency")
    return svc, fake, request, order


async def test_dry_run_idempotent_plan_never_launches(service_factory):
    svc, fake, req, order = await order_setup(service_factory, dry_run=True)
    await svc.tick()
    assert order["state"] == "planned" and fake.creates == []
    replay, created = svc.create_order(req, "test-idempotency")
    assert replay["id"] == order["id"] and not created
    with pytest.raises(ValueError, match="idempotency_key_conflict"):
        svc.create_order(req.model_copy(update={"dry_run": False}), "test-idempotency")


async def test_live_order_handoff_release_and_concurrent_ticks(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    await asyncio.gather(svc.tick(), svc.tick())
    assert len(fake.creates) == 1
    assert fake.creates[0]["rental_type"] == "spot"
    assert fake.creates[0]["shade_cloud"] is True
    current = svc.store.get_order(order["id"])
    assert current["state"] == "ready"
    assert current["handoff"]["ssh"]["host"] == "203.0.113.1"
    assert current["handoff"]["inference"]["base_url"] == "http://203.0.113.1:8000/v1"
    assert current["handoff"]["inference"]["status"] == "unverified"
    svc.release(order["id"])
    await svc.tick()
    assert svc.store.get_order(order["id"])["state"] == "releasing"
    await svc.tick()
    assert svc.store.get_order(order["id"])["state"] == "released" and fake.deletes == 1
    assert svc.release(order["id"])["state"] == "released"


@pytest.mark.parametrize("status", [500, 503, 408])
async def test_ambiguous_create_is_never_replayed(service_factory, status):
    fake = FakeShade()
    fake.create_response = httpx.Response(status, json={"error": "possibly created"})
    svc, fake, req, order = await order_setup(service_factory, fake)
    await svc.tick()
    assert svc.store.get_order(order["id"])["state"] == "needs_reconciliation"
    await svc.tick()
    svc.store.recover()
    await svc.tick()
    assert len(fake.creates) == 1


async def test_success_with_malformed_response_also_needs_reconciliation(service_factory):
    fake = FakeShade()
    fake.create_response = httpx.Response(200, json={"unexpected": "payload"})
    svc, fake, req, order = await order_setup(service_factory, fake)
    await svc.tick()
    assert svc.store.get_order(order["id"])["state"] == "needs_reconciliation"


async def test_recovery_of_post_marker_and_reconcile_name_check(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    svc.store.transition(order["id"], "submitting")
    svc.store.recover()
    assert svc.store.get_order(order["id"])["state"] == "needs_reconciliation"
    fake.name = "some-other-instance"
    with pytest.raises(ValueError, match="instance_name"):
        await svc.reconcile(order["id"], "instance-test")
    fake.name = "spotbot-" + order["id"]
    assert (await svc.reconcile(order["id"], "instance-test"))["state"] == "provisioning"
    await svc.tick()
    assert len(fake.creates) == 0 and svc.store.get_order(order["id"])["state"] == "ready"


async def test_price_increase_blocks_then_inventory_can_resume(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    a = fake.catalog["instance_types"][0]["availability"][1]
    a["hourly_price"] = "2.01"
    await svc.tick()
    assert not fake.creates and svc.store.get_order(order["id"])["error"] == "price_exceeds_limit"
    a["hourly_price"] = "1.60"
    a["available"] = False
    await svc.tick()
    assert not fake.creates
    a["available"] = True
    await svc.tick()
    assert len(fake.creates) == 1
    assert svc.store.get_order(order["id"])["offer"]["price_hourly"] == "1.60"


async def test_expired_order_and_cancel_do_not_allocate(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    with svc.store.connect() as c:
        c.execute(
            "UPDATE orders SET expires_at=? WHERE id=?",
            ((utcnow() - timedelta(seconds=1)).isoformat(), order["id"]),
        )
    await svc.tick()
    assert not fake.creates and svc.store.get_order(order["id"])["state"] == "expired"
    other, _ = svc.create_order(req, "cancel-test")
    svc.cancel(other["id"])
    await svc.tick()
    assert not fake.creates


async def test_preemption_revokes_handoff_and_is_not_auto_rebought(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    await svc.tick()
    await svc.tick()
    fake.status = "deleting"
    await svc.tick()
    current = svc.store.get_order(order["id"])
    assert current["state"] == "preempted" and current["handoff"] is None
    await svc.tick()
    assert len(fake.creates) == 1


async def test_idempotent_replay_after_catalog_offer_disappears(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    fake.catalog["instance_types"] = []
    await svc.collect("shadeform")
    replay, created = svc.create_order(req, "test-idempotency")
    assert replay["id"] == order["id"] and not created


async def test_429_retries_but_401_fails(service_factory):
    svc, fake, req, order = await order_setup(service_factory)
    fake.create_response = httpx.Response(429)
    await svc.tick()
    assert svc.store.get_order(order["id"])["state"] == "queued"
    fake.create_response = httpx.Response(401)
    await svc.tick()
    assert svc.store.get_order(order["id"])["state"] == "failed"


async def test_webhook_outbox_signature_and_retry(service_factory):
    fake = FakeShade()
    callbacks = []

    def handler(req):
        if req.url.host == "gateway.test":
            callbacks.append(req)
            return httpx.Response(503 if len(callbacks) == 1 else 200)
        return fake(req)

    svc = service_factory(
        handler,
        spotbot_live_orders_enabled=True,
        spotbot_gateway_webhook_url="https://gateway.test/capacity",
        spotbot_gateway_webhook_secret=SecretStr("callback-secret"),
    )
    await svc.collect("shadeform")
    offer = next(o for o in svc.store.latest() if o.market == "spot")
    req = OrderRequest(
        offer_id=offer.offer_id, max_price_hourly="2", launch=LaunchOptions(ssh_key_id="key")
    )
    order, _ = svc.create_order(req, "webhook-test")
    await svc.tick()
    assert len(callbacks) == 1
    callback = callbacks[0]
    signed = callback.headers["X-SpotBot-Timestamp"].encode() + b"." + callback.content
    expected = "sha256=" + hmac.new(b"callback-secret", signed, hashlib.sha256).hexdigest()
    assert callback.headers["X-SpotBot-Signature"] == expected
    with svc.store.connect() as c:
        c.execute(
            "UPDATE events SET next_attempt_at=?", ((utcnow() - timedelta(seconds=1)).isoformat(),)
        )
    await svc.tick()
    assert callbacks[0].headers["X-SpotBot-Event-ID"] == callbacks[1].headers["X-SpotBot-Event-ID"]
    assert svc.store.events(order["id"])[0]["delivered_at"]


def test_process_lock_prevents_second_worker(settings):
    from spotbot.service import Service

    a, b = Service(settings), Service(settings)
    a.acquire()
    try:
        with pytest.raises(RuntimeError, match="already has a running"):
            b.acquire()
    finally:
        a.store.close()
