"""Browser-independent settlement and short execution grants for confirmed funding."""

import asyncio
import logging
from datetime import timedelta
from uuid import uuid4

import httpx

from spotbot.funding_ledger import doc
from spotbot.funding_math import (
    envelope,
    order_view,
    position,
    required,
    retail_cents,
    split_intervals,
)
from spotbot.funding_store import atomic
from spotbot.models import timestamp, utcnow
from spotbot.opennext_ledger import account_id
from spotbot.opennext_ops import OperationError
from spotbot.rentals import at
from spotbot.storage.workflows import ConflictError

logger = logging.getLogger(__name__)
PAUSED = {"PAUSING_FOR_FUNDS", "PAUSED_FOR_FUNDS"}


async def account_view(service, user_id, rows, *, record=False):
    checkpoint, free = await service.wallet(user_id)
    active = [r for r in rows if r["payment_method"] == "Credit" and r["runtime_state"] != "ended"]
    remaining = max(0, free) + sum(r["funded_cents"] - r["compute_cents"] for r in active)
    rates = [order_view(r)["funding"] for r in active]
    next_hour = sum(p["nextHourRequiredCents"] for p in rates) if all(
        p["nextHourRequiredCents"] is not None for p in rates) else None
    projected = sum(p["projectedRemainingCents"] for p in rates) if all(
        p["projectedRemainingCents"] is not None for p in rates) else None
    fresh = doc("spot_account_funding", user_id, "aggregate", baseline_cents=remaining,
                last_remaining_cents=remaining, cycle_id=str(uuid4()))
    saved = await service.call(service.db.get, fresh["kind"], fresh["id"])
    value = saved or fresh
    if remaining > value["last_remaining_cents"]:
        value.update(baseline_cents=remaining, cycle_id=str(uuid4()))
    value["last_remaining_cents"] = remaining
    credit = position(value["cycle_id"], value["baseline_cents"], remaining, next_hour, projected)
    if record:
        records = [checkpoint, value]
        notice = doc("spot_notice", user_id, [value["cycle_id"], "account-low"],
                     subject="Your shared Credit funding is low",
                     message="Only 20% or less of your shared compute funding remains. "
                             "Top up Credit to fund your active Spot orders.",
                     email=None, email_state="pending", attempts=0)
        if active and "remaining_20_percent" in credit["warnings"] and not await service.call(
            service.db.get, notice["kind"], notice["id"]
        ):
            notice["email"] = active[0].get("email")
            records.append(notice)
        await service.call(atomic, service.db, records)
    return dict(**envelope(user_id), credit=credit, activeCreditOrders=len(active),
                orders=[order_view(r) for r in rows], ordersComplete=True)


class FundingWorker:
    def __init__(self, service):
        self.service = service
        self.db, self.market, self.ledger = service.db, service.market, service.ledger

    async def run(self):
        while True:
            try:
                await self.tick()
            except Exception:
                logger.exception("spot_funding_worker_failed")
            await asyncio.sleep(self.service.ctx.settings.spotbot_floating_worker_seconds)

    async def tick(self):
        rows = await self.service.call(self.ledger.orders)
        # Older commitments get a deterministic first claim on unallocated Credit.
        for row in sorted(rows, key=lambda r: (r["created_at"], r["id"])):
            if row["runtime_state"] == "ended" and row.get("storage_released"):
                continue
            try:
                async with self.service.ctx.legacy_ledger.lock(row["account"]):
                    await self.step(await self.service.call(self.ledger.order, row["account"], row["id"]))
            except (ConflictError, httpx.HTTPError, ValueError, OperationError, LookupError):
                # A failed authorization is never renewed. The native deadline bounds GPU use.
                logger.warning("spot_funding_order_retry order=%s", row["id"])
        for user_id in sorted({r["account"] for r in rows}):
            try:
                fresh = await self.service.call(self.ledger.orders, user_id)
                await account_view(self.service, user_id, fresh, record=True)
            except (ConflictError, OperationError, ValueError, httpx.HTTPError):
                logger.warning("spot_funding_account_unavailable account=%s", user_id)
        await self.emails()

    async def notify(self, order, key, subject, message):
        row = doc("spot_notice", order["account"], [order["id"], key], order_id=order["id"],
                  subject=subject, message=message, email=order.get("email"),
                  email_state="pending", attempts=0)
        if not await self.service.call(self.db.get, row["kind"], row["id"]):
            await self.service.save(order, row)

    async def emails(self):
        mailer = self.service.ctx.mailer
        if not mailer:
            return
        for row in await self.service.call(self.db.list, "spot_notice"):
            if row["email_state"] != "pending" or not row.get("email"):
                continue
            try:
                await asyncio.to_thread(mailer.send, row["email"], row["subject"], row["message"])
                row["email_state"] = "sent"
            except Exception:
                row["attempts"] += 1
                if row["attempts"] >= 5:
                    row["email_state"] = "failed"
                logger.warning("spot_funding_email_retry notice=%s", row["id"])
            try:
                await self.service.call(atomic, self.db,
                                        [await self.service.checkpoint(row["account"]), row])
            except ConflictError:
                pass

    async def rate(self, order, row=None):
        quote = order["agreement"]
        if row:
            prices = row["prices"]
            if not prices or (utcnow() - at(row["observed_at"])).total_seconds() > 90:
                return None
            return retail_cents(prices[-1]["source_hourly"], quote["pricing"]["markupBps"],
                                quote["pricing"].get("modelStorageHourlyCents", 0))
        offer = next((o for o in (await self.market.offers()).values()
                      if o.id == quote["offer_id"] and o.raw["details"].get("aws_account", "default")
                      == quote["offer"]["details"].get("aws_account", "default")), None)
        return retail_cents(offer.raw["price_hourly"], quote["pricing"]["markupBps"],
                            quote["pricing"].get("modelStorageHourlyCents", 0)) if offer else None

    async def funded(self, order, rate):
        if rate is None or rate > order["agreement"]["max_hourly_cents"] or order.get("must_pause"):
            order["pause_reason"] = ("price_unavailable" if rate is None else "hourly_limit"
                                     if rate > order["agreement"]["max_hourly_cents"] else "execution_review")
            return False
        remaining = max(0, order["purchased_seconds"] - order["used_seconds"])
        needed = required(order, rate, min(3600, remaining))
        # Preserve the once-per-order minimum even for early END.
        if order["used_seconds"] < 3600:
            needed = max(needed, order.get("minimum_hourly_cents", rate) - order["compute_cents"])
        storage_gap = max(0, order["agreement"]["storage_reserve_cents"]
                          - (order["storage_funded_cents"] - order["storage_cents"]))
        missing = max(0, needed - (order["funded_cents"] - order["compute_cents"])) + storage_gap
        if missing and order["payment_method"] == "Credit":
            checkpoint, free = await self.service.wallet(order["account"])
            if free >= missing and (order["funded_cents"] + order["storage_funded_cents"] + missing
                                    <= order["agreement"]["max_total_cents"]):
                updated = await self.service.call(self.ledger.replenish, order, checkpoint,
                                                  "automatic-" + str(uuid4()), missing,
                                                  available_cents=free)
                order.update(updated)
                missing = 0
        if missing:
            order["pause_reason"] = ("total_limit" if order["funded_cents"] + order["storage_funded_cents"]
                                     + missing > order["agreement"]["max_total_cents"] else "insufficient_funding")
            return False
        order["pause_reason"] = None
        await self.service.call(self.ledger.reserve, order, await self.service.checkpoint(order["account"]), needed)
        return True

    async def step(self, order):
        if order["awaiting_payment"]:
            return
        if not order["rental_id"]:
            return await self.acquire(order)
        response = await self.market.bot("GET", f"/v1/rentals/{order['rental_id']}/price-evidence",
                                         params={"since": order["settled_until"]} if order["settled_until"] else {})
        response.raise_for_status()
        evidence = response.json()
        row = evidence["rental"]
        if row.get("rfq", {}).get("customer_ref") != account_id(order["account"]):
            raise ValueError("funding_rental_owner_mismatch")
        quote = order["agreement"]
        prices = [dict(p, hourly_cents=retail_cents(p["source_hourly"], quote["pricing"]["markupBps"],
                                                   quote["pricing"].get("modelStorageHourlyCents", 0)))
                  for p in evidence["prices"]]
        for segment in split_intervals(row, prices, order["settled_until"], evidence["observed_at"]):
            left = order["purchased_seconds"] - order["used_seconds"]
            if left <= 0:
                break
            if (at(segment["ended_at"]) - at(segment["started_at"])).total_seconds() > left:
                segment["ended_at"] = (at(segment["started_at"]) + timedelta(seconds=left)).isoformat()
            order = await self.service.call(self.ledger.settle, order,
                                            await self.service.checkpoint(order["account"]), segment)
        await self.project(order, row, evidence)
        if row["state"] in {"ENDING", "CLOSED"}:
            if row["state"] == "CLOSED":
                await self.service.call(self.ledger.finish, order, await self.service.checkpoint(order["account"]),
                                        row.get("closed_at") or evidence["observed_at"])
            return
        pending = order.get("execution_command")
        if pending:
            if pending["action"] != "pause" and at(pending["expires_at"]) <= utcnow() + timedelta(seconds=20):
                # An expired command cannot authorize more use. Discard it locally and
                # reevaluate funds on the next pass; never replay a stale resume forever.
                order["execution_command"] = None
                await self.service.save(order)
                return
            await self.command(order, row, pending=pending)
            return
        if row["state"] == "PAUSING_FOR_FUNDS":
            return
        if row["state"] in PAUSED:
            rate = await self.rate(order)
            if row["state"] == "PAUSED_FOR_FUNDS":
                order["must_pause"] = False
        elif row.get("service_intervals"):
            rate = await self.rate(order, evidence)
        else:
            rate = await self.rate(order)
        order["current_hourly_cents"] = rate
        if order["purchased_seconds"] <= order["used_seconds"]:
            await self.market.release(row["id"])
            await self.service.save(order)
            return
        funded = await self.funded(order, rate)
        action = "resume" if funded and row["state"] == "PAUSED_FOR_FUNDS" else "continue" if funded else "pause"
        if row["state"] == "PAUSED_FOR_FUNDS" and not funded:
            await self.service.save(order)
            return
        await self.command(order, row, action=action)

    async def acquire(self, order):
        if order["runtime_state"] == "ended":
            return
        if order.get("paused_at") and at(order["retention_expires_at"]) <= utcnow():
            return await self.service.call(self.ledger.finish, order,
                                           await self.service.checkpoint(order["account"]), timestamp())
        rate = await self.rate(order)
        order["current_hourly_cents"] = rate
        if not await self.funded(order, rate):
            order.update(runtime_state="paused_insufficient_funds", retention="unavailable")
            if not order.get("paused_at"):
                order.update(paused_at=timestamp(), retention_expires_at=(utcnow() + timedelta(days=7)).isoformat())
            await self.service.save(order)
            return
        reference = "opennext-" + order["id"]
        existing = await self.market.find(order["account"], reference)
        if not existing:
            if not order.get("native_rfq"):
                order["native_rfq"] = self.service.rfq(order)
                await self.service.save(order)
            # A stale initial request is closed, never silently repriced or duplicated.
            if at(order["native_rfq"]["funding"]["grant_expires_at"]) <= utcnow():
                return await self.service.call(self.ledger.finish, order,
                                               await self.service.checkpoint(order["account"]), timestamp())
            response = await self.market.create(order["native_rfq"])
            if response.status_code in {400, 409, 422}:
                return await self.service.call(self.ledger.finish, order,
                                               await self.service.checkpoint(order["account"]), timestamp())
            response.raise_for_status()
            existing = response.json()["rental"]
        order.update(rental_id=existing["id"], runtime_state="waiting", paused_at=None,
                     retention_expires_at=None)
        await self.service.save(order)

    async def command(self, order, row, *, action=None, pending=None):
        body = pending or dict(idempotency_key=str(uuid4()), expected_revision=row["funding_revision"],
                               action=action, expires_at=(utcnow() + timedelta(
                                   seconds=self.service.ctx.settings.spotbot_floating_grant_seconds)).isoformat())
        if not pending:
            order["execution_command"] = body
            await self.service.save(order)
        response = await self.market.bot("POST", f"/v1/rentals/{row['id']}/execution-grant", json=body)
        # Re-read on a stale native revision/deadline; a new grant still requires a fresh reservation.
        if response.status_code not in {200, 409}:
            response.raise_for_status()
        order["execution_command"] = None
        await self.service.save(order)

    async def project(self, order, row, evidence):
        paused = row["state"] in PAUSED
        was_paused = order.get("paused_at")
        if paused or row["state"] in {"ENDING", "CLOSED"}:
            deadline = row.get("funding_retention_until") or evidence.get("retention_until")
            order.update(retention="confirmed" if evidence.get("retention_verified") else "pending",
                         retention_expires_at=deadline)
            if not order.get("paused_at"):
                order["paused_at"] = row.get("funding_paused_at") or row.get("closed_at") or timestamp()
                order["storage_settled_until"] = order["paused_at"]
            if deadline:
                order = await self.service.call(self.ledger.storage, order,
                                                await self.service.checkpoint(order["account"]),
                                                evidence.get("retention_observed_at", evidence["observed_at"]))
            if evidence.get("storage_cleaned"):
                order.update(storage_released=True, retention="unavailable")
        elif was_paused:
            # No post-pause storage charge beyond the last confirmed retention observation.
            order.update(paused_at=None, retention_expires_at=None, retention="pending")
        if paused:
            order["runtime_state"] = "paused_insufficient_funds"
        elif row["state"] == "ACTIVE":
            order["runtime_state"] = "running"
        elif row["state"] not in {"ENDING", "CLOSED"}:
            order["runtime_state"] = "reconnecting" if row.get("service_intervals") else "waiting"
        await self.service.save(order)
        if row["state"] == "ACTIVE":
            await self.notify(order, ["ready", row.get("generation", 0)], "Your Spot instance is ready",
                              "Your instance is running. Open Instances for SSH, model readiness and connection details.")
