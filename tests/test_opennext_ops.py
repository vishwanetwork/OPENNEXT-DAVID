"""Buyer KYB, bank transfers, payment review, Direct Pay provisioning and instance usage."""

import asyncio
import base64
from datetime import datetime, timedelta

from tests.test_opennext_market import HOST, Outbox, balance, body, buy, env  # noqa: F401

ADMIN = {"Cookie": "on_pricing_admin=ok", "Origin": "http://" + HOST}
PDF = b"%PDF-1.4\n" + b"x" * 64
KINDS = (
    "legal-presence",
    "ownership-structure",
    "proof-of-address",
    "company-details",
    "representative-authorization",
)
COMPANY = {
    "country": "SG",
    "companyName": "Example Pte Ltd",
    "registrationNumber": "201912345A",
    "email": "ceo@example.sg",
    "website": "",
    "taxId": "T19LL1234A",
    "monthlyVolumeUsd": "5000",
    "monthlyTransactions": "10",
    "businessDescription": "Model training",
    "incorporationDate": "",
    "legalForm": "",
    "legalAddress": "",
    "phone": "",
}


def headers(cookie="session=fresh", csrf="csrf-4"):
    return {"Cookie": cookie, "X-CSRF-Token": csrf, "Origin": "http://" + HOST}


def upload(client, kind, data=PDF, content_type="application/pdf", **kwargs):
    payload = {
        "kind": kind,
        "fileName": f"{kind}.pdf",
        "contentType": content_type,
        "dataBase64": base64.b64encode(data).decode(),
    }
    return client.post("/api/buyer-kyb/documents", json=payload, headers=headers(**kwargs))


async def submit_kyb(client):
    ids = [(await upload(client, kind)).json()["document"]["id"] for kind in KINDS]
    payload = {
        "company": COMPANY,
        "mode": "Auto",
        "consent": True,
        "idempotencyKey": "kyb-1",
        "documentIds": ids,
    }
    return await client.post("/api/buyer-kyb/submissions", json=payload, headers=headers())


async def test_buyer_kyb_from_upload_to_approval_with_notice_and_email(env):  # noqa: F811
    client, fakes, _ = env
    # Unverified buyers cannot buy with Credit or start a bank transfer.
    refused = await buy(client, body(), cookie="session=fresh", csrf="csrf-4")
    assert refused.status_code == 403 and refused.json()["code"] == "KYB_REQUIRED"
    me = await client.get("/api/buyer-kyb/me", headers={"Cookie": "session=fresh"})
    assert me.json() == {"confirmed": True, "accountId": "U4", "demo": False, "verification": None}
    # The content must match the declared type.
    fake = await upload(client, "legal-presence", data=b"MZ\x90\x00 not a pdf")
    assert fake.status_code == 400
    # Every category is required.
    partial = await client.post(
        "/api/buyer-kyb/submissions",
        json={
            "company": COMPANY,
            "mode": "Auto",
            "consent": True,
            "idempotencyKey": "kyb-0",
            "documentIds": [(await upload(client, "legal-presence")).json()["document"]["id"]],
        },
        headers=headers(),
    )
    assert partial.status_code == 400
    submitted = await submit_kyb(client)
    case = submitted.json()["verification"]
    assert (case["status"], case["mode"], case["revision"]) == ("Reviewing", "Auto", 1)
    assert [d["kind"] for d in case["documents"]] == list(KINDS)
    # Retrying the same submission returns the same case.
    again = await submit_kyb(client)
    assert again.json()["verification"]["revision"] == 1

    assert (await client.get("/api/admin/buyer-kyb")).status_code == 401
    queue = (await client.get("/api/admin/buyer-kyb", headers=ADMIN)).json()
    assert queue["confirmed"] is True and queue["sessionScope"].startswith("ops-")
    [row] = [c for c in queue["cases"] if c["accountId"] == "U4"]
    doc = row["documents"][0]
    download = await client.get(
        f"/api/admin/buyer-kyb/{row['id']}/documents/{doc['id']}?revision=1", headers=ADMIN
    )
    assert base64.b64decode(download.json()["dataBase64"]) == PDF
    decision = {
        "expectedRevision": 1,
        "decision": "Approved",
        "reason": "",
        "allscaleApproved": False,
        "idempotencyKey": "decide-1",
    }
    url = f"/api/admin/buyer-kyb/{row['id']}/decision"
    assert (await client.post(url, json=decision, headers=ADMIN)).status_code == 400
    decision["allscaleApproved"] = True
    # Operator writes must come from the Console's own origin.
    crossed = await client.post(url, json=decision, headers={"Cookie": "on_pricing_admin=ok"})
    assert crossed.status_code == 403
    receipt = (await client.post(url, json=decision, headers=ADMIN)).json()
    assert receipt == {
        "confirmed": True,
        "caseId": row["id"],
        "accountId": "U4",
        "idempotencyKey": "decide-1",
        "status": "Approved",
        "revision": 2,
        "notificationQueued": True,
        "emailQueued": True,
    }
    # A retried decision returns the original receipt; another one is stale.
    assert (await client.post(url, json=decision, headers=ADMIN)).json() == receipt
    stale = await client.post(url, json={**decision, "idempotencyKey": "decide-2"}, headers=ADMIN)
    assert stale.status_code == 409

    account = (await balance(client, cookie="session=fresh")).json()
    [notice] = account["notifications"]
    assert notice["kybStatus"] == "Approved" and notice["ownerId"] == "U4"
    notifier = client._transport.app.state.notifier
    outbox = notifier.mailer = Outbox()
    await notifier.tick()
    await notifier.tick()  # Delivered once.
    [(to, subject, text)] = outbox.messages
    assert to == "u4@example.com" and subject == "Business verification complete"
    assert "You can now add Credit" in text


async def transfer(client, payload, cookie="session=buyer", csrf="csrf-1"):
    return await client.post(
        "/api/billing/bank-transfer-intents",
        json=payload,
        headers={"Cookie": cookie, "X-CSRF-Token": csrf, "Origin": "http://" + HOST},
    )


def topup_request(cents, key):
    return {
        "purpose": "topup",
        "amountCents": cents,
        "currency": "USD",
        "pricingVersion": "credit-face-value-v1",
        "creditAmountCents": cents,
        "feeAmountCents": 0,
        "idempotencyKey": key,
    }


async def decide(client, record, decision, **extra):
    payload = {
        "caseId": record["id"],
        "accountId": record["accountId"],
        "expectedRevision": record["revision"],
        "idempotencyKey": "op-" + record["id"],
        "decision": decision,
        "fundsVerified": decision == "Confirm",
        "reason": "",
        **extra,
    }
    return await client.post(
        f"/api/admin/payment-requests/{record['id']}/decision", json=payload, headers=ADMIN
    )


async def test_top_ups_add_their_full_amount_or_fail_with_a_reason(env):  # noqa: F811
    client, _, _ = env
    # A top-up fee is refused: Credit is face value.
    fee = await transfer(client, {**topup_request(1000, "t-0"), "creditAmountCents": 950})
    assert fee.status_code == 400
    intent = (await transfer(client, topup_request(1000, "t-1"))).json()
    assert intent["purpose"] == "topup" and intent["amountCents"] == 1000
    assert intent["creditAmountCents"] == 1000 and intent["feeAmountCents"] == 0
    assert intent["reference"].startswith("ONX-") and intent["idempotencyKey"] == "t-1"
    # Retrying returns the same intent; reusing the key for another amount does not.
    assert (await transfer(client, topup_request(1000, "t-1"))).json()["id"] == intent["id"]
    assert (await transfer(client, topup_request(2000, "t-1"))).status_code == 409
    sent = await client.post(
        f"/api/billing/bank-transfer-intents/{intent['id']}/report-sent",
        json={"idempotencyKey": "r-1"},
        headers={"Cookie": "session=buyer", "X-CSRF-Token": "csrf-1", "Origin": "http://" + HOST},
    )
    assert sent.json() == {
        "confirmed": True,
        "intentId": intent["id"],
        "status": "Awaiting payment confirmation",
    }
    queue = (await client.get("/api/admin/payment-requests?kind=topup", headers=ADMIN)).json()
    [record] = queue["records"]
    assert (record["status"], record["pricingVersion"], record["creditAmountCents"]) == (
        "Pending",
        "credit-face-value-v1",
        1000,
    )
    unverified = await decide(client, record, "Confirm", fundsVerified=False)
    assert unverified.status_code == 400
    receipt = (await decide(client, record, "Confirm")).json()
    assert (receipt["ledgerPosted"], receipt["provisioningQueued"]) == (True, False)
    assert (receipt["creditAmountCents"], receipt["revision"]) == (1000, 2)
    account = (await balance(client)).json()
    assert account["availableCredit"] == 11.5  # $1.50 before, plus $10.00.
    assert account["notifications"][0]["subject"] == "Credit top-up complete"

    failed_intent = (await transfer(client, topup_request(500, "t-2"))).json()
    queue = (await client.get("/api/admin/payment-requests?kind=topup", headers=ADMIN)).json()
    record = next(r for r in queue["records"] if r["id"] == failed_intent["id"])
    assert (await decide(client, record, "Fail")).status_code == 400  # A reason is required.
    receipt = (await decide(client, record, "Fail", reason="No transfer arrived")).json()
    assert receipt["status"] == "Failed" and receipt["ledgerPosted"] is False
    account = (await balance(client)).json()
    assert account["availableCredit"] == 11.5
    assert any("Reason: No transfer arrived" in n["message"] for n in account["notifications"])


async def test_direct_pay_provisions_once_and_returns_unused_time_as_credit(env):  # noqa: F811
    client, fakes, _ = env
    order = {
        "purpose": "order",
        "amountCents": 62,
        "currency": "USD",
        "offerId": "spotbot-us-west-2-g6.xlarge",
        "durationHours": 1.5,
        "purchaseReference": "purchase-1",
        "sshPublicKey": None,
        "idempotencyKey": "d-1",
    }
    # The amount must be the current purchase total including the 5% fee.
    assert (await transfer(client, {**order, "amountCents": 59})).status_code == 409
    intent = (await transfer(client, order)).json()
    assert intent["offerId"] == order["offerId"] and "pricingVersion" not in intent
    queue = (await client.get("/api/admin/payment-requests?kind=direct_pay", headers=ADMIN)).json()
    [record] = queue["records"]
    assert record["pricingVersion"] == "order-total-v1" and record["orderId"].startswith(
        "opennext-"
    )
    receipt = (await decide(client, record, "Confirm")).json()
    assert (receipt["provisioningQueued"], receipt["ledgerPosted"]) == (True, False)
    assert receipt["creditAmountCents"] == 0
    # The order is created in the background, under the payment's own reference.
    for _ in range(50):
        if fakes.created:
            break
        await asyncio.sleep(0.01)
    [rfq] = fakes.created
    assert rfq["upstream_order_id"] == record["orderId"] and rfq["service_seconds"] == 5400
    # Retried provisioning finds the rental instead of ordering again.
    await client._transport.app.state.notifier.tick()
    assert len(fakes.created) == 1
    # The payment is held for the order, so the balance is unchanged while it runs.
    assert (await balance(client)).json()["availableCredit"] == 1.5
    start = datetime.fromisoformat("2026-10-28T01:06:00+00:00")
    fakes.rentals[0].update(
        state="CLOSED",
        delivering_at="2026-10-28T01:05:00+00:00",
        service_intervals=[
            {"start": start.isoformat(), "end": (start + timedelta(minutes=20)).isoformat()}
        ],
    )
    # 20 minutes bill the 1-hour minimum (41 cents); the other 21 cents become Credit.
    assert (await balance(client)).json()["availableCredit"] == 1.71


async def test_usage_snapshot_matches_the_terminal_contract(env):  # noqa: F811
    client, fakes, calls = env
    assert (await buy(client, body())).status_code == 200
    rental = fakes.rentals[0]
    t = datetime.fromisoformat("2026-10-28T01:06:00+00:00")
    iso = lambda minutes: (t + timedelta(minutes=minutes)).isoformat()  # noqa: E731
    rental.update(
        state="CLOSED",
        end_requested=True,
        delivering_at=iso(-1),
        closed_at=iso(100),
        current_backup_id="b-1",
        service_intervals=[
            {"start": iso(0), "end": iso(50), "end_reason": "interrupted"},
            {"start": iso(60), "end": iso(95), "end_reason": "ended"},
        ],
    )
    other = await client.get(
        f"/api/marketplace/instances/{rental['id']}/usage", headers={"Cookie": "session=other"}
    )
    assert other.status_code == 404
    calls.clear()
    snap = (
        await client.get(
            f"/api/marketplace/instances/{rental['id']}/usage", headers={"Cookie": "session=buyer"}
        )
    ).json()
    assert not any(r.url.path == "/v1/rentals" for r in calls)
    assert (snap["accountId"], snap["instanceId"], snap["purchasedHours"]) == (
        "U1",
        rental["id"],
        1.5,
    )
    assert snap["retainedDataConfirmed"] is True
    assert [(i["state"], i["startedAt"], i["endedAt"]) for i in snap["intervals"]] == [
        ("connected", iso(0), iso(50)),
        ("interrupted", iso(50), iso(60)),
        ("connected", iso(60), iso(95)),
    ]
    assert [(e["type"], e["initiatedBy"]) for e in snap["events"]] == [
        ("started", "platform"),
        ("interrupted", "provider"),
        ("reconnected", "platform"),
        ("ended", "user"),
    ]
    billing = snap["billing"]
    # 85 minutes: ceil(39 * 85 / 60) = 56 compute + 3 fee = 59, under the 62 hold.
    assert (billing["totalCents"], billing["complete"]) == (59, True)
    entries = billing["entries"]
    assert [e["billableSeconds"] for e in entries] == [3000 + 0, 35 * 60]
    assert sum(e["totalCents"] for e in entries) == 59
    assert sum(e["feeCents"] for e in entries) == 3
    assert all(e["totalCents"] == e["computeCents"] + e["feeCents"] for e in entries)
    assert billing["startedAt"] == iso(0) and billing["stoppedAt"] == iso(95)


def test_documents_are_encrypted_at_rest_and_bound_to_their_id(tmp_path):
    import os

    import pytest
    from cryptography.exceptions import InvalidTag

    from spotbot.opennext_files import StorageUnavailable, Vault

    vault = Vault(tmp_path, base64.b64encode(os.urandom(32)).decode(), allow_unscanned=True)
    assert vault.check(PDF) == "not_scanned"
    vault.write("a/DOC-1", "DOC-1", PDF)
    stored = (tmp_path / "a/DOC-1").read_bytes()
    assert stored.startswith(b"ONX1") and b"%PDF" not in stored
    assert oct((tmp_path / "a/DOC-1").stat().st_mode & 0o777) == "0o600"
    assert vault.read("a/DOC-1", "DOC-1") == PDF
    with pytest.raises(InvalidTag):  # A file moved onto another document does not open.
        vault.read("a/DOC-1", "DOC-2")
    # Without a key, or without a scanner outside local testing, nothing is stored.
    with pytest.raises(StorageUnavailable):
        Vault(tmp_path, "", allow_unscanned=True).check(PDF)
    with pytest.raises(StorageUnavailable):
        Vault(tmp_path, base64.b64encode(bytes(32)).decode()).check(PDF)


def test_uploads_are_scanned_by_clamd(tmp_path):
    import socket
    import struct
    import threading

    import pytest

    from spotbot.opennext_files import Infected, StorageUnavailable, Vault

    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()
    seen = []

    def serve():
        for _ in range(2):
            conn, _ = server.accept()
            with conn:
                buffer = b""
                while not buffer.endswith(struct.pack(">I", 0)):
                    buffer += conn.recv(65536)
                payload = buffer[len(b"zINSTREAM\0") :]
                seen.append(payload)
                infected = b"EICAR" in payload
                conn.sendall(
                    b"stream: Eicar-Test-Signature FOUND\0" if infected else b"stream: OK\0"
                )

    threading.Thread(target=serve, daemon=True).start()
    address = f"127.0.0.1:{server.getsockname()[1]}"
    vault = Vault(tmp_path, base64.b64encode(bytes(32)).decode(), clamd=address)
    assert vault.check(PDF) == "clean"
    with pytest.raises(Infected):
        vault.check(PDF + b"EICAR")
    assert seen[0].startswith(struct.pack(">I", len(PDF)) + PDF)
    server.close()
    with pytest.raises(StorageUnavailable):  # The scanner is down: refuse, never skip.
        vault.check(PDF)


async def test_retention_deletes_unsubmitted_uploads_and_decided_documents(env):  # noqa: F811
    client, _, _ = env
    ops = client._transport.app.state.ops
    stray = (await upload(client, "legal-presence")).json()["document"]["id"]
    await submit_kyb(client)
    queue = (await client.get("/api/admin/buyer-kyb", headers=ADMIN)).json()
    [row] = [c for c in queue["cases"] if c["accountId"] == "U4"]
    decision = {
        "expectedRevision": 1,
        "decision": "Rejected",
        "reason": "Blurred certificate",
        "allscaleApproved": False,
        "idempotencyKey": "decide-r",
    }
    await client.post(f"/api/admin/buyer-kyb/{row['id']}/decision", json=decision, headers=ADMIN)
    doc = row["documents"][0]
    url = f"/api/admin/buyer-kyb/{row['id']}/documents/{doc['id']}?revision=2"
    assert (await client.get(url, headers=ADMIN)).status_code == 200
    from spotbot.opennext_ops import utcnow

    assert await ops.purge(utcnow() + timedelta(hours=25)) == 1  # Only the stray upload.
    assert (await ops.db_get_document(stray))["deleted_at"]
    assert await ops.purge(utcnow() + timedelta(days=366)) == 5
    assert (await client.get(url, headers=ADMIN)).status_code == 410
