"""Money, reservations and outboxes cannot partially commit on any supported store."""

from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError

from spotbot.funding_models import AcceptRequest, QuoteRequest, storage_reserve
from spotbot.funding_store import atomic
from spotbot.storage.workflows import ConflictError, WorkflowStore
from tests.test_storage import storage as storage  # noqa: F401


def document(kind, **fields):
    return dict(id=str(uuid4()), kind=kind, tenant_id="opennext:buyer", version=0, **fields)


def test_finance_transaction_rolls_back_charge_and_notice_on_guard_conflict(storage):
    db = WorkflowStore(storage)
    guard = document("opennext_credit_guard")
    atomic(db, [guard])
    stale = deepcopy(guard)
    atomic(db, [guard])
    charge = document("opennext_charge", cents=100)
    notice = document("spot_notice", message="Only 20% remains")
    with pytest.raises(ConflictError):
        atomic(db, [charge, notice, stale])
    assert db.get(charge["kind"], charge["id"]) is None
    assert db.get(notice["kind"], notice["id"]) is None
    assert charge["version"] == 0
    atomic(db, [charge, notice, guard])
    assert db.get(charge["kind"], charge["id"])["cents"] == 100
    assert notice["version"] == 1


def test_finance_transaction_refuses_cross_owner_and_native_lifecycle_records(storage):
    db = WorkflowStore(storage)
    a = document("spot_order")
    with pytest.raises(ValueError, match="owner_mismatch"):
        atomic(db, [a, dict(document("spot_notice"), tenant_id="opennext:other")])
    with pytest.raises(ValueError, match="kind_not_allowed"):
        atomic(db, [document("rental")])
    with pytest.raises(ValueError, match="duplicate"):
        atomic(db, [a, a])


def test_new_agreement_requires_explicit_consent_and_exact_money():
    from decimal import Decimal

    assert storage_reserve(100, Decimal("0.15")) == 350
    valid = dict(offerId="offer", durationHours="1.5", paymentMethod="Credit",
                 maxHourlyCents=200, maxTotalCents=1000)
    assert QuoteRequest(**valid).durationHours == Decimal("1.5")
    for update in [dict(maxHourlyCents=True), dict(maxTotalCents=1.5), dict(durationHours="1.001")]:
        with pytest.raises(ValidationError):
            QuoteRequest(**dict(valid, **update))
    request = dict(pricingVersion="spot-hourly-v1", quoteId="quote", idempotencyKey="once",
                   consent=True, storageRetentionAcknowledged=True)
    assert AcceptRequest(**request).consent
    for update in [dict(consent=False), dict(consent=1), dict(storageRetentionAcknowledged=False),
                   dict(pricingVersion="duration-v1"), dict(sshPublicKey="private-key")]:
        with pytest.raises(ValidationError):
            AcceptRequest(**dict(request, **update))
