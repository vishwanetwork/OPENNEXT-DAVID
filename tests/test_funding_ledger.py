"""Funding boundaries, effective prices and concurrent money ownership."""

from datetime import UTC, datetime, timedelta

import pytest

from spotbot.funding_ledger import FundingLedger, doc, guard
from spotbot.funding_math import order_view, position, split_intervals
from spotbot.funding_models import AcceptRequest
from spotbot.storage.workflows import ConflictError, WorkflowStore
from tests.test_storage import storage as storage  # noqa: F401


@pytest.fixture
def funds(storage):
    db = WorkflowStore(storage)
    ledger = FundingLedger(db)
    quote = dict(id="quote", model="L4", offer_id="offer", payment_method="Credit",
                 hourly_cents=100, purchased_seconds=36000, compute_funding_cents=1000,
                 storage_reserve_cents=350, initial_payment_cents=1350,
                 max_total_cents=5000, max_hourly_cents=500)
    request = AcceptRequest(pricingVersion="spot-hourly-v1", quoteId="quote",
                            idempotencyKey="purchase", consent=True,
                            storageRetentionAcknowledged=True)
    user = dict(id="buyer", email="buyer@example.com")
    return db, ledger, quote, request, user


def segment(index, rate=100, seconds=3600):
    start = datetime(2026, 11, 3, tzinfo=UTC) + timedelta(hours=index)
    return dict(started_at=start.isoformat(), ended_at=(start+timedelta(seconds=seconds)).isoformat(),
                hourly_cents=rate, effective_at=start.isoformat(), generation=1)


def test_repricing_is_effective_only_and_retries_do_not_double_charge(funds):
    db, ledger, quote, request, user = funds
    row = ledger.create(quote, request, user, guard(db, "buyer"), 10000)
    row = ledger.settle(row, guard(db, "buyer"), segment(0, 100))
    row = ledger.settle(row, guard(db, "buyer"), segment(1, 200))
    row = ledger.settle(row, guard(db, "buyer"), segment(1, 200))
    assert row["compute_cents"] == 300 and row["used_seconds"] == 7200
    assert [e["total_cents"] for e in ledger.entries(row)] == [100, 200]
    with pytest.raises(ValueError, match="immutable_settlement"):
        ledger.settle(row, guard(db, "buyer"), segment(0, 400))
    assert row["compute_cents"] == 300


def test_concurrent_orders_cannot_claim_the_same_credit(funds):
    db, ledger, quote, request, user = funds
    first_guard, second_guard = guard(db, "buyer"), guard(db, "buyer")
    first = ledger.create(quote, request, user, first_guard, 1500)
    second_request = request.model_copy(update={"idempotencyKey": "other-order"})
    with pytest.raises(ConflictError):
        ledger.create(quote, second_request, user, second_guard, 1500)
    assert len(ledger.orders("buyer")) == 1
    with pytest.raises(ValueError, match="insufficient_credit"):
        ledger.create(quote, second_request, user, guard(db, "buyer"), 150)
    assert ledger.create(quote, request, user, guard(db, "buyer"), 0)["id"] == first["id"]


def test_twenty_percent_warns_and_verified_credit_replenishment_rearms_once(funds):
    db, ledger, quote, request, user = funds
    row = ledger.create(quote, request, user, guard(db, "buyer"), 10000)
    for index in range(8):
        row = ledger.settle(row, guard(db, "buyer"), segment(index))
    assert "remaining_20_percent" in order_view(row)["funding"]["warnings"]
    assert len(db.list("spot_notice", "opennext:buyer")) == 1
    row = ledger.save(row, guard(db, "buyer"))
    assert len(db.list("spot_notice", "opennext:buyer")) == 1
    row = ledger.replenish(row, guard(db, "buyer"), "wallet-allocation-1", 1000,
                           available_cents=1000)
    assert order_view(row)["funding"]["remainingPercent"] == 100
    again = ledger.replenish(row, guard(db, "buyer"), "wallet-allocation-1", 1000,
                             available_cents=0)
    assert again["funded_cents"] == row["funded_cents"] == 2000


def test_direct_pay_is_separate_and_pending_receipts_cannot_fund_it(funds):
    db, ledger, quote, request, user = funds
    quote["payment_method"] = "Direct Pay"
    row = ledger.create(quote, request, user, guard(db, "buyer"), 0)
    assert row["awaiting_payment"] and row["funded_cents"] == 0
    assert not db.list("opennext_charge")
    with pytest.raises(ValueError, match="confirmed_direct_pay"):
        ledger.replenish(row, guard(db, "buyer"), "transfer", 1350)
    receipt = doc("opennext_transfer", "buyer", "transfer", status="Confirmed",
                  amount_cents=1350)
    row = ledger.replenish(row, guard(db, "buyer"), "transfer", 1350,
                           payment_record=receipt)
    assert row["funded_cents"] == 1000 and row["storage_funded_cents"] == 350
    assert not db.list("opennext_charge")


def test_minimum_is_applied_once_and_customer_never_owes_unapproved_funds(funds):
    db, ledger, quote, request, user = funds
    row = ledger.create(quote, request, user, guard(db, "buyer"), 10000)
    row = ledger.settle(row, guard(db, "buyer"), segment(0, seconds=61))
    row = ledger.finish(row, guard(db, "buyer"), segment(0, seconds=61)["ended_at"])
    assert row["compute_cents"] == 100
    assert sum(e["total_cents"] for e in ledger.entries(row)) == 100
    assert len(ledger.entries(row)) == 2
    assert ledger.finish(row, guard(db, "buyer"), row["ended_at"])["compute_cents"] == 100
    with pytest.raises(LookupError):
        ledger.order("other", row["id"])


def test_price_and_funding_limits_never_create_negative_balances(funds):
    db, ledger, quote, request, user = funds
    quote.update(max_hourly_cents=100, compute_funding_cents=50, initial_payment_cents=400)
    row = ledger.create(quote, request, user, guard(db, "buyer"), 10000)
    row = ledger.settle(row, guard(db, "buyer"), segment(0, rate=500))
    assert row["compute_cents"] == 50 and row["must_pause"]
    assert ledger.entries(row)[0]["adjustment_cents"] == -50
    assert order_view(row)["funding"]["remainingCents"] == 0


def test_exact_next_hour_funding_and_warning_boundaries():
    assert position("cycle", 10000, 2001, 2001, 2001)["warnings"] == []
    assert position("cycle", 10000, 2000, 2000, 2000)["status"] == "low"
    assert position("cycle", 10000, 1999, 2000, 2000)["status"] == "insufficient"


def test_service_interruption_and_intra_hour_price_changes_are_not_flattened():
    start = datetime(2026, 11, 3, tzinfo=UTC)
    def t(minutes):
        return (start+timedelta(minutes=minutes)).isoformat()
    rental = dict(service_intervals=[dict(start=t(0), end=t(20)), dict(start=t(40), end=t(70))])
    prices = [dict(effective_at=t(0), hourly_cents=100),
              dict(effective_at=t(10), hourly_cents=200),
              dict(effective_at=t(50), hourly_cents=50)]
    result = list(split_intervals(rental, prices, None, t(70)))
    assert [s["hourly_cents"] for s in result] == [100, 200, 200, 50, 50]
    assert [(s["started_at"], s["ended_at"]) for s in result] == [
        (t(0),t(10)),(t(10),t(20)),(t(40),t(50)),(t(50),t(60)),(t(60),t(70))]
    with pytest.raises(ValueError, match="coverage_unavailable"):
        list(split_intervals(rental, prices[1:], None, t(70)))
