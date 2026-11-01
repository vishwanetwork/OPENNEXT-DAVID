"""Private customer account projections; balances use the Terminal's ledger rules."""

import asyncio
import secrets
import uuid
from decimal import Decimal

import httpx
from fastapi import Request

from spotbot.models import timestamp
from spotbot.opennext_console_data import order_rows, page
from spotbot.opennext_ledger import account_id, adjusted_account
from spotbot.opennext_ops import OperationError
from spotbot.storage.workflows import ConflictError


def cents(value):
    result = Decimal(str(value or 0)) * 100
    if not result.is_finite() or result != result.to_integral_value():
        raise OperationError(503, "The recorded Credit balance is invalid.")
    return int(result)


class Accounts:
    def __init__(self, console, ledger):
        self.console, self.ledger = console, ledger
        self.db, self.ops, self.snapshots = console.db, console.ops, console.snapshots

    async def number(self, user_id):
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, "opennext-account:" + user_id))
        doc = await asyncio.to_thread(self.db.get, "opennext_account", identity)
        if not doc:
            doc = dict(
                id=identity,
                kind="opennext_account",
                tenant_id=account_id(user_id),
                account=user_id,
                account_number="ON-" + secrets.token_hex(8).upper(),
            )
            try:
                await asyncio.to_thread(self.db.save, doc, 0)
            except ConflictError:
                doc = await asyncio.to_thread(self.db.get, "opennext_account", identity)
        return doc["account_number"]

    async def source(self):
        auth = await asyncio.to_thread(self.snapshots.read, "auth-state.json")
        users = auth.get("users")
        if not isinstance(users, list):
            raise OperationError(503, "The account directory is unavailable.")
        # Match the legacy service's uninitialized-ledger semantics, without creating files.
        directory = self.snapshots.directory
        if directory and not (directory / "credit-topups.json").exists():
            if (directory / "credit-topups.initialized").exists():
                raise OperationError(503, "The Credit ledger is unavailable.")
            legacy = {"version": 1, "demo": False, "credits": [], "requests": []}
        else:
            legacy = await asyncio.to_thread(self.snapshots.read, "credit-topups.json")
        if (
            legacy.get("version") != 1
            or legacy.get("demo") is not False
            or not all(isinstance(legacy.get(k), list) for k in ("credits", "requests"))
        ):
            raise OperationError(503, "The Credit ledger is unavailable.")
        approved = {r["id"]: r for r in legacy["requests"] if r.get("status") == "Approved"}
        seen = set()
        for credit in legacy["credits"]:
            receipt = approved.get(credit.get("requestId"))
            if (
                not receipt
                or credit.get("requestId") in seen
                or credit.get("accountId") != receipt.get("accountId")
                or type(credit.get("amountCents")) is not int
                or credit["amountCents"] != receipt.get("amountCents")
            ):
                raise OperationError(503, "The Credit ledger could not be verified.")
            seen.add(credit["requestId"])
        if set(approved) != seen:
            raise OperationError(503, "The Credit ledger could not be verified.")
        return {u["id"]: u for u in users if isinstance(u, dict) and u.get("id")}, legacy

    async def summary(self, user_id, source):
        users, legacy = source
        user = users.get(user_id)
        if not user:
            raise OperationError(404, "Customer account not found.")
        base = dict(
            promotionalCredit=cents(user.get("promotionalCredit")) / 100,
            paidCredit=sum(c["amountCents"] for c in legacy["credits"] if c["accountId"] == user_id)
            / 100,
        )
        charges = await self.ledger.charges(user_id)
        balance = adjusted_account(base, charges, await self.ops.credits(user_id))
        kyb = await self.ops.kyb_case(user_id)
        return dict(
            userId=user_id,
            accountNumber=await self.number(user_id),
            kybStatus=kyb["status"] if kyb else "NotStarted",
            currency="USD",
            currentCreditCents=cents(balance["availableCredit"]),
            bankAccountCount=None,
        )

    async def details(self, user_id, source, credit_cursor, purchase_cursor):
        summary = await self.summary(user_id, source)
        users, legacy = source
        entries = []
        user = users[user_id]
        if cents(user.get("promotionalCredit")):
            entries.append(
                dict(
                    id="welcome",
                    kind="Adjustment",
                    amountCents=cents(user["promotionalCredit"]),
                    reference=None,
                    description="Recorded promotional Credit",
                    at=user.get("welcomeCreditGrantedAt") or user["createdAt"],
                )
            )
        for c in legacy["credits"]:
            if c["accountId"] == user_id:
                receipt = next(r for r in legacy["requests"] if r["id"] == c["requestId"])
                entries.append(
                    dict(
                        id=c["requestId"],
                        kind="Top-up",
                        amountCents=c["amountCents"],
                        reference=c["requestId"],
                        description="Confirmed Credit top-up",
                        at=c.get("createdAt") or receipt.get("reviewedAt") or receipt["createdAt"],
                    )
                )
        for transfer in await self.ops.transfers(user_id=user_id):
            credited = await self.ops.credits_for_transfer(transfer)
            if credited:
                entries.append(
                    dict(
                        id=transfer["id"],
                        kind="Top-up" if transfer["purpose"] == "topup" else "Refund",
                        amountCents=credited,
                        reference=transfer["reference"],
                        description="Confirmed top-up"
                        if transfer["purpose"] == "topup"
                        else "Direct Pay receipt funding",
                        at=transfer["decision"]["at"],
                    )
                )
        charges = await self.ledger.charges(user_id)
        for charge in charges:
            if charge["state"] in {"held", "charged", "billed", "refunded"}:
                entries.append(
                    dict(
                        id=charge["id"],
                        kind="Purchase",
                        amountCents=-charge["cents"],
                        reference=charge.get("reference"),
                        description="Reserved purchase Credit",
                        at=charge["created_at"],
                    )
                )
                released = (
                    charge["cents"]
                    if charge["state"] == "refunded"
                    else charge.get("released_cents", 0)
                )
                if released:
                    entries.append(
                        dict(
                            id=charge["id"] + "-release",
                            kind="Refund",
                            amountCents=released,
                            reference=charge.get("reference"),
                            description="Released unused purchase Credit",
                            at=charge.get("refunded_at")
                            or charge.get("billed_at")
                            or charge["created_at"],
                        )
                    )
        entries.sort(key=lambda r: (r["at"], r["id"]), reverse=True)
        # Historic balance-after is unknown: current snapshots cannot reconstruct past revisions.
        entries = [dict(r, balanceAfterCents=None) for r in entries]
        credit_rows, credit_next = page(entries, credit_cursor, 50)
        rentals = [
            r
            for r in await self.console.rentals()
            if r["rfq"].get("customer_ref") == account_id(user_id)
        ]
        marketplace = await asyncio.to_thread(self.snapshots.read, "marketplace.json")
        legacy_orders = [o for o in marketplace.get("orders", []) if o.get("buyerId") == user_id]
        orders = order_rows(
            rentals, charges, legacy_orders, [], await self.ops.transfers(user_id=user_id)
        )
        purchases = [
            dict(
                id=r["id"],
                kind=r["kind"],
                model=r["model"],
                capacity=r["gpuCount"],
                totalCents=None if r.get("amountKnown") is False else cents(r["total"]),
                currency="USD",
                status=r["status"],
                purchasedAt=r["submittedAt"],
            )
            for r in orders
        ]
        purchase_rows, purchase_next = page(purchases, purchase_cursor, 50)
        return dict(
            account=summary,
            bankAccounts=None,
            creditHistory=dict(entries=credit_rows, nextCursor=credit_next),
            purchaseHistory=dict(entries=purchase_rows, nextCursor=purchase_next),
        )


def install(app, ctx, console):
    accounts = Accounts(console, ctx.ledger)
    console.accounts = accounts

    async def guarded(request, action):
        scope, failed = await ctx.admin_session(request)
        if failed:
            return failed
        try:
            result = await action()
            await console.audit(scope, "Account records viewed", request.url.path)
            return ctx.no_store(
                dict(confirmed=True, demo=False, sessionScope=scope, asOf=timestamp(), **result)
            )
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return ctx.error(503, "Account records are temporarily unavailable.")

    @app.get("/api/admin/accounts")
    async def summaries(request: Request, userIds: str = ""):
        async def read():
            ids = list(dict.fromkeys(userIds.split(",")))
            if not userIds or len(userIds) > 8000 or len(ids) > 100 or any(not i for i in ids):
                raise OperationError(400, "Select between one and 100 customer accounts.")
            source = await accounts.source()
            return dict(accounts=[await accounts.summary(i, source) for i in ids])

        return await guarded(request, read)

    @app.get("/api/admin/accounts/{user_id}")
    async def details(
        request: Request, user_id: str, creditCursor: str = "", purchaseCursor: str = ""
    ):
        async def read():
            return await accounts.details(
                user_id, await accounts.source(), creditCursor, purchaseCursor
            )

        return await guarded(request, read)

    return accounts
