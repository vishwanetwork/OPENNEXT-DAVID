"""Durable, idempotent floating-order funding and immutable effective-rate settlements."""

import hashlib
from copy import deepcopy
from decimal import Decimal

from spotbot.funding_math import ceil_cents, final_adjustment, seconds
from spotbot.funding_models import RETENTION_SECONDS
from spotbot.funding_store import atomic
from spotbot.models import timestamp
from spotbot.opennext_ledger import account_id
from spotbot.rentals import identity
from spotbot.storage.common import dump

ORDER = "spot_order"
SETTLEMENT = "spot_settlement"
GUARD = "opennext_credit_guard"


def doc(kind, user_id, key, **fields):
    return dict(id=identity(kind, user_id, key), kind=kind, tenant_id=account_id(user_id),
                account=user_id, created_at=timestamp(), version=0, **fields)


def guard(db, user_id):
    fresh = doc(GUARD, user_id, "wallet")
    return db.get(GUARD, fresh["id"]) or fresh


class FundingLedger:
    def __init__(self, db):
        self.db = db

    def order(self, user_id, order_id):
        value = self.db.get(ORDER, order_id)
        if not value or value["tenant_id"] != account_id(user_id):
            raise LookupError("funding_order_not_found")
        return value

    def orders(self, user_id=None):
        return self.db.list(ORDER, account_id(user_id) if user_id else None)

    def entries(self, order):
        return sorted(
            [e for e in self.db.list(SETTLEMENT, order["tenant_id"]) if e["order_id"] == order["id"]],
            key=lambda e: (e["started_at"], e["ended_at"], e["id"]),
        )

    def create(self, quote, acceptance, user, wallet_guard, available_cents):
        order_id = identity(ORDER, user["id"], acceptance.idempotencyKey)
        existing = self.db.get(ORDER, order_id)
        if existing:
            if existing["quote_id"] != quote["id"]:
                raise ValueError("idempotency_key_conflict")
            return existing
        direct = quote["payment_method"] == "Direct Pay"
        if not direct and available_cents < quote["initial_payment_cents"]:
            raise ValueError("insufficient_credit")
        order = dict(
            doc(ORDER, user["id"], acceptance.idempotencyKey),
            quote_id=quote["id"], agreement=deepcopy(quote), email=user.get("email"),
            ssh_public_key=acceptance.sshPublicKey, consent_at=timestamp(),
            model=quote["model"], payment_method=quote["payment_method"],
            purchased_seconds=quote["purchased_seconds"], used_seconds=0,
            initial_hourly_cents=quote["hourly_cents"],
            initial_payment_cents=quote["initial_payment_cents"],
            funded_cents=0 if direct else quote["compute_funding_cents"],
            storage_funded_cents=0 if direct else quote["storage_reserve_cents"],
            compute_cents=0, storage_cents=0, nominal_compute_cents=0, raw_compute_cents="0",
            reserved_cents=0, rental_id=None, settled_until=None,
            runtime_state="waiting", retention="pending", retention_expires_at=None,
            cycle_id=identity("funding-cycle", order_id, "initial"),
            cycle_baseline_cents=0 if direct else quote["compute_funding_cents"],
            current_hourly_cents=None, awaiting_payment=direct,
        )
        records = [wallet_guard, order]
        if not direct:
            records.append(self.charge(order))
        atomic(self.db, records)
        return order

    def charge(self, order):
        charge_id = identity("floating-charge", order["id"])
        existing = self.db.get("opennext_charge", charge_id)
        return dict(
            existing or dict(id=charge_id, kind="opennext_charge",
                             tenant_id=order["tenant_id"], created_at=timestamp(), version=0),
            reference="opennext-" + order["id"], offer_id=order["agreement"]["offer_id"],
            pricing_version="spot-hourly-v1", hourly_cents=None, email=order.get("email"),
            funding_order_id=order["id"],
            cents=order["funded_cents"] + order["storage_funded_cents"],
            wallet_committed_cents=(order["compute_cents"] + (
                order["storage_cents"] if order.get("storage_released")
                else order["storage_funded_cents"])
                                    if order["runtime_state"] == "ended"
                                    else order["funded_cents"] + order["storage_funded_cents"]),
            state="billed" if order["runtime_state"] == "ended" else "charged",
            billed_cents=order["compute_cents"] + order["storage_cents"],
            rental_id=order.get("rental_id"), service_fee_bps=0,
        )

    def save(self, order, wallet_guard, *extra):
        records = [wallet_guard, order, *extra]
        if order["payment_method"] == "Credit":
            records.append(self.charge(order))
        records.extend(self.notices(order))
        atomic(self.db, records)
        return order

    def notices(self, order):
        from spotbot.funding_math import order_view

        if order["awaiting_payment"] or not order["cycle_baseline_cents"]:
            return []
        position = order_view(order)["funding"]
        events = []
        if "remaining_20_percent" in position["warnings"] and order["runtime_state"] != "ended":
            events.append(("low-funds", "Your Spot funding is low",
                           "Only 20% or less of your order's confirmed compute funding remains. "
                           "Add confirmed funds to avoid an interruption."))
        if order["runtime_state"] == "paused_insufficient_funds":
            events.append(("paused", "Your instance is paused for funding",
                           "The next usage period could not be funded. Your remaining runtime "
                           "is preserved. Check the recorded data-retention status and deadline "
                           "in Instances before replenishing."))
        result = []
        for event, subject, message in events:
            record = doc("spot_notice", order["account"],
                         [order["id"], order["cycle_id"], event], order_id=order["id"],
                         subject=subject, message=message, email=order.get("email"),
                         email_state="pending", attempts=0)
            if not self.db.get(record["kind"], record["id"]):
                result.append(record)
        return result

    def replenish(self, order, wallet_guard, receipt_id, cents, *, available_cents=None,
                  payment_record=None):
        receipt = doc("spot_funding_receipt", order["account"], receipt_id,
                      order_id=order["id"], cents=cents)
        prior = self.db.get(receipt["kind"], receipt["id"])
        if prior:
            if prior["order_id"] != order["id"] or prior["cents"] != cents:
                raise ValueError("payment_receipt_conflict")
            return self.order(order["account"], order["id"])
        if cents <= 0 or order["runtime_state"] == "ended":
            raise ValueError("funding_order_closed_or_invalid_amount")
        if order["payment_method"] == "Direct Pay" and (
            not payment_record or payment_record.get("status") != "Confirmed"
            or payment_record.get("account") != order["account"]
            or payment_record.get("amount_cents") != cents
        ):
            raise ValueError("confirmed_direct_pay_receipt_required")
        total = order["funded_cents"] + order["storage_funded_cents"] + cents
        if total > order["agreement"]["max_total_cents"]:
            raise ValueError("authorized_total_limit_exceeded")
        if order["payment_method"] == "Credit" and (
            available_cents is None or available_cents < cents
        ):
            raise ValueError("insufficient_credit")
        storage_shortfall = max(0, order["agreement"]["storage_reserve_cents"]
                                - (order["storage_funded_cents"] - order["storage_cents"]))
        storage_add = min(storage_shortfall, cents)
        order["storage_funded_cents"] += storage_add
        remaining_before = order["funded_cents"] - order["compute_cents"]
        order["funded_cents"] += cents - storage_add
        order["cycle_id"] = receipt["id"]
        order["cycle_baseline_cents"] = remaining_before + cents - storage_add
        order["awaiting_payment"] = False
        return self.save(order, wallet_guard, receipt, *([payment_record] if payment_record else []))

    def reserve(self, order, wallet_guard, cents):
        if cents < 0 or order["funded_cents"] - order["compute_cents"] < cents:
            raise ValueError("next_hour_unfunded")
        order["reserved_cents"] = cents
        return self.save(order, wallet_guard)

    def settle(self, order, wallet_guard, segment):
        fingerprint = hashlib.sha256(dump(segment).encode()).hexdigest()
        entry = doc(SETTLEMENT, order["account"],
                    [order["id"], segment["started_at"], segment["ended_at"]],
                    order_id=order["id"], entry_kind="usage", input_hash=fingerprint, **segment)
        prior = self.db.get(SETTLEMENT, entry["id"])
        if prior:
            if prior["input_hash"] != fingerprint:
                raise ValueError("immutable_settlement_conflict")
            return self.order(order["account"], order["id"])
        elapsed = seconds(segment["started_at"], segment["ended_at"])
        if elapsed <= 0 or elapsed > 3600 or (
            order["settled_until"] and segment["started_at"] < order["settled_until"]
        ):
            raise ValueError("settlement_overlap_or_invalid_interval")
        if Decimal(str(order["used_seconds"])) + elapsed > order["purchased_seconds"]:
            raise ValueError("purchased_runtime_exceeded")
        rate = segment["hourly_cents"]
        if not isinstance(rate, int) or isinstance(rate, bool) or rate <= 0:
            raise ValueError("invalid_retail_rate")
        capped_rate = min(rate, order["agreement"]["max_hourly_cents"])
        raw = Decimal(order["raw_compute_cents"]) + capped_rate * elapsed / 3600
        nominal = ceil_cents(raw)
        due = nominal - order["nominal_compute_cents"]
        charged = min(due, order["funded_cents"] - order["compute_cents"])
        entry.update(
            billable_seconds=float(elapsed), compute_cents=due,
            adjustment_cents=charged - due, total_cents=charged,
            explanation="Confirmed funding protection; uncovered usage absorbed by platform."
            if charged < due else "Customer price cap applied." if capped_rate != rate else None,
            hourly_cents=capped_rate,
        )
        order.update(
            used_seconds=float(Decimal(str(order["used_seconds"])) + elapsed),
            raw_compute_cents=str(raw), nominal_compute_cents=nominal,
            compute_cents=order["compute_cents"] + charged,
            settled_until=segment["ended_at"], last_hourly_cents=capped_rate,
            minimum_hourly_cents=order.get("minimum_hourly_cents", capped_rate),
            reserved_cents=max(0, order["reserved_cents"] - charged),
        )
        if charged < due or capped_rate != rate:
            order["must_pause"] = True
        return self.save(order, wallet_guard, entry)

    def finish(self, order, wallet_guard, ended_at):
        if order["runtime_state"] == "ended":
            return order
        due = final_adjustment(order)
        charged = min(due, order["funded_cents"] - order["compute_cents"])
        records = []
        if due:
            adjustment = doc(
                SETTLEMENT, order["account"], [order["id"], "final-minimum"],
                order_id=order["id"], entry_kind="adjustment", started_at=ended_at,
                ended_at=ended_at, billable_seconds=0, compute_cents=0,
                hourly_cents=order.get("last_hourly_cents", order["initial_hourly_cents"]),
                adjustment_cents=charged, total_cents=charged,
                explanation="Final started-minute rounding and one-hour minimum, once per order.",
            )
            records.append(adjustment)
        order.update(compute_cents=order["compute_cents"] + charged,
                     runtime_state="ended", reserved_cents=0, ended_at=ended_at)
        if not order.get("used_seconds"):
            order["storage_released"] = True
        return self.save(order, wallet_guard, *records)

    def storage(self, order, wallet_guard, until):
        start = order.get("storage_settled_until") or order.get("paused_at")
        if not start or until <= start:
            return order
        from spotbot.rentals import at

        end = min(at(until), at(order["retention_expires_at"]))
        elapsed = max(Decimal(0), seconds(start, end.isoformat()))
        raw = Decimal(order.get("raw_storage_cents", "0")) + (
            order["agreement"]["storage_reserve_cents"] * elapsed / RETENTION_SECONDS)
        cost = min(order["storage_funded_cents"], ceil_cents(raw))
        order.update(storage_cents=cost, raw_storage_cents=str(raw),
                     storage_settled_until=end.isoformat())
        return self.save(order, wallet_guard)
