"""Single-instance usage reads must never refund unrelated held orders."""


from spotbot.models import utcnow
from spotbot.opennext_ledger import HELD_GRACE, KIND, CreditLedger
from spotbot.storage.sqlite import Store
from spotbot.storage.workflows import WorkflowStore


async def test_partial_usage_inventory_does_not_refund_missing_orders(tmp_path):
    store = Store(tmp_path / "ledger.db")
    try:
        db = WorkflowStore(store)
        ledger = CreditLedger(db)
        current = await ledger.hold("buyer", "opennext-current", 100, "offer")
        other = await ledger.hold("buyer", "opennext-other", 100, "offer")
        other["created_at"] = (utcnow() - HELD_GRACE * 2).isoformat()
        db.save(other, other["version"])
        rental = dict(id="rental", state="CLOSED", rfq={"upstream_order_id": current["reference"]})
        await ledger.reconcile("buyer", [rental], complete=False)
        assert db.get(KIND, current["id"])["state"] == "refunded"
        assert db.get(KIND, other["id"])["state"] == "held"
        # Full inventory reconciliation still expires truly missing purchases.
        await ledger.reconcile("buyer", [], complete=True)
        assert db.get(KIND, other["id"])["state"] == "refunded"
    finally:
        store.close()
