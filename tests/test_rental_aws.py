"""Validate emitted AWS requests against the installed botocore service schema."""

import copy
from decimal import Decimal
from types import SimpleNamespace

import pytest
from botocore.session import get_session
from botocore.validate import validate_parameters

from spotbot.providers import ProviderError
from spotbot.rental_aws import AWSRecovery, tags
from tests.test_rentals import rental_env as rental_env  # noqa: F401


@pytest.fixture
def native_backend(rental_env):
    env = rental_env
    backend = AWSRecovery(SimpleNamespace(), env.service.settings)
    calls = []
    sdk = get_session().get_service_model("ec2")
    image = dict(copy.deepcopy(env.cloud.base), Tags=tags("rental", 1))
    spot_status = {"code": "fulfilled"}
    backend.spot_status = spot_status

    async def call(region, method, *, mutation=False, **kwargs):
        operation = {
            "describe_images": "DescribeImages",
            "run_instances": "RunInstances",
            "create_snapshots": "CreateSnapshots",
            "create_snapshot": "CreateSnapshot",
            "register_image": "RegisterImage",
            "copy_image": "CopyImage",
            "describe_instances": "DescribeInstances",
            "describe_volumes": "DescribeVolumes",
            "modify_instance_attribute": "ModifyInstanceAttribute",
            "describe_snapshots": "DescribeSnapshots",
            "describe_spot_instance_requests": "DescribeSpotInstanceRequests",
        }[method]
        validate_parameters(kwargs, sdk.operation_model(operation).input_shape)
        calls.append((region, method, kwargs))
        return {
            "describe_images": {"Images": [image]},
            "run_instances": {"Instances": [{"InstanceId": "i-12345678"}]},
            "create_snapshots": {
                "Snapshots": [{"SnapshotId": "snap-1234", "VolumeId": "vol-root"}]
            },
            "create_snapshot": {"SnapshotId": "snap-1234", "VolumeId": "vol-root"},
            "register_image": {"ImageId": "ami-restore"},
            "copy_image": {"ImageId": "ami-copy"},
            "describe_spot_instance_requests": {
                "SpotInstanceRequests": [{"Status": {"Code": spot_status["code"]}}]
            },
            "describe_snapshots": {
                "Snapshots": [
                    {"SnapshotId": i, "KmsKeyId": "arn:aws:kms:us-west-2:111111111111:key/base"}
                    for i in kwargs.get("SnapshotIds", [])
                ]
            },
        }.get(method, {})

    backend.call = call

    async def preflight(*args):
        return None

    backend.preflight = preflight
    return env, backend, calls, image


async def test_launch_preserves_all_disks_and_has_native_idempotency(native_backend):
    env, backend, calls, image = native_backend
    rules = env.request.rfq
    gen = dict(
        id="12345678-1234-1234-1234-123456789abc",
        generation=1,
        region="us-west-2",
        image_id="ami-base",
        agent_token="a" * 40,
    )
    result = await backend.launch({"id": "rental"}, gen, env.offer, rules)
    payload = calls[-1][2]
    assert result == "i-12345678" and payload["ClientToken"] == gen["id"]
    assert payload["InstanceMarketOptions"]["SpotOptions"]["MaxPrice"] == "3"
    assert {v["DeviceName"] for v in payload["BlockDeviceMappings"]} == {"/dev/sda1", "/dev/sdf"}
    assert all(
        v["Ebs"]["Encrypted"] and not v["Ebs"]["DeleteOnTermination"]
        for v in payload["BlockDeviceMappings"]
    )
    assert "IamInstanceProfile" not in payload
    assert "systemctl enable --now spotbot-agent" in payload["UserData"]


async def test_snapshot_image_and_copy_requests_are_valid(native_backend):
    env, backend, calls, image = native_backend
    backup = dict(
        id="backup-id",
        rental_id="rental",
        region="us-west-2",
        generation=1,
        image_id="ami-restore",
        volumes=[dict(volume_id="vol-root", device="/dev/sda1", size_gib=50)],
    )
    gen = dict(
        generation=1,
        instance_id="i-12345678",
        image_metadata={
            "Architecture": "x86_64",
            "RootDeviceName": "/dev/sda1",
            "BootMode": "uefi",
            "EnaSupport": True,
        },
    )
    snapshots = await backend.start_snapshots(backup, gen)
    await backend.start_snapshots(backup, gen, "vol-root")
    assert await backend.register_image(backup, gen, snapshots) == "ami-restore"
    assert await backend.copy_image(backup, "us-east-1") == "ami-copy"
    copied = next(p for _, m, p in calls if m == "copy_image")["TagSpecifications"]
    assert {t["ResourceType"] for t in copied} == {"image", "snapshot"}
    assert all(
        {t["Key"]: t["Value"] for t in item["Tags"]}["spotbot-backup"] == backup["id"]
        for item in copied
    )
    assert (
        next(p for _, m, p in calls if m == "create_snapshots")["InstanceSpecification"][
            "ExcludeBootVolume"
        ]
        is False
    )


def disk_keys(calls):
    payload = next(p for _, m, p in calls if m == "run_instances")
    return {v["DeviceName"]: v["Ebs"].get("KmsKeyId") for v in payload["BlockDeviceMappings"]}


async def test_encrypted_initial_image_keeps_its_key_for_incremental_captures(native_backend):
    env, backend, calls, image = native_backend
    image["BlockDeviceMappings"][0]["Ebs"]["Encrypted"] = True
    gen = dict(id="generation", generation=1, region="us-west-2", image_id="ami-base", agent_token="a" * 40)
    await backend.launch({"id": "rental"}, gen, env.offer, env.request.rfq)
    lookup = next(p for _, m, p in calls if m == "describe_snapshots")
    assert lookup == {"SnapshotIds": ["snap-base"]}
    # The root reuses the source key; a new empty data disk has no lineage to keep.
    assert disk_keys(calls) == {
        "/dev/sda1": "arn:aws:kms:us-west-2:111111111111:key/base",
        "/dev/sdf": None,
    }


async def test_unencrypted_initial_image_needs_no_key_lookup(native_backend):
    env, backend, calls, image = native_backend
    gen = dict(id="generation", generation=1, region="us-west-2", image_id="ami-base", agent_token="a" * 40)
    await backend.launch({"id": "rental"}, gen, env.offer, env.request.rfq)
    assert not any(m == "describe_snapshots" for _, m, _ in calls)
    assert set(disk_keys(calls).values()) == {None}


async def test_restore_reuses_each_backed_up_disk_key(native_backend):
    env, backend, calls, image = native_backend
    image["BlockDeviceMappings"].append({"DeviceName": "/dev/sdf", "Ebs": {"SnapshotId": "snap-data", "VolumeSize": 100}})
    backup = {"volumes": [
        {"device": "/dev/sda1", "volume_id": "vol-root", "kms_key_id": "key-root"},
        {"device": "/dev/sdf", "volume_id": "vol-data", "kms_key_id": "key-data"},
    ]}
    gen = dict(id="generation", generation=2, region="us-west-2", image_id="ami-restore", agent_token="a" * 40)
    await backend.launch({"id": "rental"}, gen, env.offer, env.request.rfq, backup)
    assert disk_keys(calls) == {"/dev/sda1": "key-root", "/dev/sdf": "key-data"}
    assert not any(m == "describe_snapshots" for _, m, _ in calls)


async def test_restore_rejects_foreign_image_and_incomplete_disk_set(native_backend):
    env, backend, calls, image = native_backend
    gen = dict(
        id="generation", generation=2, region="us-west-2", image_id="ami-base", agent_token="a" * 40
    )
    with pytest.raises(ProviderError, match="restore_image_ownership_mismatch"):
        await backend.launch(
            {"id": "another-tenant"}, gen, env.offer, env.request.rfq, {"volumes": []}
        )
    with pytest.raises(ProviderError, match="restore_disk_set_mismatch"):
        await backend.launch(
            {"id": "rental"}, gen, env.offer, env.request.rfq, {"volumes": [{"device": "/dev/sdf"}]}
        )
    assert not any(method == "run_instances" for _, method, _ in calls)


@pytest.mark.parametrize("attribute,value,error", [
    ("RootDeviceType", "instance-store", "image_requires_ebs_root"),
    ("ProductCodes", [{"ProductCodeId": "paid-product"}], "unsupported_image_license"),
    ("Architecture", "arm64", "image_not_compatible"),
])
async def test_initial_image_constraints_reject_before_launch(native_backend, attribute, value, error):
    env, backend, calls, image = native_backend
    image[attribute] = value
    gen = dict(id="generation", generation=1, region="us-west-2", image_id="ami-base", agent_token="a" * 40)
    with pytest.raises(ProviderError, match=error):
        await backend.launch({"id": "rental"}, gen, env.offer, env.request.rfq)
    assert not any(method == "run_instances" for _, method, _ in calls)


async def test_initial_image_cannot_expose_another_rentals_private_backup(native_backend):
    from spotbot.rental_aws import approved_initial_image

    env, backend, calls, image = native_backend
    gen = dict(id="generation", generation=1, region="us-west-2", image_id="ami-other-private", agent_token="a" * 40)
    with pytest.raises(ProviderError, match="initial_image_not_approved"):
        await backend.launch({"id": "another-tenant"}, gen, env.offer, env.request.rfq)
    assert not any(method == "run_instances" for _, method, _ in calls)
    assert not approved_initial_image(image)
    assert approved_initial_image({**image, "Public": True})
    assert not approved_initial_image({**image, "Tags": [{"Key": "spotbot-initial-image", "Value": "true"}]})
    assert approved_initial_image({**image, "Tags": [*image["Tags"], {"Key": "spotbot-initial-image", "Value": "true"}]})


async def test_enrolled_operator_base_may_have_a_larger_root_than_the_rfq(native_backend):
    import json

    env, backend, calls, image = native_backend
    env.service.settings.spotbot_rental_initial_images = json.dumps({"us-west-2": "ami-operator"})
    image["Tags"] = [*image["Tags"], {"Key": "spotbot-initial-image", "Value": "true"}]
    image["BlockDeviceMappings"][0]["Ebs"]["VolumeSize"] = 75
    gen = dict(id="generation", generation=1, region="us-west-2", image_id="ami-operator", agent_token="a" * 40)
    await backend.launch({"id": "rental"}, gen, env.offer, env.request.rfq)
    root = next(m for _, m2, p in calls if m2 == "run_instances" for m in p["BlockDeviceMappings"] if m["DeviceName"] == "/dev/sda1")
    assert root["Ebs"]["VolumeSize"] == 75


@pytest.mark.parametrize("extra_disk", [True, False])
async def test_custom_image_cannot_add_unrequested_or_oversized_disks(native_backend, extra_disk):
    env, backend, calls, image = native_backend
    image["Public"] = True
    if extra_disk:
        image["BlockDeviceMappings"].append({"DeviceName": "/dev/sdg", "Ebs": {"VolumeSize": 1000}})
    else:
        image["BlockDeviceMappings"][0]["Ebs"]["VolumeSize"] = 1000
    gen = dict(id="generation", generation=1, region="us-west-2", image_id="ami-custom", agent_token="a" * 40)
    with pytest.raises(ProviderError, match="initial_image_disk_layout_exceeds_rfq"):
        await backend.launch({"id": "rental"}, gen, env.offer, env.request.rfq)
    assert not any(method == "run_instances" for _, method, _ in calls)


async def test_preflight_refreshes_prices_and_account_quota(rental_env):
    from spotbot.aws_provider import AWSProvider
    from tests.test_aws import FakeAWS

    env = rental_env
    sdk = FakeAWS()
    backend = AWSRecovery(SimpleNamespace(), env.service.settings)
    backend.provider = AWSProvider(env.service.settings, env.service.client, session=sdk)
    offer = env.offer.model_copy(update={"sku": "p5.4xlarge"})
    await backend.preflight(offer, env.request.rfq)
    env.request.rfq.max_price_hourly = Decimal("2.55")
    with pytest.raises(ProviderError, match="price_limit_exceeded"):
        await backend.preflight(offer, env.request.rfq)
    env.request.rfq.max_price_hourly = Decimal("3")
    sdk.spot_instances = [
        {"InstanceId": f"i-already-used-{i}", "InstanceType": "p5.4xlarge"} for i in range(4)
    ]
    with pytest.raises(ProviderError, match="quota_insufficient"):
        await backend.preflight(offer, env.request.rfq)
    assert not sdk.creates


async def test_sweep_cache_reuses_account_usage_but_rereads_each_price(rental_env, monkeypatch):
    from spotbot.aws_provider import AWSProvider
    from tests.test_aws import FakeAWS

    env = rental_env
    sdk = FakeAWS()
    backend = AWSRecovery(SimpleNamespace(), env.service.settings)
    backend.provider = AWSProvider(env.service.settings, env.service.client, session=sdk)
    counts = {"specs": 0, "usage": 0}
    specs, usage = backend.provider._instance_types, backend.provider._quota_usage

    def counted_specs(ec2):
        counts["specs"] += 1
        return specs(ec2)

    def counted_usage(ec2, value):
        counts["usage"] += 1
        return usage(ec2, value)

    monkeypatch.setattr(backend.provider, "_instance_types", counted_specs)
    monkeypatch.setattr(backend.provider, "_quota_usage", counted_usage)
    offer = env.offer.model_copy(update={"sku": "p5.4xlarge"})
    sweep = {}
    await backend.preflight(offer, env.request.rfq, sweep)
    await backend.preflight(offer, env.request.rfq, sweep)
    assert counts == {"specs": 1, "usage": 1}
    env.request.rfq.max_price_hourly = Decimal("2.55")
    with pytest.raises(ProviderError, match="price_limit_exceeded"):
        await backend.preflight(offer, env.request.rfq, sweep)  # Price is never cached.
    env.request.rfq.max_price_hourly = Decimal("3")
    await backend.preflight(offer, env.request.rfq)  # No sweep: always fresh.
    assert counts == {"specs": 2, "usage": 2}


async def test_interruption_is_confirmed_from_spot_request_status(native_backend):
    env, backend, calls, image = native_backend
    gen = dict(region="us-west-2", instance_id="i-12345678")

    async def running(generation):
        return {"State": {"Name": "running"}}

    backend.instance = running
    assert not await backend.interruption_confirmed(gen)
    for code in ("marked-for-termination", "instance-terminated-no-capacity"):
        backend.spot_status["code"] = code
        assert await backend.interruption_confirmed(gen)
    query = next(p for _, m, p in calls if m == "describe_spot_instance_requests")
    assert query["Filters"] == [{"Name": "instance-id", "Values": ["i-12345678"]}]

