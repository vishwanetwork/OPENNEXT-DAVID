"""Allowlisted, read-only Console projections of the records used by the Terminal."""

import json
from collections import Counter
from datetime import timedelta
from pathlib import Path

from spotbot.models import timestamp, utcnow
from spotbot.opennext_ops import OperationError
from spotbot.rentals import at


def page(rows, cursor, limit):
    if not 1 <= limit <= 200 or (cursor and not cursor.isdigit()):
        raise OperationError(400, "Invalid page cursor or limit.")
    start = int(cursor or 0)
    return rows[start : start + limit], str(start + limit) if start + limit < len(rows) else None


class LegacySnapshots:
    """Never expose or change sessions, OAuth identities, login codes or private documents."""

    def __init__(self, directory):
        self.directory = Path(directory) if directory else None

    def read(self, name):
        if self.directory is None:
            raise OperationError(503, "Configure the shared legacy data directory on the adapter.")
        path = self.directory / name
        try:
            with path.open("rb") as handle:
                raw = handle.read(32 * 1024 * 1024 + 1)
            if len(raw) > 32 * 1024 * 1024:
                raise ValueError("snapshot_too_large")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError("snapshot_not_object")
            return value
        except (OSError, ValueError, TypeError) as exc:
            raise OperationError(
                503, "The account snapshot is unavailable. No records were changed."
            ) from exc

    def users(self):
        source = self.read("auth-state.json")
        if not isinstance(source.get("users"), list):
            raise OperationError(503, "The account snapshot has an unsupported format.")
        return [
            dict(
                id=str(row["id"]),
                name=str(row.get("name") or ""),
                email=str(row.get("email") or ""),
                company=row.get("company") if isinstance(row.get("company"), str) else None,
                role=row.get("role") or "unassigned",
                status="Active" if row.get("onboardingCompleted") else "Onboarding",
                joinedAt=row["createdAt"],
            )
            for row in source["users"]
            if isinstance(row, dict) and row.get("id") and row.get("createdAt")
        ]


def user_growth(rows):
    now = utcnow()
    return {
        period: sum(now - timedelta(days=days) <= at(row["joinedAt"]) <= now for row in rows)
        for period, days in [("7D", 7), ("1M", 30), ("3M", 90), ("6M", 180), ("1Y", 365)]
    }


def order_rows(rentals, charges, legacy_orders, users, transfers=()):
    accounts = {row["id"]: row for row in users}
    by_rental = {row.get("rental_id"): row for row in charges if row.get("rental_id")}
    by_reference = {row.get("reference"): row for row in charges if row.get("reference")}
    direct = {
        row["order_reference"]: row
        for row in transfers
        if row.get("purpose") == "order" and row.get("order_reference")
    }
    result = []
    for rental in rentals:
        rfq = rental["rfq"]
        reference = rfq.get("upstream_order_id") or rental["id"]
        charge = by_rental.get(rental["id"]) or by_reference.get(reference, {})
        transfer = direct.get(reference, {})
        user_id = (rfq.get("customer_ref") or "").removeprefix("opennext:")
        state = rental["state"]
        result.append(
            dict(
                id=rfq.get("upstream_order_id") or rental["id"],
                kind="Instance",
                email=charge.get("email")
                or transfer.get("email")
                or accounts.get(user_id, {}).get("email", ""),
                model=rfq.get("gpu_model", ""),
                gpuCount=rfq.get("gpu_count", 0),
                country=(rental.get("connection") or {}).get("region")
                or (rfq.get("regions") or [""])[0],
                term="Spot",
                total=charge.get("cents", transfer.get("amount_cents", 0)) / 100,
                settledTotal=settled_cents(charge) / 100
                if settled_cents(charge) is not None
                else None,
                paymentMethod="Direct Pay" if transfer else "Credit" if charge else "Unknown",
                amountKnown=bool(charge or transfer),
                rentalId=rental["id"],
                currency="USD",
                status=state,
                state="completed"
                if state == "CLOSED"
                and (rental.get("service_intervals") or charge.get("state") == "billed")
                else "cancelled"
                if state == "CLOSED"
                else "processing",
                submittedAt=rental["created_at"],
            )
        )
    known = {row["id"] for row in result}
    rental_ids = {r["id"] for r in rentals}
    for charge in charges:
        reference = charge.get("reference") or charge["id"]
        if reference in known or charge.get("rental_id") in rental_ids:
            continue
        transfer = direct.get(reference, {})
        result.append(
            dict(
                id=reference,
                kind="Instance",
                email=charge.get("email") or transfer.get("email") or "",
                model="",
                gpuCount=0,
                country="",
                term="Spot",
                total=charge["cents"] / 100,
                settledTotal=settled_cents(charge) / 100
                if settled_cents(charge) is not None
                else None,
                paymentMethod="Direct Pay" if transfer else "Credit",
                rentalId=charge.get("rental_id"),
                currency="USD",
                status=charge["state"].title(),
                state="cancelled"
                if charge["state"] == "refunded"
                else "completed"
                if charge["state"] == "billed"
                else "processing",
                submittedAt=charge.get("created_at") or charge.get("updated_at") or "",
            )
        )
        known.add(reference)
    for transfer in transfers:
        reference = transfer.get("order_reference")
        if transfer.get("purpose") != "order" or not reference or reference in known:
            continue
        offer = transfer.get("offer") or {}
        result.append(
            dict(
                id=reference,
                kind="Instance",
                email=transfer.get("email") or "",
                model=offer.get("gpu_model") or "",
                gpuCount=offer.get("gpu_count") or 0,
                country=offer.get("region") or "",
                term="Spot",
                total=transfer["amount_cents"] / 100,
                paymentMethod="Direct Pay",
                settledTotal=None,
                rentalId=None,
                currency="USD",
                status=transfer["status"],
                state="cancelled" if transfer["status"] == "Failed" else "processing",
                submittedAt=transfer["created_at"],
            )
        )
    for order in legacy_orders:
        if order.get("demo") or order.get("workspaceId"):
            continue
        status = str(order.get("status") or "Unknown")
        result.append(
            dict(
                id=str(order["id"]),
                kind="RFQ",
                email=(order.get("buyer") or {}).get("email")
                or accounts.get(order.get("buyerId"), {}).get("email", ""),
                model=str(order.get("model") or ""),
                gpuCount=order.get("count") or 0,
                country=str(order.get("region") or ""),
                term=str(order.get("term") or ""),
                total=order.get("buyerTotal", order.get("total", 0)),
                currency=order.get("currency", "USD"),
                status=status,
                state="completed"
                if status == "Completed"
                else "cancelled"
                if status in {"Cancelled", "Rejected"}
                else "processing",
                submittedAt=order.get("createdAt") or order.get("created") or timestamp(),
            )
        )
    return sorted(result, key=lambda row: (row["submittedAt"], row["id"]), reverse=True)


def rental_summary(rows):
    return dict(Counter(row["state"] for row in rows))


def settled_cents(charge):
    """A held maximum is not a final usage charge."""
    if charge.get("state") == "billed":
        return charge["billed_cents"]
    if charge.get("state") == "refunded":
        return 0
    if charge.get("state") == "charged" and charge.get("hourly_cents") is None:
        return charge["cents"]
    return None


def credit_payment_rows(charges, users, transfers):
    accounts = {row["id"]: row for row in users}
    direct = {r.get("order_reference") for r in transfers if r.get("purpose") == "order"}
    result = []
    for charge in charges:
        if charge.get("reference") in direct:
            continue  # Direct Pay also has a usage hold; it is not a second Credit purchase.
        result.append(
            dict(
                id=charge["id"],
                orderId=charge.get("reference") or charge["id"],
                rentalId=charge.get("rental_id"),
                email=charge.get("email")
                or accounts.get(charge["tenant_id"].removeprefix("opennext:"), {}).get("email", ""),
                currency="USD",
                state=charge["state"],
                authorizedCents=charge["cents"],
                settledCents=settled_cents(charge),
                releasedCents=charge["cents"]
                if charge["state"] == "refunded"
                else charge.get("released_cents", 0),
                submittedAt=charge.get("created_at") or charge.get("updated_at") or "",
                paymentMethod="Credit",
            )
        )
    return sorted(result, key=lambda r: (r["submittedAt"], r["id"]), reverse=True)
