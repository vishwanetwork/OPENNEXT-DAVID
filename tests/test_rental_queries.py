"""Rental listing filters remain tenant-scoped before pagination."""

from fastapi.testclient import TestClient

from spotbot.api import create_app
from tests.test_rentals import rental_env as rental_env  # noqa: F401


def test_customer_and_order_filters_apply_before_pagination(rental_env, monkeypatch):
    env = rental_env
    for index, (owner, customer) in enumerate([
        ("tenant-a", "alice"), ("tenant-a", "bob"),
        ("tenant-a", "alice"), ("tenant-b", "alice"),
    ]):
        request = env.request.model_copy(deep=True)
        request.rfq.customer_ref = customer
        request.rfq.upstream_order_id = "order-" + str(index)
        env.engine.create(request, owner, "filtered-" + str(index))
    client = TestClient(create_app(env.service.settings, env.service))
    headers = {"Authorization": "Bearer " + "a" * 32}
    url = "/v1/rentals"
    result = client.get(url, headers=headers, params=dict(customer_ref="alice", limit=1)).json()
    assert result["total"] == 2 and len(result["items"]) == 1
    first = result["items"][0]["id"]
    result = client.get(url, headers=headers, params=dict(customer_ref="alice", limit=1, offset=1)).json()
    assert result["total"] == 2 and result["items"][0]["id"] != first
    result = client.get(url, headers=headers, params=dict(customer_ref="alice", upstream_order_id="order-0")).json()
    assert result["total"] == 1 and result["items"][0]["rfq"]["customer_ref"] == "alice"
    assert client.get(url, headers=headers, params=dict(upstream_order_id="order-0")).status_code == 422
    assert client.get(url, headers=headers, params=dict(customer_ref="alice", upstream_order_id="order-3")).json()["total"] == 0
