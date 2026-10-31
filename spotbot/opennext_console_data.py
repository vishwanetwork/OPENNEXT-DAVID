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


def order_rows(rentals, charges, legacy_orders, users):
    accounts = {row["id"]: row for row in users}
    by_rental = {row.get("rental_id"): row for row in charges if row.get("rental_id")}
    result = []
    for rental in rentals:
        rfq = rental["rfq"]
        charge = by_rental.get(rental["id"], {})
        user_id = (rfq.get("customer_ref") or "").removeprefix("opennext:")
        state = rental["state"]
        result.append(
            dict(
                id=rental["id"],
                kind="Instance",
                email=charge.get("email") or accounts.get(user_id, {}).get("email", ""),
                model=rfq.get("gpu_model", ""),
                gpuCount=rfq.get("gpu_count", 0),
                country=(rental.get("connection") or {}).get("region")
                or (rfq.get("regions") or [""])[0],
                term="Spot",
                total=charge.get("cents", 0) / 100,
                currency="USD",
                status=state,
                state="completed"
                if state == "CLOSED" and rental.get("delivered_at")
                else "cancelled"
                if state == "CLOSED"
                else "processing",
                submittedAt=rental["created_at"],
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
