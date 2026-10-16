import copy
import json
import time
from datetime import UTC, datetime

import httpx
import pytest
from botocore.exceptions import ClientError, ReadTimeoutError
from botocore.session import get_session
from botocore.validate import validate_parameters
from fastapi.testclient import TestClient

from spotbot.api import create_app
from spotbot.aws_provider import AWSProvider
from spotbot.config import Settings
from spotbot.models import LaunchOptions, OrderRequest
from spotbot.providers import ProviderError
from spotbot.service import Service, sanitized_plan
from spotbot.storage.common import fingerprint


class Pages:
    def __init__(self, values):
        self.values = values

    def paginate(self, **kwargs):
        yield from self.values


class PriceListPages:
    def __init__(self, fake):
        self.fake = fake

    def paginate(self, **kwargs):
        self.fake.price_list_calls.append(kwargs)
        if self.fake.price_list_error:
            raise self.fake.price_list_error
        yield {"PriceList": [json.dumps(p) for p in self.fake.price_list]}


def price_product(sku, on_demand, reserved=(), effective="2026-10-01T00:00:00Z"):
    def dims(**values):
        return {
            unit: {"unit": unit, "pricePerUnit": {"USD": str(value)}}
            for unit, value in values.items()
        }

    terms = {
        "OnDemand": {
            "od": {
                "effectiveDate": effective,
                "offerTermCode": "JRTCKXETXF",
                "priceDimensions": dims(Hrs=on_demand),
            }
        },
        "Reserved": {
            f"ri{i}": {
                "effectiveDate": "2026-10-15T19:36:30Z",
                "offerTermCode": f"RI{i}",
                "termAttributes": {
                    "LeaseContractLength": lease,
                    "PurchaseOption": option,
                    "OfferingClass": offering,
                },
                "priceDimensions": dims(**values),
            }
            for i, (lease, option, offering, values) in enumerate(reserved)
        },
    }
    return {"product": {"attributes": {"instanceType": sku}}, "terms": terms}


class FakeAWS:
    def __init__(self):
        self.creates = []
        self.deleted = False
        self.create_error = None
        self.malformed = False
        self.tags = []
        self.client_configs = []
        self.spot_instances = []
        self.spot_requests = []
        self.price_list = []
        self.price_list_calls = []
        self.price_list_error = None

    def get_credentials(self):
        return object()

    def client(self, service, **kwargs):
        self.client_configs.append(kwargs["config"])
        return self

    def get_paginator(self, method):
        if method == "get_products":
            return PriceListPages(self)
        gpu = {"Manufacturer": "NVIDIA", "Name": "H100", "Count": 1}
        p5 = {
            "InstanceType": "p5.4xlarge",
            "GpuInfo": {"Gpus": [gpu]},
            "VCpuInfo": {"DefaultVCpus": 16},
            "MemoryInfo": {"SizeInMiB": 262144},
            "ProcessorInfo": {"SupportedArchitectures": ["x86_64"]},
        }
        fraction = copy.deepcopy(p5)
        fraction["InstanceType"] = "g6f.large"
        fraction["VCpuInfo"]["DefaultVCpus"] = 2
        fraction["GpuInfo"]["Gpus"] = [
            {
                "Manufacturer": "NVIDIA",
                "Name": "L4",
                "Count": 0,
                "LogicalGpuCount": 1,
                "GpuPartitionSize": 0.125,
            }
        ]
        values = {
            "describe_instance_types": [
                {
                    "InstanceTypes": [
                        p5,
                        fraction,
                        {"InstanceType": "vt1.3xlarge", "VCpuInfo": {"DefaultVCpus": 12}},
                    ]
                }
            ],
            "describe_instances": [{"Reservations": [{"Instances": self.spot_instances}]}],
            "describe_spot_instance_requests": [
                {"SpotInstanceRequests": self.spot_requests[:1]},
                {"SpotInstanceRequests": self.spot_requests[1:]},
            ],
            "describe_subnets": [
                {
                    "Subnets": [
                        {"SubnetId": "subnet-a", "AvailabilityZone": "us-west-2a"},
                        {"SubnetId": "subnet-b", "AvailabilityZone": "us-west-2b"},
                    ]
                }
            ],
            "describe_spot_price_history": [
                {
                    "SpotPriceHistory": [
                        {
                            "InstanceType": "p5.4xlarge",
                            "AvailabilityZone": "us-west-2a",
                            "SpotPrice": "2.5",
                            "Timestamp": datetime(2026, 1, 1, tzinfo=UTC),
                        }
                    ]
                },
                {
                    "SpotPriceHistory": [
                        {
                            "InstanceType": "p5.4xlarge",
                            "AvailabilityZone": "us-west-2a",
                            "SpotPrice": "2.6",
                            "Timestamp": datetime(2026, 1, 2, tzinfo=UTC),
                        },
                        {
                            "InstanceType": "p5.4xlarge",
                            "AvailabilityZone": "us-west-2b",
                            "SpotPrice": "2.7",
                            "Timestamp": datetime(2026, 1, 2, tzinfo=UTC),
                        },
                        {
                            "InstanceType": "g6f.large",
                            "AvailabilityZone": "us-west-2a",
                            "SpotPrice": "0.05",
                            "Timestamp": datetime(2026, 1, 2, tzinfo=UTC),
                        },
                    ]
                },
            ],
        }
        return Pages(values[method])

    def describe_vpcs(self, **kwargs):
        return {"Vpcs": [{"VpcId": "vpc-default"}]}

    def describe_security_groups(self, **kwargs):
        return {"SecurityGroups": [{"GroupId": "sg-gpu"}]}

    def get_service_quota(self, **kwargs):
        return {"Quota": {"Value": 64 if kwargs["QuotaCode"] == "L-7212CCBC" else 0}}

    def get_parameter(self, **kwargs):
        assert kwargs["Name"].startswith("/aws/service/deeplearning/ami/x86_64/")
        return {"Parameter": {"Value": "ami-gpu"}}

    def describe_images(self, **kwargs):
        return {
            "Images": [
                {
                    "ImageId": "ami-gpu",
                    "State": "available",
                    "Architecture": "x86_64",
                    "RootDeviceName": "/dev/sda1",
                    "BlockDeviceMappings": [
                        {"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 100}}
                    ],
                }
            ]
        }

    def run_instances(self, **kwargs):
        self.creates.append(kwargs)
        if self.create_error:
            raise self.create_error
        self.tags = kwargs["TagSpecifications"][0]["Tags"]
        if self.malformed:
            return {}
        return {"Instances": [{"InstanceId": "i-test"}]}

    def describe_instances(self, **kwargs):
        return {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": "i-test",
                            "State": {"Name": "terminated" if self.deleted else "running"},
                            "Tags": self.tags,
                            "PublicIpAddress": "203.0.113.42",
                            "KeyName": "test",
                        }
                    ]
                }
            ]
        }

    def terminate_instances(self, **kwargs):
        self.deleted = True
        return {}


@pytest.fixture
def aws_service(tmp_path):
    config = Settings(
        _env_file=None,
        spotbot_enabled_providers="aws",
        spotbot_live_orders_enabled=True,
        spotbot_dry_run_enabled=False,
        spotbot_api_key="test-token",
        spotbot_aws_key_name="test",
        spotbot_background_enabled=False,
        spotbot_database_path=tmp_path / "aws.sqlite3",
    )
    client = httpx.AsyncClient()
    service = Service(config, client)
    fake = FakeAWS()
    service.providers["aws"] = AWSProvider(config, client, session=fake)
    yield service, fake
    service.store.close()


async def test_zonal_prices_pagination_quota_and_fractional_gpu(aws_service):
    service, fake = aws_service
    results = await service.collect("aws")
    assert results[0]["count"] == 3
    offers = service.store.latest(provider="aws")
    full = [o for o in offers if o.sku == "p5.4xlarge"]
    assert len({o.offer_id for o in full}) == 2
    assert {str(o.price_hourly) for o in full} == {"2.6", "2.7"}
    assert all(o.region == "us-west-2" and not o.available for o in full)
    assert all(
        o.public(600)["can_attempt"] and o.public(600)["capacity_status"] == "unknown" for o in full
    )
    assert all(int(o.storage_gb) == 100 for o in full)
    partial = next(o for o in offers if o.sku == "g6f.large")
    assert partial.gpu_count == 1 and not partial.orderable and not partial.available
    assert partial.details["gpu_count_kind"] == "logical"
    assert partial.details["gpu_specifications"][0]["GpuPartitionSize"] == 0.125
    assert all(c.retries["total_max_attempts"] == 1 for c in fake.client_configs)


async def test_live_default_native_limit_handoff_and_release(aws_service):
    service, fake = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    request = OrderRequest(
        offer_id=offer.offer_id,
        max_price_hourly="3",
        launch=LaunchOptions(cloud_init="SECRET-BOOTSTRAP"),
    )
    assert request.dry_run is False
    order, _ = service.create_order(request, "aws-live")
    replay, created = service.create_order(request, "aws-live")
    assert replay["id"] == order["id"] and not created
    await service.tick()
    await service.tick()
    assert len(fake.creates) == 1
    payload = fake.creates[0]
    validate_parameters(
        payload, get_session().get_service_model("ec2").operation_model("RunInstances").input_shape
    )
    assert payload["InstanceMarketOptions"]["SpotOptions"] == {
        "MaxPrice": "3",
        "SpotInstanceType": "one-time",
        "InstanceInterruptionBehavior": "terminate",
    }
    assert payload["MinCount"] == payload["MaxCount"] == 1
    assert payload["Placement"]["AvailabilityZone"] == offer.availability_zone
    assert len(payload["ClientToken"]) == 64
    assert payload["BlockDeviceMappings"][0]["Ebs"]["DeleteOnTermination"]
    assert payload["BlockDeviceMappings"][0]["Ebs"]["Encrypted"]
    assert sanitized_plan({"payload": payload})["payload"]["UserData"] == "[redacted]"
    current = service.store.get_order(order["id"])
    assert current["state"] == "ready" and current["handoff"]["ssh"]["key_reference"] == "test"
    service.release(order["id"])
    await service.tick()
    await service.tick()
    assert fake.deleted and service.store.get_order(order["id"])["state"] == "released"


@pytest.mark.parametrize("kind", ["timeout", "server", "capacity", "capacity-server", "malformed"])
async def test_aws_create_failures_preserve_uncertain_outcomes(aws_service, kind):
    service, fake = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    if kind == "timeout":
        fake.create_error = ReadTimeoutError(endpoint_url="https://ec2.us-west-2.amazonaws.com")
    elif kind in {"server", "capacity", "capacity-server"}:
        fake.create_error = ClientError(
            {
                "Error": {
                    "Code": "InternalError" if kind == "server" else "InsufficientInstanceCapacity"
                },
                "ResponseMetadata": {
                    "HTTPStatusCode": 500 if kind in {"server", "capacity-server"} else 400
                },
            },
            "RunInstances",
        )
    else:
        fake.malformed = True
    order, _ = service.create_order(
        OrderRequest(offer_id=offer.offer_id, max_price_hourly="3"), "aws-error"
    )
    await service.tick()
    state = service.store.get_order(order["id"])["state"]
    if kind.startswith("capacity"):
        assert state == "queued"
    else:
        assert state == "needs_reconciliation"
        await service.tick()
        assert len(fake.creates) == 1


async def test_simulation_disabled_and_unmanaged_delete_rejected(aws_service):
    service, fake = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    with pytest.raises(ValueError, match="dry_run_disabled"):
        service.create_order(
            OrderRequest(offer_id=offer.offer_id, max_price_hourly="3", dry_run=True), "simulation"
        )
    with pytest.raises(ProviderError, match="aws_instance_not_managed"):
        await service.providers["aws"].delete("i-unmanaged")
    assert not fake.deleted


async def test_image_and_subnet_overrides_cannot_break_catalog_identity(aws_service):
    service, _ = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    for launch in [
        LaunchOptions(image_id="ami-other"),
        LaunchOptions(subnet_id="subnet-other"),
        LaunchOptions(root_volume_gb=30),
    ]:
        with pytest.raises(ValueError):
            service.create_order(
                OrderRequest(offer_id=offer.offer_id, max_price_hourly="3", launch=launch),
                "invalid",
            )


def test_pre_aws_order_fingerprint_is_preserved():
    request = OrderRequest(
        offer_id="0" * 24,
        max_price_hourly="2",
        dry_run=True,
        launch=LaunchOptions(ssh_key_id="key"),
    )
    assert (
        fingerprint(request) == "44b16e6c28a8bfd15cefaf2521a8338aad2b945f69e6a985e91a446c84a0782a"
    )


async def test_account_quota_usage_deduplicates_requests_and_counts_vt(aws_service):
    service, fake = aws_service
    fake.spot_instances = [
        {"InstanceId": "i-external", "InstanceType": "p5.4xlarge"},
        {"InstanceId": "i-transcoder", "InstanceType": "vt1.3xlarge"},
    ]
    fake.spot_requests = [
        {"InstanceId": "i-external", "LaunchSpecification": {"InstanceType": "p5.4xlarge"}},
        {"LaunchSpecification": {"InstanceType": "p5.4xlarge"}},
        {"LaunchSpecification": {"InstanceType": "p5.4xlarge"}},
    ]
    await service.collect("aws")
    p5 = next(o for o in service.store.latest() if o.sku == "p5.4xlarge")
    assert p5.details["quota_used_vcpus"] == 48
    assert p5.details["quota_remaining_vcpus"] == 16 and p5.orderable
    fraction = next(o for o in service.store.latest() if o.sku == "g6f.large")
    assert fraction.details["quota_used_vcpus"] == 12
    fake.spot_requests.append({"LaunchSpecification": {"InstanceType": "p5.4xlarge"}})
    await service.collect("aws")
    blocked = next(o for o in service.store.latest() if o.sku == "p5.4xlarge")
    assert blocked.details["quota_remaining_vcpus"] == 0
    assert not blocked.orderable and blocked.details["eligibility_status"] == "quota_insufficient"


async def test_unknown_usage_fails_closed_and_blocks_submission(aws_service):
    service, fake = aws_service
    fake.spot_requests = [{"LaunchSpecification": {"InstanceType": "p-unknown"}}]
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.sku == "p5.4xlarge")
    assert offer.details["quota_remaining_vcpus"] is None
    assert offer.details["eligibility_status"] == "quota_usage_unknown"
    with pytest.raises(ValueError, match="quota_usage_unknown"):
        service.create_order(
            OrderRequest(offer_id=offer.offer_id, max_price_hourly="3"), "unknown-quota"
        )
    assert not fake.creates


async def test_known_capacity_failure_pauses_retries_without_claiming_stock(aws_service):
    service, fake = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    fake.create_error = ClientError(
        {
            "Error": {"Code": "InsufficientInstanceCapacity"},
            "ResponseMetadata": {"HTTPStatusCode": 500},
        },
        "RunInstances",
    )
    order, _ = service.create_order(
        OrderRequest(offer_id=offer.offer_id, max_price_hourly="3"), "backoff"
    )
    await service.tick()
    provider = service.providers["aws"]
    public = provider.public_offer(offer, 600)
    assert public["capacity_status"] == "unavailable" and not public["can_attempt"]
    await service.tick()
    assert len(fake.creates) == 1 and service.store.get_order(order["id"])["state"] == "queued"
    provider.capacity_failures[offer.offer_id] = time.monotonic() - 1
    fake.create_error = None
    await service.tick()
    assert len(fake.creates) == 2
    assert provider.public_offer(offer, 600)["capacity_status"] == "unknown"


async def test_api_separates_confirmed_stock_from_launch_candidates(aws_service):
    service, _ = aws_service
    await service.collect("aws")
    with TestClient(create_app(service.settings, service)) as client:
        headers = {"Authorization": "Bearer test-token"}
        confirmed = client.get(
            "/v1/prices/latest", params={"provider": "aws", "available_only": True}, headers=headers
        ).json()
        assert confirmed["total"] == 0
        candidates = client.get(
            "/v1/prices/latest",
            params={"provider": "aws", "can_attempt_only": True},
            headers=headers,
        ).json()
        assert candidates["total"] == 2
        offer = candidates["groups"][0]["offers"][0]
        assert offer["available"] is False and offer["capacity_status"] == "unknown"
        assert offer["eligibility_status"] == "eligible"
        assert offer["details"]["quota_remaining_vcpus"] == 64
        model = client.get(
            "/v1/gpus",
            params={"model": "H100", "available_only": False, "can_attempt_only": True},
            headers=headers,
        ).json()
        assert model["gpus"][0]["providers"] == ["aws"]
        provider = service.providers["aws"]
        provider.capacity_failures[offer["offer_id"]] = time.monotonic() + 60
        detail = client.get("/v1/offers/" + offer["offer_id"], headers=headers).json()
        assert not detail["can_attempt"] and detail["capacity_status"] == "unavailable"


async def test_native_quota_race_is_not_reported_as_capacity_or_replayed(aws_service):
    service, fake = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    fake.create_error = ClientError(
        {
            "Error": {"Code": "MaxSpotInstanceCountExceeded"},
            "ResponseMetadata": {"HTTPStatusCode": 400},
        },
        "RunInstances",
    )
    order, _ = service.create_order(
        OrderRequest(offer_id=offer.offer_id, max_price_hourly="3"), "quota-race"
    )
    await service.tick()
    public = service.providers["aws"].public_offer(offer, 600)
    assert not public["can_attempt"] and public["capacity_status"] == "unknown"
    assert public["eligibility_status"] == "quota_rejected_at_launch"
    await service.tick()
    assert len(fake.creates) == 1
    assert service.store.get_order(order["id"])["error"] == "aws_quota_rejected_at_launch"


async def test_quota_consumed_after_order_creation_blocks_billable_call(aws_service):
    service, fake = aws_service
    await service.collect("aws")
    offer = next(o for o in service.store.latest() if o.orderable)
    order, _ = service.create_order(
        OrderRequest(offer_id=offer.offer_id, max_price_hourly="3"), "consumed-quota"
    )
    fake.spot_instances = [
        {"InstanceId": "i-external-" + str(i), "InstanceType": "p5.4xlarge"} for i in range(4)
    ]
    await service.tick()
    assert not fake.creates
    current = service.store.get_order(order["id"])
    assert current["state"] == "queued" and current["error"] == "quota_insufficient"


async def test_list_prices_add_on_demand_and_reserved_on_their_own_schedule(aws_service):
    service, fake = aws_service
    fake.price_list = [
        price_product(
            "p5.4xlarge",
            "6.88",
            [
                ("1yr", "No Upfront", "standard", {"Hrs": "4.5"}),
                ("1yr", "No Upfront", "convertible", {"Hrs": "5.2"}),
                ("3yr", "All Upfront", "convertible", {"Hrs": "0", "Quantity": "26280"}),
                ("1yr", "No Upfront", "other", {"Hrs": "1"}),
            ],
        ),
        price_product("m7i.large", "0.1"),
    ]
    results = await service.collect("aws")
    assert {r["provider"]: r["count"] for r in results} == {"aws": 3, "aws_list": 4}
    call = fake.price_list_calls[0]
    assert call["ServiceCode"] == "AmazonEC2"
    assert {f["Field"]: f["Value"] for f in call["Filters"]}["regionCode"] == "us-west-2"
    offers = service.store.latest(provider="aws")
    spot = [o for o in offers if o.market == "spot"]
    listed = {
        (o.market, o.details.get("offering_class"), o.details.get("lease_contract_length")): o
        for o in offers
        if o.price_kind == "list"
    }
    assert len(spot) == 3 and len(listed) == 4
    on_demand = listed[("on_demand", None, None)]
    assert str(on_demand.price_hourly) == "6.88"
    assert on_demand.effective_at == "2026-10-01T00:00:00Z"
    assert str(listed[("reserved", "standard", "1yr")].price_hourly) == "4.500000"
    # An upfront payment is spread across the term: 26,280 USD over three years is 1 USD/hour.
    assert str(listed[("reserved", "convertible", "3yr")].price_hourly) == "1.000000"
    assert len({o.offer_id for o in listed.values()}) == 4
    assert all(not o.orderable and o.availability_zone is None for o in listed.values())

    # Spot refreshes every cycle; list prices wait for their own interval.
    await service.collect("aws")
    assert len(fake.price_list_calls) == 1
    assert len([o for o in service.store.latest(provider="aws") if o.price_kind == "list"]) == 4
    with pytest.raises(ValueError, match="aws_list_price_only"):
        service.create_order(
            OrderRequest(offer_id=on_demand.offer_id, max_price_hourly="100"), "list-order"
        )
    app = create_app(service.settings, service)
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer test-token"}
        reserved = client.get("/v1/prices/latest", params={"market": "reserved"}, headers=headers)
        assert reserved.json()["total"] == 3
        status = client.get("/v1/providers", headers=headers).json()["providers"]
        assert (
            next(p for p in status if p["provider"] == "aws")["last_list_price_collection"]["count"]
            == 4
        )


async def test_denied_price_list_keeps_spot_and_retries_later(aws_service):
    service, fake = aws_service
    fake.price_list_error = ClientError(
        {"Error": {"Code": "AccessDeniedException"}, "ResponseMetadata": {"HTTPStatusCode": 400}},
        "GetProducts",
    )
    results = await service.collect("aws")
    assert {r["provider"]: r["status"] for r in results} == {"aws": "ok", "aws_list": "error"}
    assert results[1]["error"] == "aws_AccessDeniedException"
    assert len(service.store.latest(provider="aws")) == 3
    assert service.list_prices_due - time.monotonic() <= 1800
