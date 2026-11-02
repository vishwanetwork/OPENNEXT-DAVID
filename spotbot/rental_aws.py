"""AWS primitives for protected servers. Workflow decisions live in rentals.py."""

import base64
import gzip
import hashlib
import json
from decimal import Decimal
from pathlib import Path

from spotbot.models import timestamp, utcnow
from spotbot.providers import ProviderError


def tags(rental_id, generation, **extra):
    values = {
        "spotbot-managed": "true",
        "spotbot-rental": rental_id,
        "spotbot-generation": str(generation),
        **extra,
    }
    return [{"Key": k, "Value": str(v)} for k, v in values.items()]


def owns(resource, rental_id):
    labels = {t["Key"]: t["Value"] for t in resource.get("Tags", [])}
    return labels.get("spotbot-managed") == "true" and labels.get("spotbot-rental") == rental_id


def approved_initial_image(image):
    """Private backups are tenant data, not a shared image catalog."""
    labels = {t["Key"]: t["Value"] for t in image.get("Tags", [])}
    return image.get("Public") is True or (
        labels.get("spotbot-managed") == "true"
        and labels.get("spotbot-initial-image") == "true"
    )


def initial_image(rules, settings, region, offer_image):
    """RFQ image, else the operator's enrolled base for the Region, else the provider default."""
    return (
        rules.initial_image_ids.get(region)
        or settings.rental_initial_images.get(region)
        or offer_image
    )


def operator_image(image_id, settings, region, offer_image):
    # Operator defaults size disks like the provider default; RFQ images may not grow them.
    return image_id in {offer_image, settings.rental_initial_images.get(region)}


def initial_disk_layout_allowed(image, rules, *, strict_sizes=False):
    required = {image["RootDeviceName"]: rules.root_volume_gib, **{d.device: d.size_gib for d in rules.data_disks}}
    source = {m["DeviceName"]: m["Ebs"] for m in image["BlockDeviceMappings"] if "Ebs" in m}
    return not (set(source) - set(required)) and (
        not strict_sizes or all(v.get("VolumeSize", 0) <= required[k] for k, v in source.items())
    )


def bootstrap(base_url, rental_id, generation, token, *, ssh_user="ubuntu", public_key=None):
    source = json.dumps({
        'agent.py': Path(__file__).with_name('guest_agent.py').read_text(),
        'spotbot_inference.py': Path(__file__).with_name('guest_inference.py').read_text(),
    }).encode()
    config = json.dumps(
        dict(url=base_url.rstrip("/"), rental_id=rental_id, generation=generation, token=token)
    ).encode()
    return "\n".join(
        [
            "#!/bin/bash",
            "set -eu",
            "umask 077",
            "mkdir -p /opt/spotbot /etc/spotbot /etc/cloud/cloud.cfg.d",
            # First boot generates unique host keys before user scripts run. Preserve
            # those keys in subsequent whole-server restores, without disabling client verification.
            "cat > /etc/cloud/cloud.cfg.d/99-spotbot-ssh-identity.cfg <<'SPOTBOT_SSH_IDENTITY'",
            "#cloud-config",
            "ssh_deletekeys: false",
            "SPOTBOT_SSH_IDENTITY",
            # Compressed so the agent plus a customer key stay well inside 16 KB of user data.
            "base64 -d <<'SPOTBOT_AGENT' | python3 -c \"import gzip,json,sys,pathlib; [pathlib.Path('/opt/spotbot/'+n).write_text(s) for n,s in json.loads(gzip.decompress(sys.stdin.buffer.read())).items()]\"",
            base64.b64encode(gzip.compress(source, 9, mtime=0)).decode(),
            "SPOTBOT_AGENT",
            "base64 -d > /etc/spotbot/agent.json <<'SPOTBOT_CONFIG'",
            base64.b64encode(config).decode(),
            "SPOTBOT_CONFIG",
            "cat > /etc/systemd/system/spotbot-agent.service <<'SPOTBOT_UNIT'",
            "[Unit]",
            "After=network-online.target",
            "Wants=network-online.target",
            "[Service]",
            "ExecStart=/usr/bin/python3 /opt/spotbot/agent.py",
            "Restart=always",
            "RestartSec=5",
            "[Install]",
            "WantedBy=multi-user.target",
            "SPOTBOT_UNIT",
            "systemctl daemon-reload",
            "systemctl enable --now spotbot-agent",
            *authorized_key(ssh_user, public_key),
        ]
    )


def authorized_key(user, public_key):
    """Install the customer's public key at first boot, in the block the guest agent manages
    (it then keeps that block equal to the rental's key set). Restored disks keep their block."""
    if not public_key:
        return []
    encoded = base64.b64encode(public_key.strip().encode()).decode()
    return [
        f"home=$(getent passwd {user} | cut -d: -f6)",
        f'install -d -m 700 -o {user} -g {user} "$home/.ssh"',
        f"key=$(echo {encoded} | base64 -d)",
        'touch "$home/.ssh/authorized_keys"',
        'grep -qxF "# BEGIN spotbot managed keys" "$home/.ssh/authorized_keys" || printf'
        """ '%s\\n' '# BEGIN spotbot managed keys' "$key" '# END spotbot managed keys'"""
        ' >> "$home/.ssh/authorized_keys"',
        f'chown {user}:{user} "$home/.ssh/authorized_keys"',
        'chmod 600 "$home/.ssh/authorized_keys"',
    ]


class AWSRecovery:
    def __init__(self, provider, settings, guard=None):
        from spotbot.aws_provider import AWSProvider

        # Price sweeps can take minutes; recovery must not wait behind their SDK lock.
        self.provider = (
            AWSProvider(settings, provider.client)
            if isinstance(provider, AWSProvider)
            else provider
        )
        self.settings = settings
        self.guard = guard or (lambda: None)

    async def call(self, region, method, *, mutation=False, **kwargs):
        if mutation:
            self.guard()
        return await self.provider._execute(
            lambda: getattr(self.provider._client(region), method)(**kwargs), mutation=mutation
        )

    async def instance(self, generation):
        try:
            response = await self.call(
                generation["region"], "describe_instances", InstanceIds=[generation["instance_id"]]
            )
        except ProviderError as exc:
            if exc.code == "http_404":
                return None
            raise
        items = [i for r in response["Reservations"] for i in r["Instances"]]
        if not items:
            return None
        item = items[0]
        if not owns(item, generation["rental_id"]):
            raise ProviderError("instance_ownership_mismatch")
        return item

    async def inventory(self, generation, instance):
        ids = [m["Ebs"]["VolumeId"] for m in instance.get("BlockDeviceMappings", []) if "Ebs" in m]
        if not ids:
            raise ProviderError("protected_disks_missing")
        response = await self.call(generation["region"], "describe_volumes", VolumeIds=ids)
        volumes = {v["VolumeId"]: v for v in response["Volumes"]}
        if set(volumes) != set(ids):
            raise ProviderError("incomplete_disk_inventory")
        result = []
        for mapping in instance["BlockDeviceMappings"]:
            if "Ebs" not in mapping:
                continue
            volume = volumes[mapping["Ebs"]["VolumeId"]]
            if not owns(volume, generation["rental_id"]):
                raise ProviderError("disk_ownership_mismatch")
            if not volume.get("Encrypted"):
                raise ProviderError("unencrypted_protected_disk")
            if mapping["Ebs"].get("DeleteOnTermination", True):
                await self.call(
                    generation["region"],
                    "modify_instance_attribute",
                    mutation=True,
                    InstanceId=instance["InstanceId"],
                    BlockDeviceMappings=[
                        {
                            "DeviceName": mapping["DeviceName"],
                            "Ebs": {"DeleteOnTermination": False},
                        }
                    ],
                )
                raise ProviderError("disk_retention_verification_pending", retryable=True)
            result.append(
                dict(
                    volume_id=volume["VolumeId"],
                    device=mapping["DeviceName"],
                    size_gib=volume["Size"],
                    kms_key_id=volume.get("KmsKeyId"),
                )
            )
        return result

    async def interruption_confirmed(self, generation):
        """Whether AWS itself reports this Spot instance as being reclaimed or gone.

        A guest's report alone is not trusted: the customer has root and could forge it to
        force paid replacements.
        """
        response = await self.call(
            generation["region"],
            "describe_spot_instance_requests",
            Filters=[{"Name": "instance-id", "Values": [generation["instance_id"]]}],
        )
        codes = {r.get("Status", {}).get("Code", "") for r in response.get("SpotInstanceRequests", [])}
        if codes & {"marked-for-termination", "marked-for-stop", "marked-for-hibernation"} or any(
            code.startswith("instance-terminated") for code in codes
        ):
            return True
        instance = await self.instance(generation)
        return not instance or instance["State"]["Name"] != "running"

    async def source_keys(self, region, source, backup):
        """KMS key of each encrypted source snapshot, by device."""
        if backup:
            return {v["device"]: v["kms_key_id"] for v in backup["volumes"] if v.get("kms_key_id")}
        encrypted = {
            m["Ebs"]["SnapshotId"]: device
            for device, m in source.items()
            if m["Ebs"].get("Encrypted") and m["Ebs"].get("SnapshotId")
        }
        if not encrypted:
            return {}  # Unencrypted sources are re-encrypted; their first capture is full.
        response = await self.call(region, "describe_snapshots", SnapshotIds=sorted(encrypted))
        return {
            encrypted[s["SnapshotId"]]: s["KmsKeyId"]
            for s in response["Snapshots"]
            if s.get("KmsKeyId") and s["SnapshotId"] in encrypted
        }

    async def image(self, region, image_id):
        response = await self.call(region, "describe_images", ImageIds=[image_id])
        if len(response["Images"]) != 1:
            raise ProviderError("restore_image_missing")
        return response["Images"][0]

    async def preflight(self, offer, rules, cache=None):
        """Refresh account usage and the selected zonal quote before a billable create.

        `cache` spans one acquisition sweep: rejected requests create nothing, so account
        usage, quotas and instance specs are reused; each pool's price is always re-read.
        """

        def check():
            ec2 = self.provider._client(offer.region)
            regional = (cache if cache is not None else {}).setdefault(offer.region, {})
            if "specs" not in regional:
                regional["specs"], _ = self.provider._instance_types(ec2)
                regional["usage"] = self.provider._quota_usage(ec2, regional["specs"])
            specs = regional["specs"]
            family = self.provider._quota_family(offer.sku)
            if not family or offer.sku not in specs:
                raise ProviderError("unsupported_instance_quota_family")
            used, known = regional["usage"]
            code = "L-3819A6DF" if family == "g" else "L-7212CCBC"
            if code not in regional:
                regional[code] = self.provider._client(
                    offer.region, "service-quotas"
                ).get_service_quota(ServiceCode="ec2", QuotaCode=code)["Quota"]["Value"]
            quota = regional[code]
            if (
                not known[family]
                or used[family] + specs[offer.sku]["VCpuInfo"]["DefaultVCpus"] > quota
            ):
                raise ProviderError("quota_insufficient", retryable=True)
            quotes = []
            for page in ec2.get_paginator("describe_spot_price_history").paginate(
                InstanceTypes=[offer.sku],
                AvailabilityZone=offer.availability_zone,
                ProductDescriptions=["Linux/UNIX"],
                StartTime=utcnow(),
            ):
                quotes.extend(
                    q
                    for q in page["SpotPriceHistory"]
                    if q["InstanceType"] == offer.sku
                    and q["AvailabilityZone"] == offer.availability_zone
                )
            if (
                not quotes
                or Decimal(max(quotes, key=lambda q: q["Timestamp"])["SpotPrice"])
                > rules.max_price_hourly
            ):
                raise ProviderError("price_limit_exceeded", retryable=True)

        await self.provider._execute(check)

    async def launch(self, rental, generation, offer, rules, backup=None, *, sweep=None):
        region = generation["region"]
        image_id = generation["image_id"]
        image = await self.image(region, image_id)
        if image["State"] != "available" or image["Architecture"] != rules.architecture:
            raise ProviderError("image_not_compatible")
        if image.get("RootDeviceType", "ebs") != "ebs":
            raise ProviderError("image_requires_ebs_root")
        if image.get("PlatformDetails", "Linux/UNIX") != "Linux/UNIX" or image.get("ProductCodes"):
            raise ProviderError("unsupported_image_license")
        if not backup and image_id != offer.details["image_id"] and not approved_initial_image(image):
            raise ProviderError("initial_image_not_approved")
        if not backup and not initial_disk_layout_allowed(
            image,
            rules,
            strict_sizes=not operator_image(
                image_id, self.settings, region, offer.details["image_id"]
            ),
        ):
            raise ProviderError("initial_image_disk_layout_exceeds_rfq")
        if backup and not owns(image, rental["id"]):
            raise ProviderError("restore_image_ownership_mismatch")
        source = {m["DeviceName"]: m for m in image["BlockDeviceMappings"] if "Ebs" in m}
        root = image["RootDeviceName"]
        required = {root: rules.root_volume_gib, **{d.device: d.size_gib for d in rules.data_disks}}
        if backup and set(source) != {v["device"] for v in backup["volumes"]}:
            raise ProviderError("restore_disk_set_mismatch")
        keys = await self.source_keys(region, source, backup)
        mappings = []
        for device in sorted(set(source) | set(required)):
            old = source.get(device, {}).get("Ebs", {})
            size = max(required.get(device, 0), old.get("VolumeSize", 0))
            mapping = {
                "DeviceName": device,
                "Ebs": {
                    "VolumeSize": size,
                    "VolumeType": "gp3",
                    "Encrypted": True,
                    "DeleteOnTermination": False,
                },
            }
            if old.get("SnapshotId"):
                mapping["Ebs"]["SnapshotId"] = old["SnapshotId"]
            if keys.get(device):
                # Same key as the source snapshot keeps the EBS lineage, so the next capture is
                # incremental instead of a full copy of a re-encrypted disk.
                mapping["Ebs"]["KmsKeyId"] = keys[device]
            mappings.append(mapping)
        await self.preflight(offer, rules, sweep)
        if rules.expires_at <= utcnow() or (
            not rental.get("recovery_started_at") and rules.acquisition_deadline <= utcnow()
        ):
            raise ProviderError("rfq_execution_deadline_expired")
        payload = dict(
            ImageId=image_id,
            InstanceType=offer.sku,
            MinCount=1,
            MaxCount=1,
            ClientToken=generation["id"],
            Placement={"AvailabilityZone": offer.availability_zone},
            InstanceMarketOptions={
                "MarketType": "spot",
                "SpotOptions": {
                    "SpotInstanceType": "one-time",
                    "InstanceInterruptionBehavior": "terminate",
                    "MaxPrice": str(rules.max_price_hourly),
                },
            },
            NetworkInterfaces=[
                {
                    "DeviceIndex": 0,
                    "SubnetId": offer.details["subnet_id"],
                    "Groups": offer.details["security_group_ids"],
                    "AssociatePublicIpAddress": self.settings.spotbot_aws_public_ip,
                    "DeleteOnTermination": True,
                }
            ],
            BlockDeviceMappings=mappings,
            InstanceInitiatedShutdownBehavior="terminate",
            MetadataOptions={"HttpTokens": "required", "HttpEndpoint": "enabled"},
            TagSpecifications=[
                {
                    "ResourceType": kind,
                    "Tags": tags(
                        rental["id"],
                        generation["generation"],
                        Name="spotbot-rental-" + generation["id"],
                    ),
                }
                for kind in ["instance", "volume"]
            ],
            UserData=bootstrap(
                self.settings.spotbot_rental_public_url,
                rental["id"],
                generation["generation"],
                generation["agent_token"],
                ssh_user=rules.ssh_user,
                public_key=rules.ssh_public_key,
            ),
        )
        if rules.ssh_key_name:
            payload["KeyName"] = rules.ssh_key_name
        # Cloud-init recognizes binary gzip user data; boto3 performs the base64 encoding.
        # Large public keys plus the independent service must still fit EC2's raw 16 KiB cap.
        if len(payload["UserData"].encode()) >= 16384:
            payload["UserData"] = gzip.compress(payload["UserData"].encode(), 9, mtime=0)
        if len(payload["UserData"]) >= 16384:
            raise ProviderError("bootstrap_payload_too_large")
        response = await self.call(region, "run_instances", mutation=True, **payload)
        instances = response.get("Instances", [])
        if len(instances) != 1 or not instances[0].get("InstanceId"):
            raise ProviderError("invalid_create_response", ambiguous=True)
        return instances[0]["InstanceId"]

    async def find_instance(self, generation):
        response = await self.call(
            generation["region"],
            "describe_instances",
            Filters=[
                {"Name": "client-token", "Values": [generation["id"]]},
                {"Name": "tag:spotbot-rental", "Values": [generation["rental_id"]]},
            ],
        )
        found = [i for r in response["Reservations"] for i in r["Instances"]]
        if len(found) > 1:
            raise ProviderError("multiple_instances_for_attempt")
        return found[0]["InstanceId"] if found else None

    async def terminate(self, generation):
        item = await self.instance(generation)
        if item and item["State"]["Name"] not in {"terminated", "shutting-down"}:
            await self.inventory(generation, item)
            await self.call(
                generation["region"],
                "terminate_instances",
                mutation=True,
                InstanceIds=[generation["instance_id"]],
            )

    async def start_snapshots(self, backup, generation, volume=None):
        labels = tags(
            backup["rental_id"], generation["generation"], **{"spotbot-backup": backup["id"]}
        )
        params = dict(
            Description="SpotOrderBot whole-server backup " + backup["id"],
            TagSpecifications=[{"ResourceType": "snapshot", "Tags": labels}],
        )
        if volume:
            response = await self.call(
                backup["region"], "create_snapshot", mutation=True, VolumeId=volume, **params
            )
            return [response]
        response = await self.call(
            backup["region"],
            "create_snapshots",
            mutation=True,
            InstanceSpecification={
                "InstanceId": generation["instance_id"],
                "ExcludeBootVolume": False,
            },
            **params,
        )
        return response["Snapshots"]

    async def snapshots(self, backup):
        result = []
        params = dict(
            OwnerIds=["self"],
            Filters=[
                {"Name": "tag:spotbot-backup", "Values": [backup["id"]]},
                {"Name": "tag:spotbot-rental", "Values": [backup["rental_id"]]},
            ],
        )
        while True:
            response = await self.call(backup["region"], "describe_snapshots", **params)
            result.extend(response["Snapshots"])
            if not response.get("NextToken"):
                return result
            params["NextToken"] = response["NextToken"]

    async def register_image(self, backup, generation, snapshots):
        metadata = generation["image_metadata"]
        by_volume = {s["VolumeId"]: s for s in snapshots}
        payload = dict(
            Name="spotbot-backup-" + backup["id"],
            Architecture=metadata["Architecture"],
            RootDeviceName=metadata["RootDeviceName"],
            VirtualizationType="hvm",
            BlockDeviceMappings=[
                {
                    "DeviceName": v["device"],
                    "Ebs": {
                        "SnapshotId": by_volume[v["volume_id"]]["SnapshotId"],
                        "VolumeSize": v["size_gib"],
                        "DeleteOnTermination": False,
                    },
                }
                for v in backup["volumes"]
            ],
            TagSpecifications=[
                {
                    "ResourceType": "image",
                    "Tags": tags(
                        backup["rental_id"],
                        generation["generation"],
                        **{"spotbot-backup": backup["id"]},
                    ),
                }
            ],
        )
        for k in ["BootMode", "EnaSupport", "SriovNetSupport"]:
            if k in metadata:
                payload[k] = metadata[k]
        response = await self.call(backup["region"], "register_image", mutation=True, **payload)
        return response["ImageId"]

    async def find_image(self, backup):
        response = await self.call(
            backup["region"],
            "describe_images",
            Owners=["self"],
            Filters=[{"Name": "name", "Values": ["spotbot-backup-" + backup["id"]]}],
        )
        values = [i for i in response["Images"] if owns(i, backup["rental_id"])]
        if len(values) > 1:
            raise ProviderError("multiple_images_for_backup")
        return values[0]["ImageId"] if values else None

    async def copy_image(self, backup, destination):
        token = hashlib.sha256((backup["id"] + destination).encode()).hexdigest()
        response = await self.call(
            destination,
            "copy_image",
            mutation=True,
            SourceRegion=backup["region"],
            SourceImageId=backup["image_id"],
            Name="spotbot-backup-" + backup["id"],
            ClientToken=token,
            Encrypted=True,
            TagSpecifications=[
                {
                    "ResourceType": kind,
                    "Tags": tags(
                        backup["rental_id"],
                        backup["generation"],
                        **{"spotbot-backup": backup["id"]},
                    ),
                }
                for kind in ["image", "snapshot"]
            ],
        )
        return response["ImageId"]

    async def delete_backup(self, backup):
        found = await self.snapshots(backup)
        backup.setdefault("cleanup_snapshots", {}).setdefault(backup["region"], [])
        backup["cleanup_snapshots"][backup["region"]] = [s["SnapshotId"] for s in found]
        if not backup.get("image_id"):
            image_id = await self.find_image(backup)
            if image_id:
                backup["images"][backup["region"]] = image_id
        for region, image_id in backup.get("images", {}).items():
            try:
                image = await self.image(region, image_id)
            except ProviderError as exc:
                if exc.code == "aws_InvalidAMIID.NotFound":
                    continue
                raise
            if not owns(image, backup["rental_id"]):
                raise ProviderError("image_ownership_mismatch")
            # Save copied snapshot IDs before deregistration in the durable cleanup record.
            backup.setdefault("cleanup_snapshots", {}).setdefault(region, [])
            backup["cleanup_snapshots"][region] = sorted(
                set(backup["cleanup_snapshots"][region])
                | {
                    m["Ebs"]["SnapshotId"]
                    for m in image["BlockDeviceMappings"]
                    if m.get("Ebs", {}).get("SnapshotId")
                }
            )
        return backup

    async def volumes_available(self, generation):
        ids = [v["volume_id"] for v in generation["volumes"]]
        response = await self.call(generation["region"], "describe_volumes", VolumeIds=ids)
        return len(response["Volumes"]) == len(ids) and all(
            owns(v, generation["rental_id"]) and v["State"] == "available"
            for v in response["Volumes"]
        )

    async def delete_volume(self, generation, volume_id):
        try:
            response = await self.call(
                generation["region"], "describe_volumes", VolumeIds=[volume_id]
            )
        except ProviderError as exc:
            if exc.code == "aws_InvalidVolume.NotFound":
                return
            raise
        for volume in response["Volumes"]:
            if not owns(volume, generation["rental_id"]) or volume["State"] != "available":
                raise ProviderError("volume_not_safe_to_delete")
        await self.call(generation["region"], "delete_volume", mutation=True, VolumeId=volume_id)

    async def delete_image(self, region, image_id, rental_id):
        try:
            image = await self.image(region, image_id)
        except ProviderError as exc:
            if exc.code == "aws_InvalidAMIID.NotFound":
                return
            raise
        if not owns(image, rental_id):
            raise ProviderError("image_ownership_mismatch")
        await self.call(region, "deregister_image", mutation=True, ImageId=image_id)

    async def delete_snapshot(self, region, snapshot_id):
        try:
            await self.call(region, "delete_snapshot", mutation=True, SnapshotId=snapshot_id)
        except ProviderError as exc:
            if exc.code != "aws_InvalidSnapshot.NotFound":
                raise

    @staticmethod
    def capture_time():
        return timestamp()
