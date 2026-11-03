import base64
import subprocess
from uuid import uuid4

import pytest
from botocore.handlers import base64_encode_user_data
from botocore.session import get_session
from botocore.validate import validate_parameters

from spotbot.inference_build import base_allowed, labels, launch_request, owned, prepared


def environment():
    state = dict(
        build_id=str(uuid4()),
        account="123456789012",
        preset_id="deepseek-r1-distill-7b",
        revision="a" * 40,
        image="vllm/vllm-openai@sha256:" + "b" * 64,
        base_image="ami-1234567890abcdef0",
        subnet_id="subnet-1234",
        security_groups=["sg-1234"],
        instance_type="t3.medium",
        max_minutes=90,
    )
    source = dict(
        OwnerId=state["account"],
        State="available",
        Public=False,
        Architecture="x86_64",
        RootDeviceName="/dev/sda1",
        Tags=[
            dict(Key="spotbot-managed", Value="true"),
            dict(Key="spotbot-initial-image", Value="true"),
        ],
        BlockDeviceMappings=[
            dict(
                DeviceName="/dev/sda1",
                Ebs=dict(VolumeSize=75, Encrypted=True, SnapshotId="snap-base"),
            )
        ],
    )
    return state, source


def test_build_request_is_bounded_cpu_only_and_all_disks_are_encrypted_ephemeral():
    state, source = environment()
    request = launch_request(state, source)
    assert request["InstanceType"] == "t3.medium"
    assert request["CreditSpecification"] == dict(CpuCredits="standard")
    assert (
        "InstanceMarketOptions" not in request
        and "IamInstanceProfile" not in request
        and "KeyName" not in request
    )
    assert request["MaxCount"] == 1 and request["InstanceInitiatedShutdownBehavior"] == "stop"
    assert all(
        m["Ebs"]["Encrypted"] and m["Ebs"]["DeleteOnTermination"]
        for m in request["BlockDeviceMappings"]
    )
    assert len(request["UserData"].encode()) < 16384
    assert subprocess.run(["bash", "-n"], input=request["UserData"].encode()).returncode == 0
    base64_encode_user_data(request)
    shape = get_session().get_service_model("ec2").operation_model("RunInstances").input_shape
    validate_parameters(request, shape)
    for update in [dict(instance_type="p6-b300.48xlarge"), dict(max_minutes=100)]:
        with pytest.raises(ValueError, match="cpu_build_limits_exceeded"):
            launch_request(dict(state, **update), source)
    assert launch_request(dict(state, cpu_credits="unlimited"), source)[
        "CreditSpecification"
    ] == dict(CpuCredits="unlimited")
    with pytest.raises(ValueError, match="invalid_cpu_credit_mode"):
        launch_request(dict(state, cpu_credits="invalid"), source)
    assert (
        launch_request(dict(state, instance_type="t3.large"), source)["InstanceType"] == "t3.large"
    )


def test_customer_images_and_other_accounts_can_never_be_used_as_shared_bases():
    state, source = environment()
    assert base_allowed(source, state["account"])
    assert not base_allowed(source, "other-account")
    for key in ["spotbot-rental", "spotbot-backup", "spotbot-inference-preset"]:
        assert not base_allowed(
            dict(source, Tags=[*source["Tags"], dict(Key=key, Value="customer")]), state["account"]
        )
    assert not base_allowed(dict(source, Public=True), state["account"])


def test_only_this_builds_completion_marker_and_resource_tags_are_accepted():
    state, _ = environment()
    marker = "SPOTBOT_IMAGE_PREPARED:" + state["build_id"]
    assert prepared(marker, state) and prepared(base64.b64encode(marker.encode()).decode(), state)
    assert not prepared("SPOTBOT_IMAGE_PREPARED:another-build", state)
    assert owned(dict(Tags=labels(state)), state)
    assert not owned(dict(Tags=labels(dict(state, build_id="another-build"))), state)


def test_data_disk_is_identified_by_id_even_when_the_base_automounts_it():
    from spotbot.guest_image import model_disk

    root = dict(
        path="/dev/nvme0n1",
        type="disk",
        serial="volroot",
        size=100 * 2**30,
        fstype="ext4",
        mountpoints=["/"],
    )
    data = dict(
        path="/dev/nvme1n1",
        type="disk",
        serial="voldata",
        size=100 * 2**30,
        fstype="xfs",
        mountpoints=["/opt/dlami/nvme"],
    )
    assert model_disk([root, data], "voldata", 100) == data
    assert model_disk([root, data], "missing", 100) is None
    with pytest.raises(RuntimeError, match="cannot_be_root"):
        model_disk([root, data], "volroot", 100)


def test_private_progress_capability_is_limited_to_one_temporary_object():
    from unittest.mock import MagicMock

    from scripts.prepare_inference_image import progress_channel

    state, _ = environment()
    state["region"] = "us-west-2"
    s3 = MagicMock()
    s3.get_bucket_tagging.return_value = dict(
        TagSet=[
            dict(Key="spotbot-managed", Value="true"),
            dict(Key="spotbot-purpose", Value="inference-image-build"),
        ]
    )
    s3.generate_presigned_url.return_value = "https://private.example/limited-capability"
    progress_channel(s3, state)
    capability = s3.generate_presigned_url.call_args
    assert capability.args == ("put_object",)
    assert capability.kwargs["Params"]["Key"] == "builds/" + state["build_id"] + ".json"
    assert capability.kwargs["ExpiresIn"] == 7200
    public = s3.put_public_access_block.call_args.kwargs["PublicAccessBlockConfiguration"]
    assert all(public.values())
    assert s3.put_bucket_lifecycle_configuration.call_args.kwargs["LifecycleConfiguration"][
        "Rules"
    ][0]["Expiration"] == dict(Days=1)


def test_progress_channel_refuses_unrelated_buckets():
    from unittest.mock import MagicMock

    from scripts.prepare_inference_image import progress_channel

    state, _ = environment()
    state["region"] = "us-west-2"
    s3 = MagicMock()
    s3.get_bucket_tagging.return_value = dict(
        TagSet=[dict(Key="spotbot-purpose", Value="another-app")]
    )
    with pytest.raises(RuntimeError, match="progress_bucket_not_owned"):
        progress_channel(s3, state)
    s3.put_object.assert_not_called()
    s3.put_public_access_block.assert_not_called()


def test_progress_cleanup_cannot_delete_an_unrelated_key():
    from unittest.mock import MagicMock

    from scripts.prepare_inference_image import delete_progress

    state, _ = environment()
    state.update(region="us-west-2", status_bucket="another-app", status_key="important.json")
    s3 = MagicMock()
    with pytest.raises(RuntimeError, match="cleanup_scope_mismatch"):
        delete_progress(s3, state)
    s3.delete_object.assert_not_called()


def test_status_delivery_outage_does_not_discard_prepared_artifacts(monkeypatch):
    import urllib.error

    from spotbot import guest_image

    monkeypatch.setattr(
        guest_image, "REPORT", dict(build_id="test", status_url="https://private.example")
    )
    monkeypatch.setattr(guest_image, "PROGRESS", {})

    def unavailable(*args, **kwargs):
        raise urllib.error.URLError("temporary outage")

    monkeypatch.setattr(guest_image.urllib.request, "urlopen", unavailable)
    guest_image.event("prepared", artifact_bytes=123)
    assert guest_image.PROGRESS["stage"] == "prepared"


def test_long_running_command_reports_progress_and_obeys_deadline(monkeypatch):
    from unittest.mock import MagicMock

    from spotbot import guest_image

    process = MagicMock()
    process.wait.side_effect = [subprocess.TimeoutExpired("docker", 30), 0]
    process.poll.return_value = None
    monkeypatch.setattr(guest_image.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(guest_image, "REPORT", dict(deadline=0))
    events = []
    monkeypatch.setattr(
        guest_image, "event", lambda state, **fields: events.append((state, fields))
    )
    with pytest.raises(RuntimeError, match="cpu_build_deadline_exceeded"):
        guest_image.observed(["docker", "pull", "public-pinned-image"], "pulling_runtime")
    process.kill.assert_called_once()
    assert events[0][0] == "pulling_runtime" and events[0][1]["free_root_bytes"] > 0
