from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from spotbot.api import create_app
from spotbot.service import Service
from spotbot.spot_history import backfill, fetch_events, iso


class Client:
    def __init__(self):
        self.requests = []
        self.fail = False

    def get_paginator(self, name):
        self.name = name
        return self

    def paginate(self, **query):
        if self.name == "describe_instance_types":
            return [
                {
                    "InstanceTypes": [
                        {"InstanceType": "g5.xlarge", "GpuInfo": {"Gpus": [{"Count": 1}]}}
                    ]
                }
            ]
        self.requests.append(query)
        if self.fail:
            raise RuntimeError("fixture page failure")
        event = {
            "InstanceType": "g5.xlarge",
            "AvailabilityZone": "us-west-2a",
            "SpotPrice": ".5",
            "Timestamp": query["StartTime"] - timedelta(days=1),
        }
        return [
            {"SpotPriceHistory": [event]},
            {"SpotPriceHistory": [event, dict(event, Timestamp=query["EndTime"], SpotPrice=".6")]},
        ]

    def close(self):
        pass


class Session:
    def __init__(self, client):
        self.ec2 = client

    def client(self, service, **kwargs):
        assert service == "ec2"
        return self.ec2


def test_aws_history_reads_all_pages_and_retains_predecessor():
    client = Client()
    end = datetime(2026, 10, 17, tzinfo=UTC)
    rows = fetch_events(client, "g5.xlarge", end - timedelta(days=90), end)
    assert len(rows) == 2
    assert rows[0]["effective_at"] < iso(end - timedelta(days=90))
    assert client.requests[0]["ProductDescriptions"] == ["Linux/UNIX"]


@pytest.mark.asyncio
async def test_backfill_resumes_without_publishing_historical_offers(settings):
    service = Service(settings)
    client = Client()
    end = datetime(2026, 10, 17, tzinfo=UTC)
    try:
        first = await backfill(
            settings, service.spot_history, session=Session(client), clock=lambda: end
        )
        assert first == {"completed": 1, "failed": 0, "events_received": 2}
        checkpoint = service.spot_history.coverage("us-west-2", "g5.xlarge")
        client.fail = True
        failed = await backfill(
            settings,
            service.spot_history,
            session=Session(client),
            clock=lambda: end + timedelta(days=1),
        )
        assert failed["failed"] == 1
        assert service.spot_history.coverage("us-west-2", "g5.xlarge") == checkpoint
        assert client.requests[-1]["StartTime"] == end - timedelta(hours=1)
        assert service.store.latest(provider="aws") == []
    finally:
        await service.close()


def test_history_api_auth_pagination_and_window_validation(settings):
    service = Service(settings)
    end = datetime(2026, 10, 17, tzinfo=UTC)
    coverage = {"since": iso(end - timedelta(days=90)), "until": iso(end)}
    service.spot_history.save(
        "us-west-2",
        "g5.xlarge",
        [
            {
                "availability_zone": "us-west-2a",
                "effective_at": coverage["since"],
                "price_hourly": ".5",
            }
        ],
        coverage,
    )
    with TestClient(create_app(settings, service)) as client:
        url = "/v1/prices/aws-spot-history"
        params = {"region": "us-west-2", "sku": "g5.xlarge", "until": iso(end)}
        assert client.get(url, params=params).status_code == 401
        auth = {"Authorization": "Bearer test-token"}
        response = client.get(url, params=params, headers=auth).json()
        assert response["total"] == 1
        assert response["kind"] == "price_change_events"
        assert client.get(url, params=dict(params, offset=1), headers=auth).json()["items"] == []
        assert (
            client.get(
                url, params=dict(params, since="2026-01-01T00:00:00Z"), headers=auth
            ).status_code
            == 400
        )
        assert (
            client.get(url, params=dict(params, until="2026-10-17"), headers=auth).status_code
            == 400
        )
