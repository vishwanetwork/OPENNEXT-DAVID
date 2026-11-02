"""Bounded CPU cache-image build requests and ownership checks."""

import base64
import gzip
import json
from pathlib import Path

from spotbot.guest_inference import DOWNLOAD
from spotbot.inference import PRESETS


def labels(state):
    values = {
        "spotbot-managed": "true",
        "spotbot-image-build": state["build_id"],
        "spotbot-initial-image": "true",
        "spotbot-inference-preset": state["preset_id"],
        "spotbot-model-revision": state["revision"],
        "spotbot-runtime-digest": state["image"].split("@", 1)[1],
    }
    return [{"Key": k, "Value": v} for k, v in values.items()]


def owned(resource, state):
    tags = {t["Key"]: t["Value"] for t in resource.get("Tags", [])}
    return (
        tags.get("spotbot-managed") == "true"
        and tags.get("spotbot-image-build") == state["build_id"]
    )


def base_allowed(image, account):
    tags = {t["Key"]: t["Value"] for t in image.get("Tags", [])}
    ebs = [m for m in image.get("BlockDeviceMappings", []) if "Ebs" in m]
    return (
        image.get("OwnerId") == account
        and image.get("State") == "available"
        and not image.get("Public")
        and image.get("Architecture") == "x86_64"
        and tags.get("spotbot-managed") == "true"
        and tags.get("spotbot-initial-image") == "true"
        and not any(
            k in tags for k in ["spotbot-rental", "spotbot-backup", "spotbot-inference-preset"]
        )
        and len(ebs) == 1
        and ebs[0]["DeviceName"] == image["RootDeviceName"]
        and ebs[0]["Ebs"].get("Encrypted") is True
        and ebs[0]["Ebs"]["VolumeSize"] <= 100
    )


def user_data(state):
    config = {k: state[k] for k in ["build_id", "preset_id", "revision", "image", "max_minutes"]}
    config.update(
        repo=PRESETS[state["preset_id"]]["repo"],
        disk_gib=PRESETS[state["preset_id"]]["disk_gib"],
        download=DOWNLOAD,
    )
    bundle = json.dumps(
        {
            "build.py": Path(__file__).with_name("guest_image.py").read_text(),
            "build.json": json.dumps(config),
        }
    ).encode()
    script = "\n".join(
        [
            "#!/bin/bash",
            "set -eu",
            "umask 077",
            "mkdir -p /opt/spotbot-cache",
            "exec > >(tee -a /var/log/spotbot-image-build.log /dev/console) 2>&1",
            "base64 -d <<'BUNDLE' | python3 -c \"import sys,json,gzip,pathlib; [pathlib.Path('/opt/spotbot-cache/'+n).write_text(s) for n,s in json.loads(gzip.decompress(sys.stdin.buffer.read())).items()]\"",
            base64.b64encode(gzip.compress(bundle, 9, mtime=0)).decode(),
            "BUNDLE",
            "exec python3 /opt/spotbot-cache/build.py",
        ]
    )
    if len(script.encode()) >= 16384:
        raise ValueError("build_user_data_too_large")
    return script


def launch_request(state, source):
    if state["instance_type"] != "t3.medium" or not 10 <= state["max_minutes"] <= 90:
        raise ValueError("cpu_build_limits_exceeded")
    if not base_allowed(source, state["account"]):
        raise ValueError("clean_encrypted_base_image_required")
    return dict(
        ImageId=state["base_image"],
        InstanceType=state["instance_type"],
        MinCount=1,
        MaxCount=1,
        ClientToken=state["build_id"],
        CreditSpecification={"CpuCredits": "standard"},
        InstanceInitiatedShutdownBehavior="stop",
        MetadataOptions={"HttpTokens": "required", "HttpEndpoint": "enabled"},
        NetworkInterfaces=[
            dict(
                DeviceIndex=0,
                SubnetId=state["subnet_id"],
                Groups=state["security_groups"],
                AssociatePublicIpAddress=True,
                DeleteOnTermination=True,
            )
        ],
        BlockDeviceMappings=[
            dict(
                DeviceName=source["RootDeviceName"],
                Ebs=dict(
                    VolumeSize=100, VolumeType="gp3", Encrypted=True, DeleteOnTermination=True
                ),
            ),
            dict(
                DeviceName="/dev/sdf",
                Ebs=dict(
                    VolumeSize=PRESETS[state["preset_id"]]["disk_gib"],
                    VolumeType="gp3",
                    Encrypted=True,
                    DeleteOnTermination=True,
                ),
            ),
        ],
        TagSpecifications=[
            dict(ResourceType=kind, Tags=labels(state)) for kind in ["instance", "volume"]
        ],
        UserData=user_data(state),
    )


def prepared(output, state):
    marker = "SPOTBOT_IMAGE_PREPARED:" + state["build_id"]
    if marker in output:
        return True
    try:
        return marker in base64.b64decode(output).decode(errors="replace")
    except (ValueError, TypeError):
        return False
