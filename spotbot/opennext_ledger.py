"""Spot purchase Credit for OpenNEXT accounts.

The existing OpenNEXT API keeps each account's Credit (approved top-ups plus promotional
Credit) and has no debits. This ledger records one charge per Spot purchase in the bot's
database and subtracts the open charges from that Credit, promotional Credit first.

- A charge is held before the rental is requested and becomes `charged` once the bot accepts
  it. Its identity is the purchase reference, so a retried purchase never charges twice.
- A charge is refunded in full when the bot refuses the rental, when no rental appeared for a
  held charge, or when the rental ended without ever being handed to the customer.
- Usage billing (charges with `hourly_cents`): the held amount is the order's maximum. When a
  delivered rental closes, the charge is `billed` for the time the customer had a server, per
  started minute with a one-hour minimum, plus the 5% fee; the rest of the hold is released.
  Earlier charges have no `hourly_cents` and stay prepaid.

Charges for one account are serialized in this process; run a single adapter instance.
"""

import asyncio
import math
from collections import defaultdict
from datetime import timedelta

from spotbot.models import timestamp, utcnow
from spotbot.opennext_market import js_int
from spotbot.rentals import at, service_seconds
from spotbot.storage.workflows import ConflictError

KIND = "opennext_charge"
OPEN = {"held", "charged"}
# States that count against the account's Credit: open holds and billed usage.
COUNTED = OPEN | {"billed"}
MINIMUM_MINUTES = 60
# A held charge without a rental after this long was never accepted by the bot.
HELD_GRACE = timedelta(minutes=10)


def account_id(user_id):
    return "opennext:" + user_id


def amount(charge):
    """Cents the charge takes from the account's Credit."""
    if charge["state"] == "billed":
        return charge["billed_cents"]
    return charge["cents"] if charge["state"] in OPEN else 0


def usage_cents(hourly_cents, seconds):
    """Per started minute with a one-hour minimum, plus the checkout's 5% fee."""
    minutes = max(MINIMUM_MINUTES, math.ceil(seconds / 60))
    base = math.ceil(hourly_cents * minutes / 60)
    return base + js_int(base / 20)


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

    async def hold(self, user_id, reference, cents, offer_id, *, hourly_cents=None, email=None):
        """Hold `cents` for the purchase `reference`; an existing charge is returned as is.

        With `hourly_cents`, the hold is the maximum and the charge is billed by usage. `email`
        is where the customer's order notices go.
        """
        charge = dict(
            id=reference.removeprefix("opennext-"),
            kind=KIND,
            tenant_id=account_id(user_id),
            reference=reference,
            offer_id=offer_id,
            cents=cents,
            state="held",
            rental_id=None,
            hourly_cents=hourly_cents,
            email=email,
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

    async def bill(self, charge, seconds):
        if charge["state"] != "charged":
            return charge
        billed = min(charge["cents"], usage_cents(charge["hourly_cents"], seconds))
        return await self._save(
            charge,
            state="billed",
            billed_cents=billed,
            released_cents=charge["cents"] - billed,
            service_seconds=round(seconds),
            billed_at=timestamp(),
        )

    async def reconcile(self, user_id, rentals, *, complete=True):
        """Settle, bill or refund charges against the customer's rentals.

        Returns the charges that count against the account's Credit.
        """
        by_reference = {r["rfq"].get("upstream_order_id"): r for r in rentals}
        result = []
        for charge in await self.charges(user_id):
            rental = by_reference.get(charge["reference"])
            if charge["state"] == "held" and rental:
                charge = await self.settle(charge, rental["id"])
            elif complete and charge["state"] == "held" and utcnow() - at(charge["created_at"]) > HELD_GRACE:
                charge = await self.refund(charge, "rental_not_created")
            if charge["state"] == "charged" and rental and undelivered(rental):
                charge = await self.refund(charge, "not_delivered")
            if (
                charge["state"] == "charged"
                and charge.get("hourly_cents")
                and rental
                and rental["state"] == "CLOSED"
            ):
                seconds = service_seconds(rental)
                # Handed over but never usable (e.g. the gateway refused it): nothing to bill.
                charge = await (
                    self.bill(charge, seconds) if seconds else self.refund(charge, "not_delivered")
                )
            if charge["state"] in COUNTED:
                result.append(charge)
        return result


def billing_view(charge, rental, now=None):
    """What one order costs, for the instance's Billing view.

    `chargedCents` is final once the order is billed or refunded; before that it is the
    usage so far (with the 1-hour minimum once a server was delivered), never above the hold.
    """
    seconds = service_seconds(rental, now)
    hourly = charge.get("hourly_cents")
    if charge["state"] == "billed":
        charged = charge["billed_cents"]
    elif charge["state"] == "refunded":
        charged = 0
    elif hourly:
        charged = min(charge["cents"], usage_cents(hourly, seconds)) if seconds else 0
    else:
        charged = charge["cents"]
    periods = rental.get("service_intervals") or []
    return dict(
        mode="usage" if hourly else "prepaid",
        state=charge["state"],
        final=charge["state"] in {"billed", "refunded"},
        heldCents=charge["cents"],
        hourlyCents=hourly,
        feePercent=5,
        minimumMinutes=MINIMUM_MINUTES,
        usedSeconds=round(seconds),
        chargedCents=charged,
        releasedCents=charge["cents"] - charged
        if charge["state"] in {"billed", "refunded"}
        else None,
        startedAt=periods[0]["start"] if periods else None,
    )


def adjusted_account(account, charges, credited_cents=0, notifications=()):
    """The existing API's Credit view plus receipts posted here, less Spot charges.

    Promotional Credit is spent first. `credited_cents` are bank receipts confirmed through this
    adapter (paid Credit); `notifications` are this adapter's owner notices.
    """
    spent = sum(amount(c) for c in charges)
    promotional = round(float(account.get("promotionalCredit") or 0) * 100)
    paid = round(float(account.get("paidCredit") or 0) * 100) + credited_cents
    from_promotional = min(spent, promotional)
    promotional -= from_promotional
    # A paid balance never shows negative (e.g. after an operator reversed a top-up).
    paid = max(0, paid - (spent - from_promotional))
    return dict(
        account,
        promotionalCredit=promotional / 100,
        paidCredit=paid / 100,
        availableCredit=max(0, promotional + paid) / 100,
        notifications=[*(account.get("notifications") or []), *notifications],
        spotCharges=[
            dict(
                orderId=c["rental_id"],
                totalCents=amount(c),
                heldCents=c["cents"],
                billing="usage" if c.get("hourly_cents") else "prepaid",
                state=c["state"],
                createdAt=c["created_at"],
            )
            for c in sorted(charges, key=lambda c: c["created_at"], reverse=True)
        ],
    )
