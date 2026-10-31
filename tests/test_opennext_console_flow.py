"""A customer payment becomes one operator order and one delivered Terminal instance."""

import asyncio
import json
from datetime import timedelta

from spotbot.models import timestamp, utcnow
from tests.test_opennext_market import Outbox, env  # noqa: F401
from tests.test_opennext_ops import ADMIN, decide, transfer


async def test_direct_pay_console_and_terminal_share_the_same_order(env, tmp_path):  # noqa: F811
    client, fakes, _ = env
    app = client._transport.app
    app.state.console_backend.snapshots.directory = tmp_path
    (tmp_path / "auth-state.json").write_text(
        json.dumps(
            {"users": [dict(id="U1", email="u1@example.com", role="buyer", createdAt=timestamp())]}
        )
    )
    (tmp_path / "marketplace.json").write_text(json.dumps({"orders": [], "rfqs": [], "audit": []}))
    outbox = app.state.notifier.mailer = Outbox()
    request = dict(
        purpose="order",
        amountCents=62,
        currency="USD",
        offerId="spotbot-us-west-2-g6.xlarge",
        durationHours=1.5,
        idempotencyKey="console-flow",
        sshPublicKey=None,
    )
    created = await transfer(client, request)
    assert created.status_code == 200
    review = (
        await client.get("/api/admin/payment-requests?kind=direct_pay", headers=ADMIN)
    ).json()["records"][0]
    before = (await client.get("/api/admin/orders", headers=ADMIN)).json()["orders"]
    assert len(before) == 1 and before[0]["id"] == review["orderId"]
    assert (await client.get("/api/admin/overview", headers=ADMIN)).json()["metrics"][
        "pendingPayments"
    ] == 1
    assert (await decide(client, review, "Confirm")).status_code == 200
    for _ in range(50):
        if fakes.created:
            break
        await asyncio.sleep(0.01)
    await app.state.notifier.tick()
    assert len(fakes.created) == 1
    after = (await client.get("/api/admin/orders", headers=ADMIN)).json()["orders"]
    assert len(after) == 1 and after[0]["id"] == before[0]["id"]
    start = (utcnow() - timedelta(seconds=30)).isoformat()
    rental = fakes.rentals[0]
    rental.update(
        tenant_id="opennext",
        state="ACTIVE",
        end_requested=False,
        delivering_at=start,
        service_intervals=[dict(start=start, end=None)],
    )
    await app.state.notifier.tick()
    terminal = (await client.get("/api/marketplace/me", headers={"Cookie": "session=buyer"})).json()
    assert any(row["id"] == rental["id"] for row in terminal["instances"])
    allocations = (await client.get("/api/admin/instances", headers=ADMIN)).json()["instances"]
    assert allocations[0]["id"] == rental["id"] and allocations[0]["lifecycle"] == "Running"
    subjects = [message[1] for message in outbox.messages]
    assert "Payment complete" in subjects
    assert "Your 1 × L4 Spot server is running" in subjects
    assert (await client.get("/api/admin/overview", headers=ADMIN)).json()["metrics"][
        "pendingPayments"
    ] == 0
