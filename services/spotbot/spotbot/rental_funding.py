"""Nonterminal funding pauses and bounded grants; never change legacy rental rules."""

import hashlib
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from spotbot.models import timestamp, utcnow
from spotbot.rentals import at, service_seconds
from spotbot.storage.common import dump

PAUSING = "PAUSING_FOR_FUNDS"
PAUSED = "PAUSED_FOR_FUNDS"


def initialize(row, rules):
    if rules.funding:
        row["funding_revision"] = 0
        row["funding_until"] = rules.funding.grant_expires_at.isoformat()


def permitted(row):
    return not row["rfq"].get("funding") or bool(
        row.get("funding_until") and at(row["funding_until"]) > utcnow()
        and row["state"] not in {PAUSING, PAUSED} and not row.get("end_requested")
    )


def pause(engine, row, reason="insufficient_funds"):
    if row["state"] in {PAUSING, PAUSED, "ENDING", "CLOSED"}:
        return
    rules = row["rfq"]["funding"]
    row.update(
        state=PAUSING, connection=None, funding_pause=reason,
        funding_paused_at=timestamp(), current_backup_id=None,
        funding_retention_until=(utcnow()+timedelta(seconds=rules["retention_seconds"])).isoformat(),
        flush_command=str(uuid4()), flush_requested_at=timestamp(),
        recovery_started_at=None, recovery_halted=False,
    )
    engine.save(row, "funding_pausing")


def before_step(engine, row, rules, estimate):
    if not rules.funding or row["end_requested"]:
        return
    policy = rules.funding
    retention = row.get("funding_retention_until")
    if retention and row["state"] in {PAUSING, PAUSED} and at(retention) <= utcnow():
        engine._request_end(row)
        row["end_cause"] = "funding_retention_expired"
        engine.save(row, "ending")
    elif service_seconds(row) >= policy.purchased_seconds:
        engine._request_end(row)
        row["end_cause"] = "purchased_runtime_completed"
        engine.save(row, "ending")
    elif estimate >= rules.budget_usd:
        pause(engine, row, "authorized_spend_limit")
    elif not permitted(row):
        pause(engine, row, "execution_authorization_expired")


def close_retention(row):
    if not row["rfq"].get("funding"):
        return
    deadline = row.get("funding_retention_until")
    remaining = (max(0, int((at(deadline)-utcnow()).total_seconds())) if deadline
                 else row["rfq"]["funding"]["retention_seconds"])
    if not row.get("service_intervals"):
        remaining = 0
    row["rfq"]["backup"]["final_retention_seconds"] = remaining


async def grant(engine, rental_id, tenant_id, request):
    async with engine.row_lock(rental_id):
        row = engine.get(rental_id, tenant_id)
        if not row["rfq"].get("funding") or row["end_requested"] or row["state"] == "CLOSED":
            raise ValueError("funding_order_not_resumable")
        fingerprint = hashlib.sha256(dump(request.model_dump(mode="json")).encode()).hexdigest()
        if row.get("funding_command") == request.idempotency_key:
            if row.get("funding_command_hash") != fingerprint:
                raise ValueError("idempotency_key_conflict")
            return row
        if row["funding_revision"] != request.expected_revision:
            raise ValueError("funding_revision_conflict")
        if request.action != "pause" and not (
            utcnow()+timedelta(seconds=20) <= request.expires_at <= utcnow()+timedelta(minutes=5)
        ):
            raise ValueError("execution_grant_must_be_bounded")
        if request.action == "resume":
            if row["state"] != PAUSED:
                raise ValueError("funding_pause_not_ready")
            if at(row["funding_retention_until"]) <= utcnow():
                raise ValueError("funding_retention_expired")
            if engine.cost(row) >= Decimal(row["rfq"]["budget_usd"]):
                raise ValueError("authorized_spend_limit")
            backup = engine.db.get("backup", row["current_backup_id"]) if row["current_backup_id"] else None
            if row.get("service_intervals") and (not backup or backup["state"] != "AVAILABLE"):
                raise ValueError("verified_retention_required")
            row.update(state="WAITING_CAPACITY", funding_pause=None, recovery_halted=False,
                       recovery_started_at=timestamp(), error=None, attempts=0,
                       next_attempt_at=timestamp(), funding_retention_until=None,
                       funding_paused_at=None)
            # This is an independent safety window, not a purchased wall-clock end.
            remaining = max(1, row["rfq"]["funding"]["purchased_seconds"]-service_seconds(row))
            row["rfq"]["expires_at"] = (utcnow()+timedelta(
                seconds=remaining+row["rfq"]["funding"]["retention_seconds"])).isoformat()
        row.update(funding_revision=row["funding_revision"]+1,
                   funding_command=request.idempotency_key, funding_command_hash=fingerprint,
                   funding_until=request.expires_at.isoformat())
        if request.action == "pause":
            pause(engine, row)
        engine.save(row, "funding_authorized" if request.action != "pause" else None)
        return row
