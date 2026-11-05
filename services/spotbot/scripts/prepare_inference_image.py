"""Build a private encrypted model cache AMI on one bounded CPU instance, never a GPU."""

import argparse
import json
import time
from pathlib import Path
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, ConnectionError, HTTPClientError

from spotbot.config import Settings
from spotbot.inference import PRESETS, catalog
from spotbot.inference_build import CPU_TYPES, base_allowed, labels, launch_request, owned, prepared


def save(path, state, phase):
    state.update(phase=phase, updated_at=time.time())
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(path)
    print(
        json.dumps({k: state.get(k) for k in ["build_id", "phase", "instance_id", "image_id"]}),
        flush=True,
    )


def instance(ec2, state):
    rows = ec2.describe_instances(InstanceIds=[state["instance_id"]])["Reservations"]
    value = rows[0]["Instances"][0]
    if (
        not owned(value, state)
        or value["InstanceType"] != state["instance_type"]
        or value["InstanceType"] not in CPU_TYPES
    ):
        raise RuntimeError("build_instance_ownership_mismatch")
    return value


def progress_channel(s3, state):
    bucket = "spotbot-inference-prep-" + state["account"] + "-" + state["region"]
    try:
        s3.head_bucket(Bucket=bucket, ExpectedBucketOwner=state["account"])
        tags = {t["Key"]: t["Value"] for t in s3.get_bucket_tagging(Bucket=bucket)["TagSet"]}
        if (
            tags.get("spotbot-purpose") != "inference-image-build"
            or tags.get("spotbot-managed") != "true"
        ):
            raise RuntimeError("progress_bucket_not_owned")
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in {"404", "NoSuchBucket", "NotFound"}:
            raise
        params = dict(Bucket=bucket)
        if state["region"] != "us-east-1":
            params["CreateBucketConfiguration"] = dict(LocationConstraint=state["region"])
        s3.create_bucket(**params)
        s3.put_bucket_tagging(
            Bucket=bucket,
            Tagging=dict(
                TagSet=[
                    dict(Key="spotbot-managed", Value="true"),
                    dict(Key="spotbot-purpose", Value="inference-image-build"),
                ]
            ),
        )
    s3.put_public_access_block(
        Bucket=bucket,
        PublicAccessBlockConfiguration=dict(
            BlockPublicAcls=True,
            IgnorePublicAcls=True,
            BlockPublicPolicy=True,
            RestrictPublicBuckets=True,
        ),
    )
    s3.put_bucket_encryption(
        Bucket=bucket,
        ServerSideEncryptionConfiguration=dict(
            Rules=[dict(ApplyServerSideEncryptionByDefault=dict(SSEAlgorithm="AES256"))]
        ),
    )
    s3.put_bucket_lifecycle_configuration(
        Bucket=bucket,
        LifecycleConfiguration=dict(
            Rules=[
                dict(
                    ID="expire-temporary-build-progress",
                    Status="Enabled",
                    Filter=dict(Prefix="builds/"),
                    Expiration=dict(Days=1),
                )
            ]
        ),
    )
    key = "builds/" + state["build_id"] + ".json"
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(dict(build_id=state["build_id"], state="planned")).encode(),
        ContentType="application/json",
    )
    state.update(
        status_bucket=bucket,
        status_key=key,
        status_url=s3.generate_presigned_url(
            "put_object",
            Params=dict(Bucket=bucket, Key=key, ContentType="application/json"),
            ExpiresIn=7200,
        ),
    )


def read_progress(s3, state):
    response = s3.get_object(Bucket=state["status_bucket"], Key=state["status_key"])
    try:
        value = json.loads(response["Body"].read(65537))
    finally:
        response["Body"].close()
    if value.get("build_id") != state["build_id"]:
        raise RuntimeError("progress_identity_mismatch")
    return value


def delete_progress(s3, state):
    expected = "spotbot-inference-prep-" + state["account"] + "-" + state["region"]
    if (
        state["status_bucket"] != expected
        or state["status_key"] != "builds/" + state["build_id"] + ".json"
    ):
        raise RuntimeError("progress_cleanup_scope_mismatch")
    s3.delete_object(Bucket=expected, Key=state["status_key"], ExpectedBucketOwner=state["account"])


def cleanup(ec2, state):
    ids = [state["instance_id"]] if state.get("instance_id") else []
    if not ids:
        for page in ec2.get_paginator("describe_instances").paginate(
            Filters=[{"Name": "tag:spotbot-image-build", "Values": [state["build_id"]]}]
        ):
            ids += [
                i["InstanceId"]
                for r in page["Reservations"]
                for i in r["Instances"]
                if owned(i, state)
                and i["InstanceType"] == state["instance_type"]
                and i["InstanceType"] in CPU_TYPES
            ]
    for resource_id in ids:
        try:
            value = instance(ec2, dict(state, instance_id=resource_id))
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "InvalidInstanceID.NotFound":
                continue
            raise
        if value["State"]["Name"] not in {"terminated", "shutting-down"}:
            ec2.terminate_instances(InstanceIds=[resource_id])
    # Failed partial images are not shared or retained as production candidates.
    if state.get("image_id") and state.get("phase") != "available":
        images = ec2.describe_images(ImageIds=[state["image_id"]])["Images"]
        if images and owned(images[0], state):
            snapshots = [
                m["Ebs"]["SnapshotId"]
                for m in images[0]["BlockDeviceMappings"]
                if "Ebs" in m and m["Ebs"].get("SnapshotId")
            ]
            ec2.deregister_image(ImageId=state["image_id"])
            for snapshot in ec2.describe_snapshots(SnapshotIds=snapshots)["Snapshots"]:
                if owned(snapshot, state):
                    ec2.delete_snapshot(SnapshotId=snapshot["SnapshotId"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="default")
    parser.add_argument("--region", default="us-west-2")
    parser.add_argument("--account-alias", default="default")
    parser.add_argument("--base-image", required=True)
    parser.add_argument("--subnet-id", required=True)
    parser.add_argument("--security-group", action="append", required=True)
    parser.add_argument("--preset", choices=list(PRESETS), default="deepseek-r1-distill-7b")
    parser.add_argument("--pins-env", type=Path, default=Path(".env.inference.example"))
    parser.add_argument("--max-minutes", type=int, choices=range(10, 91), default=90)
    parser.add_argument("--instance-type", choices=sorted(CPU_TYPES), default="t3.medium")
    parser.add_argument(
        "--cpu-credits",
        choices=["standard", "unlimited"],
        default="standard",
        help="Unlimited speeds decompression but may add bounded CPU-credit charges",
    )
    parser.add_argument("--state-file", type=Path, required=True)
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    config = Config(
        connect_timeout=5, read_timeout=30, retries={"mode": "standard", "max_attempts": 2}
    )
    ec2 = session.client("ec2", config=config)
    s3 = session.client(
        "s3",
        endpoint_url=f"https://s3.{args.region}.amazonaws.com",
        config=Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=30,
            retries={"mode": "standard", "max_attempts": 2},
        ),
    )
    account = session.client("sts", config=config).get_caller_identity()["Account"]
    if args.state_file.exists():
        state = json.loads(args.state_file.read_text())
        if (state["account"], state["region"], state["preset_id"]) != (
            account,
            args.region,
            args.preset,
        ):
            parser.error("The state file belongs to another account, Region or preset")
        if state["phase"] == "available":
            cleanup(ec2, state)
            if state.get("status_bucket"):
                delete_progress(s3, state)
            print(json.dumps(dict(image_id=state["image_id"], account=account, region=args.region)))
            return
        if state["phase"] in {"failed", "terminated"}:
            parser.error("This build already ended; use a new state file")
    else:
        pins = catalog(Settings(_env_file=args.pins_env))[args.preset]
        state = dict(
            build_id=str(uuid4()),
            account=account,
            account_alias=args.account_alias,
            region=args.region,
            preset_id=args.preset,
            revision=pins.revision,
            image=pins.image,
            base_image=args.base_image,
            subnet_id=args.subnet_id,
            security_groups=args.security_group,
            instance_type=args.instance_type,
            cpu_credits=args.cpu_credits,
            max_minutes=args.max_minutes,
            created_at=time.time(),
        )
        source = ec2.describe_images(ImageIds=[args.base_image])["Images"][0]
        if not base_allowed(source, account):
            parser.error("Source must be a clean, private, encrypted account-owned base AMI")
        save(args.state_file, state, "planned")
    try:
        if not state.get("instance_id"):
            progress_channel(s3, state)
            save(args.state_file, state, "planned")
            source = ec2.describe_images(ImageIds=[state["base_image"]])["Images"][0]
            value = ec2.run_instances(**launch_request(state, source))["Instances"][0]
            state["instance_id"] = value["InstanceId"]
            while True:
                value = instance(ec2, state)
                disks = [
                    m["Ebs"]["VolumeId"]
                    for m in value.get("BlockDeviceMappings", [])
                    if m["DeviceName"] == "/dev/sdf"
                ]
                if disks:
                    ec2.create_tags(
                        Resources=[state["instance_id"]],
                        Tags=[dict(Key="spotbot-model-volume", Value=disks[0])],
                    )
                    state["model_volume_id"] = disks[0]
                    break
                if time.time() - state["created_at"] > 120:
                    raise TimeoutError("model_disk_attachment_missing")
                time.sleep(2)
            save(args.state_file, state, "preparing")
        deadline = state["created_at"] + state["max_minutes"] * 60 + 300
        while not state.get("image_id"):
            try:
                value = instance(ec2, state)
                progress = read_progress(s3, state) if state.get("status_bucket") else {}
            except (ConnectionError, HTTPClientError):
                if time.time() > deadline:
                    raise TimeoutError("cpu_build_deadline_exceeded") from None
                print(json.dumps(dict(event="controller_connection_retry")), flush=True)
                time.sleep(15)
                continue
            if progress.get("state") != (state.get("guest_progress") or {}).get("state"):
                state["guest_progress"] = progress
                save(args.state_file, state, "preparing")
                print(
                    json.dumps(
                        dict(
                            event="guest_progress",
                            state=progress.get("state"),
                            error=progress.get("error"),
                        )
                    ),
                    flush=True,
                )
            if progress.get("state") == "failed":
                raise RuntimeError("guest_preparation_failed:" + progress.get("error", "unknown"))
            if value["State"]["Name"] == "stopped":
                console = ec2.get_console_output(InstanceId=state["instance_id"], Latest=True).get(
                    "Output", ""
                )
                if prepared(console, state) or progress.get("state") == "prepared":
                    name = "spotbot-inference-" + state["build_id"]
                    prior = ec2.describe_images(
                        Owners=[account], Filters=[{"Name": "name", "Values": [name]}]
                    )["Images"]
                    image_id = (
                        prior[0]["ImageId"]
                        if prior
                        else ec2.create_image(
                            InstanceId=state["instance_id"],
                            Name=name,
                            NoReboot=True,
                            Description="Clean pinned runtime and model artifacts; GPU inference not validated",
                            TagSpecifications=[
                                dict(ResourceType=k, Tags=labels(state))
                                for k in ["image", "snapshot"]
                            ],
                        )["ImageId"]
                    )
                    state["image_id"] = image_id
                    save(args.state_file, state, "snapshotting")
                    break
                if not state.get("stopped_at"):
                    state["stopped_at"] = time.time()
                    save(args.state_file, state, "checking_console")
                if time.time() - state["stopped_at"] > 180:
                    raise RuntimeError("preparation_marker_missing")
            elif value["State"]["Name"] in {"terminated", "shutting-down"}:
                raise RuntimeError("build_instance_terminated")
            if time.time() > deadline:
                raise TimeoutError("cpu_build_deadline_exceeded")
            time.sleep(15)
        # The CPU is stopped before snapshots are created; pending snapshots incur no CPU runtime.
        # A first, full snapshot takes roughly an hour per 50-100 GiB of model disk, so larger
        # presets wait longer instead of failing and deleting a nearly complete image.
        hours = max(2, -(-PRESETS[args.preset]["disk_gib"] // 50))
        snapshot_deadline = time.time() + hours * 3600
        while time.time() < snapshot_deadline:
            try:
                image = ec2.describe_images(ImageIds=[state["image_id"]])["Images"][0]
            except (ConnectionError, HTTPClientError):
                print(json.dumps(dict(event="snapshot_connection_retry")), flush=True)
                time.sleep(20)
                continue
            if not owned(image, state):
                raise RuntimeError("build_image_ownership_mismatch")
            if image["State"] == "available":
                if image.get("Public"):
                    raise RuntimeError("prepared_image_must_be_private")
                state["snapshots"] = [
                    m["Ebs"]["SnapshotId"] for m in image["BlockDeviceMappings"] if "Ebs" in m
                ]
                volumes = [m for m in image["BlockDeviceMappings"] if "Ebs" in m]
                if {m["DeviceName"] for m in volumes} != {
                    image["RootDeviceName"],
                    "/dev/sdf",
                } or any(not m["Ebs"].get("Encrypted") for m in volumes):
                    raise RuntimeError("invalid_prepared_image_disks")
                save(args.state_file, state, "available")
                print(
                    json.dumps(
                        dict(
                            image_id=state["image_id"],
                            account=account,
                            region=state["region"],
                            gpu_validation=False,
                        )
                    ),
                    flush=True,
                )
                return
            if image["State"] == "failed":
                raise RuntimeError("image_snapshot_failed")
            time.sleep(20)
        raise TimeoutError("image_snapshot_deadline_exceeded")
    except BaseException as exc:
        state["error"] = type(exc).__name__
        save(args.state_file, state, "failed")
        raise
    finally:
        try:
            cleanup(ec2, state)
        finally:
            if state.get("status_bucket"):
                delete_progress(s3, state)


if __name__ == "__main__":
    main()
