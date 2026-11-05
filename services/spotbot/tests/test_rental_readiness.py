"""Readiness uses only read operations and does not open application storage."""

import copy
import json
from datetime import timedelta

import pytest
from botocore.exceptions import ClientError
from botocore.session import get_session
from botocore.validate import validate_parameters

from spotbot.config import Settings
from spotbot.gateway_config import GatewaySettings
from spotbot.models import utcnow
from spotbot.rental_models import RFQ
from spotbot.rental_readiness import (
    Readiness,
    check,
    configuration_checks,
    error_code,
    passed,
    queue_rules,
)
from tests.test_aws import FakeAWS, Pages


def queue_attributes():
    account, region = "123456789012", "us-west-2"
    arn = f"arn:aws:sqs:{region}:{account}:interruptions"
    return dict(
        QueueArn=arn,
        SqsManagedSseEnabled="true",
        RedrivePolicy=json.dumps(dict(deadLetterTargetArn=arn + "-dlq", maxReceiveCount=5)),
        Policy=json.dumps(
            {
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": "sqs:SendMessage",
                        "Principal": {"Service": "events.amazonaws.com"},
                        "Resource": arn,
                        "Condition": {
                            "ArnEquals": {
                                "aws:SourceArn": f"arn:aws:events:{region}:{account}:rule/interruptions"
                            },
                            "StringEquals": {"aws:SourceAccount": account},
                        },
                    }
                ]
            }
        ),
    )


class Cloud(FakeAWS):
    def get_paginator(self, method):
        pages = copy.deepcopy(super().get_paginator(method).values)
        if method == "describe_instance_types":
            pages[0]["InstanceTypes"][0]["GpuInfo"]["Gpus"][0]["MemoryInfo"] = {"SizeInMiB": 81920}
        return Pages(pages)

    def describe_images(self, **kwargs):
        value = super().describe_images(**kwargs)
        value["Images"][0]["RootDeviceType"] = "ebs"
        return value

    owned_snapshots = {}

    def describe_snapshots(self, **kwargs):
        found = [self.owned_snapshots[i] for i in kwargs["SnapshotIds"] if i in self.owned_snapshots]
        if not found:
            raise ClientError({"Error": {"Code": "InvalidSnapshot.NotFound"}}, "DescribeSnapshots")
        return {"Snapshots": found}

    def describe_key_pairs(self, **kwargs):
        return {"KeyPairs": [{"KeyName": kwargs["KeyNames"][0]}]}

    def describe_subnets(self, **kwargs):
        return {
            "Subnets": [
                {"SubnetId": kwargs["SubnetIds"][0], "State": "available", "VpcId": "vpc-default"}
            ]
        }

    def describe_security_groups(self, **kwargs):
        return {"SecurityGroups": [{"GroupId": "sg-gpu", "VpcId": "vpc-default"}]}

    def get_caller_identity(self):
        return {"Account": "123456789012"}

    def get_queue_attributes(self, **kwargs):
        return {"Attributes": queue_attributes()}

    def describe_rule(self, **kwargs):
        return {
            "State": "ENABLED",
            "EventPattern": json.dumps(
                {
                    "source": ["aws.ec2"],
                    "detail-type": [
                        "EC2 Spot Instance Interruption Warning",
                        "EC2 Instance State-change Notification",
                    ],
                }
            ),
        }

    def list_targets_by_rule(self, **kwargs):
        return {"Targets": [{"Arn": queue_attributes()["QueueArn"]}]}


class ReadOnlySession:
    """Fail immediately if the checker attempts any unapproved SDK operation."""

    operations = {
        "DescribeKeyPairs",
        "DescribeVpcs",
        "DescribeSecurityGroups",
        "DescribeImages",
        "DescribeSubnets",
        "GetServiceQuota",
        "GetParameter",
        "GetCallerIdentity",
        "GetQueueAttributes",
        "DescribeRule",
        "ListTargetsByRule",
        "DescribeInstanceTypes",
        "DescribeInstances",
        "DescribeSpotInstanceRequests",
        "DescribeSpotPriceHistory",
        "DescribeSnapshots",
    }

    def __init__(self):
        self.cloud, self.calls = Cloud(), []

    def client(self, service, **options):
        session = self
        model = get_session().get_service_model(service)

        def validate(method, kwargs):
            operation = "".join(part.title() for part in method.split("_"))
            assert operation in session.operations
            validate_parameters(kwargs, model.operation_model(operation).input_shape)
            session.calls.append((service, operation))

        class Client:
            def __getattr__(self, method):
                if method == "get_paginator":

                    def paginator(name):
                        class Paginator:
                            def paginate(self, **kwargs):
                                validate(name, kwargs)
                                return session.cloud.get_paginator(name).paginate(**kwargs)

                        return Paginator()

                    return paginator

                def call(**kwargs):
                    validate(method, kwargs)
                    return getattr(session.cloud, method)(**kwargs)

                return call

        return Client()


@pytest.fixture
def ready(tmp_path):
    settings = Settings(
        _env_file=None,
        spotbot_database_path=tmp_path / "must-not-exist.db",
        spotbot_enabled_providers="aws",
        spotbot_rentals_enabled=True,
        spotbot_live_orders_enabled=True,
        spotbot_api_key="b" * 40,
        spotbot_rental_public_url="https://bot.example.com",
        spotbot_rental_interruption_queues=json.dumps(
            {"us-west-2": "https://sqs.us-west-2.amazonaws.com/123456789012/interruptions"}
        ),
    )
    rfq = RFQ(
        rfq_id="rfq",
        rfq_version=1,
        upstream_order_id="order",
        regions=["us-west-2"],
        gpu_model="H100",
        gpu_count=1,
        min_gpu_memory_gib=80,
        price_unit="instance_hour",
        max_price_hourly="3",
        budget_usd="100",
        acquisition_deadline=utcnow() + timedelta(hours=1),
        expires_at=utcnow() + timedelta(hours=2),
        ssh_key_name="customer",
        require_gateway_ack=False,
    )
    return settings, rfq


async def test_read_only_preflight_and_offline_mode_never_create_storage(ready):
    settings, rfq = ready
    session = ReadOnlySession()
    checker = Readiness(settings, session=session)
    local = await checker.run(rfq)
    assert local["configuration_ready"] and local["cloud_preflight_passed"] is None
    assert session.calls == []
    result = await checker.run(rfq, aws=True)
    assert result["configuration_ready"] and result["cloud_preflight_passed"]
    assert result["regions"][0]["candidate_count"] == 2
    assert not result["mutation_permissions_verified"] and not result["live_launch_verified"]
    assert not session.cloud.creates
    assert not settings.spotbot_database_path.exists()
    assert settings.spotbot_api_key.get_secret_value() not in json.dumps(result)


async def test_private_initial_images_require_operator_enrollment(ready):
    settings, rfq = ready
    session = ReadOnlySession()
    rfq.initial_image_ids = {"us-west-2": "ami-0123456789abcdef0"}
    rfq.root_volume_gib = 100
    result = await Readiness(settings, session=session).run(rfq, aws=True)
    assert not result["cloud_preflight_passed"]
    checks = {c["name"]: c for c in result["regions"][0]["checks"]}
    assert checks["initial_image_approved"]["status"] == "failed"
    assert not session.cloud.creates
    original = session.cloud.describe_images

    def enrolled(**kwargs):
        value = original(**kwargs)
        value["Images"][0]["Tags"] = [
            {"Key": "spotbot-managed", "Value": "true"},
            {"Key": "spotbot-initial-image", "Value": "true"},
        ]
        return value

    session.cloud.describe_images = enrolled
    assert (await Readiness(settings, session=session).run(rfq, aws=True))["cloud_preflight_passed"]


async def test_public_default_image_warns_that_first_backup_is_full(ready):
    settings, rfq = ready
    result = await Readiness(settings, session=ReadOnlySession()).run(rfq, aws=True)
    checks = {c["name"]: c for c in result["regions"][0]["checks"]}
    assert checks["initial_image_incremental_first_backup"]["status"] == "warning"
    assert result["cloud_preflight_passed"]  # Advisory only; the default stays usable.


async def test_operator_base_image_is_used_and_keeps_snapshot_lineage(ready):
    settings, rfq = ready
    settings.spotbot_rental_initial_images = json.dumps({"us-west-2": "ami-0123456789abcdef0"})
    session = ReadOnlySession()
    original = session.cloud.describe_images
    seen = []

    def base(**kwargs):
        seen.extend(kwargs["ImageIds"])
        value = original(**kwargs)
        image = value["Images"][0]
        image["Tags"] = [
            {"Key": "spotbot-managed", "Value": "true"},
            {"Key": "spotbot-initial-image", "Value": "true"},
        ]
        # Larger than the RFQ root (50 GiB): operator bases size disks like the provider default.
        image["BlockDeviceMappings"] = [
            {"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 75, "SnapshotId": "snap-base", "Encrypted": True}}
        ]
        return value

    session.cloud.describe_images = base
    session.cloud.owned_snapshots = {
        "snap-base": {"SnapshotId": "snap-base", "OwnerId": "123456789012", "Encrypted": True}
    }
    result = await Readiness(settings, session=session).run(rfq, aws=True)
    checks = {c["name"]: c for c in result["regions"][0]["checks"]}
    assert seen[-1] == "ami-0123456789abcdef0"  # Earlier lookups resolve the provider default.
    assert checks["initial_image_incremental_first_backup"]["status"] == "passed"
    assert checks["initial_image_incremental_first_backup"]["image_id"] == "ami-0123456789abcdef0"
    assert checks["initial_image_disk_layout"]["status"] == "passed"
    assert result["cloud_preflight_passed"]
    # Another account's snapshot cannot carry this account's lineage.
    session.cloud.owned_snapshots["snap-base"]["OwnerId"] = "999999999999"
    result = await Readiness(settings, session=session).run(rfq, aws=True)
    checks = {c["name"]: c for c in result["regions"][0]["checks"]}
    assert checks["initial_image_incremental_first_backup"]["status"] == "warning"


async def test_readiness_rejects_order_region_without_recovery_enrollment(ready):
    settings, rfq = ready
    settings.spotbot_aws_regions = "us-west-2,us-east-1"
    settings.spotbot_rental_regions = "us-west-2"
    rfq.regions = ["us-east-1"]
    result = await Readiness(settings, session=ReadOnlySession()).run(rfq, aws=True)
    assert not result["configuration_ready"] and not result["cloud_preflight_passed"]
    assert result["regions"][0]["candidate_count"] == 0


async def test_every_rfq_region_needs_working_interruption_delivery(ready, monkeypatch):
    settings, rfq = ready
    settings.spotbot_aws_regions = "us-west-2,us-east-1"
    settings.spotbot_rental_interruption_queues = json.dumps(
        {r: f"https://sqs.{r}.amazonaws.com/123456789012/interruptions" for r in ("us-west-2", "us-east-1")}
    )
    rfq.regions = ["us-west-2", "us-east-1"]
    # The fake queue policy is bound to us-west-2, so us-east-1 delivery is broken.
    result = await Readiness(settings, session=ReadOnlySession()).run(rfq, aws=True)
    regions = {r["region"]: r for r in result["regions"]}
    assert regions["us-west-2"]["preflight_passed"]
    assert not regions["us-east-1"]["preflight_passed"]
    assert not result["cloud_preflight_passed"]

    def region(self, rules, name, account):
        offers = name == "us-west-2"
        checks = [
            check("affordable_quota_eligible_offers", offers),
            check("interruption_event_delivery", True),
        ]
        return dict(region=name, checks=checks, preflight_passed=offers, candidate_count=int(offers))

    # A Region that is ready but currently has no affordable offer is not a deployment fault.
    monkeypatch.setattr(Readiness, "region", region)
    assert (await Readiness(settings, session=ReadOnlySession()).run(rfq, aws=True))[
        "cloud_preflight_passed"
    ]


async def test_quota_price_and_missing_key_are_visible_without_launch(ready):
    settings, rfq = ready
    session = ReadOnlySession()
    rfq.max_price_hourly = 1
    result = await Readiness(settings, session=session).run(rfq, aws=True)
    assert not result["cloud_preflight_passed"]
    assert result["regions"][0]["candidate_count"] == 0
    rfq.max_price_hourly = 3
    session.cloud.spot_instances = [
        {"InstanceId": f"i-{n}", "InstanceType": "p5.4xlarge"} for n in range(4)
    ]
    assert not (await Readiness(settings, session=session).run(rfq, aws=True))[
        "cloud_preflight_passed"
    ]
    session.cloud.spot_instances = []

    def missing(**kwargs):
        raise ClientError(
            {"Error": {"Code": "InvalidKeyPair.NotFound", "Message": "private-error-secret"}},
            "DescribeKeyPairs",
        )

    session.cloud.describe_key_pairs = missing
    result = await Readiness(settings, session=session).run(rfq, aws=True)
    assert not result["cloud_preflight_passed"]
    assert "InvalidKeyPair.NotFound" in json.dumps(result)
    assert "private-error-secret" not in json.dumps(result)


def test_queue_encryption_account_binding_and_redrive_are_required():
    attributes = queue_attributes()
    assert queue_rules(attributes, "us-west-2", "123456789012") == ["interruptions"]
    for key in ("SqsManagedSseEnabled", "RedrivePolicy", "Policy"):
        invalid = dict(attributes)
        invalid.pop(key)
        with pytest.raises(ValueError):
            queue_rules(invalid, "us-west-2", "123456789012")
    policy = json.loads(attributes["Policy"])
    policy["Statement"][0]["Principal"] = "*"
    with pytest.raises(ValueError, match="not_account_bound"):
        queue_rules(dict(attributes, Policy=json.dumps(policy)), "us-west-2", "123456789012")


def test_gateway_must_match_keys_and_use_a_separate_database(ready):
    from pydantic import SecretStr

    settings, rfq = ready
    settings.spotbot_gateway_webhook_url = "https://gateway.example.com/v1/gateway/events"
    settings.spotbot_gateway_webhook_secret = SecretStr("w" * 40)
    settings.spotbot_rental_gateway_token = SecretStr("delivery" * 8)
    gateway = GatewaySettings(
        _env_file=None,
        bot_url=settings.spotbot_rental_public_url,
        bot_token="delivery" * 8,
        webhook_secret="w" * 40,
        api_key="a" * 40,
        http_token_secret="h" * 40,
        public_ssh_host="ssh.example.com",
        database_path=settings.spotbot_database_path,
    )
    assert not passed(configuration_checks(settings, rfq, gateway))
    gateway.database_path = settings.spotbot_database_path.with_name("gateway.db")
    assert passed(configuration_checks(settings, rfq, gateway))
    gateway.bot_token = SecretStr("different" * 8)
    assert not passed(configuration_checks(settings, rfq, gateway))
    assert error_code(ValueError("private-secret")) == "ValueError"
