"""Account numbers, owner-bound history and authoritative Credit projections."""

import json

from tests.test_opennext_console import ADMIN, console  # noqa: F401


async def test_accounts_are_private_stable_and_use_the_terminal_ledger(console):  # noqa: F811
    client, backend, *_ = console
    directory = backend.snapshots.directory
    auth = json.loads((directory / "auth-state.json").read_text())
    auth["users"][1]["promotionalCredit"] = 100
    (directory / "auth-state.json").write_text(json.dumps(auth))
    assert (await client.get("/api/admin/accounts?userIds=u1")).status_code == 401
    response = await client.get("/api/admin/accounts?userIds=u1", headers=ADMIN)
    assert response.status_code == 200
    summary = response.json()["accounts"][0]
    assert summary["currentCreditCents"] == 10000
    assert summary["kybStatus"] == "NotStarted" and summary["bankAccountCount"] is None
    assert summary["accountNumber"].startswith("ON-")
    assert "u1" not in summary["accountNumber"]
    charge = await backend.accounts.ledger.hold("u1", "opennext-order-1", 4200, "offer")
    detail = (await client.get("/api/admin/accounts/u1", headers=ADMIN)).json()
    assert detail["account"]["accountNumber"] == summary["accountNumber"]
    assert detail["account"]["currentCreditCents"] == 5800
    assert len(detail["purchaseHistory"]["entries"]) == 2  # Instance hold and owned RFQ.
    assert detail["bankAccounts"] is None
    assert sum(r["amountCents"] for r in detail["creditHistory"]["entries"]) == 5800
    assert all(r["balanceAfterCents"] is None for r in detail["creditHistory"]["entries"])
    assert "private-oauth" not in json.dumps(detail)
    await backend.accounts.ledger.refund(charge, "test")
    refreshed = (await client.get("/api/admin/accounts/u1", headers=ADMIN)).json()
    assert refreshed["account"]["currentCreditCents"] == 10000
    assert any(
        r["kind"] == "Refund" and r["amountCents"] == 4200
        for r in refreshed["creditHistory"]["entries"]
    )
    console[3].append(
        dict(
            id="unlinked-rental",
            state="CLOSED",
            created_at="2026-10-28T00:00:00Z",
            rfq=dict(
                customer_ref="opennext:u1", gpu_model="T4", gpu_count=1, regions=["us-west-2"]
            ),
        )
    )
    history = (await client.get("/api/admin/accounts/u1", headers=ADMIN)).json()["purchaseHistory"][
        "entries"
    ]
    assert next(r for r in history if r["id"] == "unlinked-rental")["totalCents"] is None
    other = (await client.get("/api/admin/accounts/u2", headers=ADMIN)).json()
    assert other["purchaseHistory"]["entries"] == []
    assert other["creditHistory"]["entries"] == []
    assert (await client.get("/api/admin/accounts/unknown", headers=ADMIN)).status_code == 404
    assert (
        await client.get("/api/admin/accounts/u1?creditCursor=bad", headers=ADMIN)
    ).status_code == 400
    (directory / "credit-topups.initialized").write_text('{"version":1,"demo":false}')
    assert (await client.get("/api/admin/accounts/u1", headers=ADMIN)).status_code == 503


async def test_accounts_do_not_guess_a_corrupt_credit_ledger(console):  # noqa: F811
    client, backend, *_ = console
    path = backend.snapshots.directory / "credit-topups.json"
    path.write_text(
        json.dumps(
            dict(
                version=1,
                demo=False,
                requests=[],
                credits=[dict(requestId="missing", accountId="u1", amountCents=10000)],
            )
        )
    )
    assert (await client.get("/api/admin/accounts?userIds=u1", headers=ADMIN)).status_code == 503
    assert (await client.get("/api/admin/accounts?userIds=", headers=ADMIN)).status_code == 400
