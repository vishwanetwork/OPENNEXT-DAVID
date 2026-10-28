"""Spot purchase Credit for OpenNEXT accounts.

The existing OpenNEXT API keeps each account's Credit (approved top-ups plus promotional
Credit) and has no debits. This ledger records one charge per Spot purchase in the bot's
database and subtracts the open charges from that Credit, promotional Credit first.

- A charge is held before the rental is requested and becomes `charged` once the bot accepts
  it. Its identity is the purchase reference, so a retried purchase never charges twice.
- A charge is refunded in full when the bot refuses the rental, when no rental appeared for a
  held charge, or when the rental ended without ever being handed to the customer. Ending a
  delivered rental early is not refunded (the duration is prepaid).

Charges for one account are serialized in this process; run a single adapter instance.
"""

import asyncio
from collections import defaultdict
from datetime import timedelta

from spotbot.models import timestamp, utcnow
from spotbot.rentals import at
from spotbot.storage.workflows import ConflictError

KIND = "opennext_charge"
OPEN = {"held", "charged"}
# A held charge without a rental after this long was never accepted by the bot.
HELD_GRACE = timedelta(minutes=10)


def account_id(user_id):
    return "opennext:" + user_id


def undelivered(rental):
    """The rental ended before the customer ever received a server."""
    return rental["state"] == "CLOSED" and not rental.get("delivering_at")


class CreditLedger:
    def __init__(self, db):
        self.db = db
        self.locks = defaultdict(asyncio.Lock)

    def lock(self, user_id):
        return self.locks[user_id]

    async def charges(self, user_id):
        return await asyncio.to_thread(self.db.list, KIND, account_id(user_id))

    async def _save(self, charge, **changes):
        updated = dict(charge, **changes)
        await asyncio.to_thread(self.db.save, updated, charge["version"])
        updated["version"] = charge["version"] + 1
        return updated

    async def hold(self, user_id, reference, cents, offer_id):
        """Hold `cents` for the purchase `reference`; an existing charge is returned as is."""
        charge = dict(
            id=reference.removeprefix("opennext-"),
            kind=KIND,
            tenant_id=account_id(user_id),
            reference=reference,
            offer_id=offer_id,
            cents=cents,
            state="held",
            rental_id=None,
            created_at=timestamp(),
            version=0,
        )
        try:
            await asyncio.to_thread(self.db.save, charge, 0)
        except ConflictError:
            return await asyncio.to_thread(self.db.get, KIND, charge["id"])
        return dict(charge, version=1)

    async def settle(self, charge, rental_id):
        if charge["state"] == "charged" and charge["rental_id"] == rental_id:
            return charge
        return await self._save(
            charge, state="charged", rental_id=rental_id, charged_at=timestamp()
        )

    async def refund(self, charge, reason):
        if charge["state"] not in OPEN:
            return charge
        return await self._save(charge, state="refunded", refunded_at=timestamp(), reason=reason)

    async def reconcile(self, user_id, rentals):
        """Settle or refund charges against the customer's rentals; returns open charges."""
        by_reference = {r["rfq"].get("upstream_order_id"): r for r in rentals}
        result = []
        for charge in await self.charges(user_id):
            rental = by_reference.get(charge["reference"])
            if charge["state"] == "held" and rental:
                charge = await self.settle(charge, rental["id"])
            elif charge["state"] == "held" and utcnow() - at(charge["created_at"]) > HELD_GRACE:
                charge = await self.refund(charge, "rental_not_created")
            if charge["state"] == "charged" and rental and undelivered(rental):
                charge = await self.refund(charge, "not_delivered")
            if charge["state"] in OPEN:
                result.append(charge)
        return result


def adjusted_account(account, charges):
    """The existing API's Credit view less open Spot charges, promotional Credit first."""
    spent = sum(c["cents"] for c in charges if c["state"] in OPEN)
    promotional = round(float(account.get("promotionalCredit") or 0) * 100)
    paid = round(float(account.get("paidCredit") or 0) * 100)
    from_promotional = min(spent, promotional)
    promotional -= from_promotional
    # A paid balance never shows negative (e.g. after an operator reversed a top-up).
    paid = max(0, paid - (spent - from_promotional))
    return dict(
        account,
        promotionalCredit=promotional / 100,
        paidCredit=paid / 100,
        availableCredit=max(0, promotional + paid) / 100,
        spotCharges=[
            dict(
                orderId=c["rental_id"],
                totalCents=c["cents"],
                state=c["state"],
                createdAt=c["created_at"],
            )
            for c in sorted(charges, key=lambda c: c["created_at"], reverse=True)
        ],
    )
