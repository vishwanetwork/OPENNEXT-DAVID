import copy
from datetime import UTC, datetime

import httpx
import pytest
from botocore.exceptions import ClientError, ReadTimeoutError
from botocore.session import get_session
from botocore.validate import validate_parameters

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


class FakeAWS:
    def __init__(self):
        self.creates = []
        self.deleted = False
        self.create_error = None
        self.malformed = False
        self.tags = []
        self.client_configs = []

    def get_credentials(self):
        return object()

    def client(self, service, **kwargs):
        self.client_configs.append(kwargs["config"])
        return self

    def get_paginator(self, method):
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
            "describe_instance_types": [{"InstanceTypes": [p5, fraction]}],
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
    assert all(o.region == "us-west-2" and o.available for o in full)
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
