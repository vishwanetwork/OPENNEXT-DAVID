"""EC2 Spot adapter using the standard AWS SDK credential chain."""

import asyncio
import hashlib
from datetime import UTC, datetime
from decimal import Decimal

from spotbot.models import Offer, gpu_model
from spotbot.providers import Provider, ProviderError, validate_launch


class AWSProvider(Provider):
    name = "aws"
    base_url = "https://ec2.amazonaws.com"

    def __init__(self, settings, client, *, session=None):
        super().__init__(settings, client)
        self.session = session
        self.clients = {}
        self.sdk_lock = asyncio.Lock()
        self.image_cache = {}

    @property
    def regions(self):
        return list(
            dict.fromkeys(
                r.strip() for r in self.settings.spotbot_aws_regions.split(",") if r.strip()
            )
        )

    def _session(self):
        if self.session is None:
            try:
                import boto3
            except ImportError as exc:
                raise ProviderError("aws_sdk_not_installed") from exc
            self.session = boto3.Session()
        return self.session

    @property
    def configured(self):
        if not self.settings.enabled(self.name):
            return False
        try:
            return self._session().get_credentials() is not None
        except Exception:
            return False

    def _client(self, region, service="ec2"):
        from botocore.config import Config

        key = (region, service)
        if key not in self.clients:
            self.clients[key] = self._session().client(
                service,
                region_name=region,
                # Retrying an uncertain billable request is handled through reconciliation.
                config=Config(
                    retries={"total_max_attempts": 1},
                    connect_timeout=5,
                    read_timeout=self.settings.spotbot_http_timeout_seconds,
                ),
            )
        return self.clients[key]

    async def _execute(self, fn, *, mutation=False):
        from botocore.exceptions import BotoCoreError, ClientError

        async with self.sdk_lock:
            try:
                return await asyncio.to_thread(fn)
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "unknown")
                status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
                if code == "InvalidInstanceID.NotFound":
                    raise ProviderError("http_404") from exc
                capacity = code in {
                    "InsufficientInstanceCapacity",
                    "InsufficientHostCapacity",
                    "InsufficientFreeAddressesInSubnet",
                }
                raise ProviderError(
                    "aws_" + code,
                    retryable=capacity
                    or code in {"RequestLimitExceeded", "Throttling", "ThrottlingException"},
                    ambiguous=mutation
                    and not capacity
                    and (status >= 500 or code in {"InternalError", "RequestTimeout"}),
                ) from exc
            except BotoCoreError as exc:
                raise ProviderError(
                    "aws_transport_error", retryable=not mutation, ambiguous=mutation
                ) from exc

    def _image(self, region, architecture):
        cache_key = (region, architecture)
        if cache_key in self.image_cache:
            return self.image_cache[cache_key]
        image_id = self.settings.spotbot_aws_image_id
        if not image_id:
            path = f"/aws/service/deeplearning/ami/{architecture}/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id"
            image_id = self._client(region, "ssm").get_parameter(Name=path)["Parameter"]["Value"]
        images = self._client(region).describe_images(ImageIds=[image_id])["Images"]
        if len(images) != 1 or images[0]["State"] != "available":
            raise ValueError("aws_image_unavailable")
        image = images[0]
        if image["Architecture"] != architecture:
            self.image_cache[cache_key] = None
            return None
        if not self.settings.spotbot_aws_image_id and image.get("ProductCodes"):
            raise ValueError("aws_default_image_has_license_charges")
        root_device = image["RootDeviceName"]
        minimum = next(
            (
                b["Ebs"].get("VolumeSize", 8)
                for b in image["BlockDeviceMappings"]
                if b["DeviceName"] == root_device and "Ebs" in b
            ),
            8,
        )
        result = {
            "image_id": image_id,
            "root_device": root_device,
            "root_volume_gb": max(minimum, self.settings.spotbot_aws_root_volume_gb),
        }
        self.image_cache[cache_key] = result
        return result

    async def collect(self):
        return await self._execute(self._collect)

    def _collect(self):
        from botocore.exceptions import ClientError

        offers = []
        for region in self.regions:
            ec2 = self._client(region)
            specs = {
                t["InstanceType"]: t
                for page in ec2.get_paginator("describe_instance_types").paginate(
                    Filters=[{"Name": "instance-type", "Values": ["g*", "p*"]}]
                )
                for t in page["InstanceTypes"]
                if t.get("GpuInfo", {}).get("Gpus")
            }
            if not specs:
                continue
            vpc = self.settings.spotbot_aws_vpc_id
            if not vpc:
                vpcs = ec2.describe_vpcs(Filters=[{"Name": "is-default", "Values": ["true"]}])[
                    "Vpcs"
                ]
                vpc = vpcs[0]["VpcId"] if vpcs else ""
            subnets = {}
            if vpc:
                for page in ec2.get_paginator("describe_subnets").paginate(
                    Filters=[
                        {"Name": "vpc-id", "Values": [vpc]},
                        {"Name": "state", "Values": ["available"]},
                    ]
                ):
                    for subnet in sorted(page["Subnets"], key=lambda s: s["SubnetId"]):
                        subnets.setdefault(subnet["AvailabilityZone"], subnet["SubnetId"])
            groups = [
                x.strip()
                for x in self.settings.spotbot_aws_security_group_ids.split(",")
                if x.strip()
            ]
            if not groups and vpc:
                groups = [
                    g["GroupId"]
                    for g in ec2.describe_security_groups(
                        Filters=[
                            {"Name": "vpc-id", "Values": [vpc]},
                            {"Name": "group-name", "Values": ["spotbot-gpu"]},
                        ]
                    )["SecurityGroups"]
                ]
            sq = self._client(region, "service-quotas")
            quotas = {
                family: int(
                    sq.get_service_quota(ServiceCode="ec2", QuotaCode=code)["Quota"]["Value"]
                )
                for family, code in [("g", "L-3819A6DF"), ("p", "L-7212CCBC")]
            }
            effective = {}
            for page in ec2.get_paginator("describe_spot_price_history").paginate(
                InstanceTypes=list(specs),
                ProductDescriptions=["Linux/UNIX"],
                StartTime=datetime.now(UTC),
            ):
                for quote in page["SpotPriceHistory"]:
                    identity = (quote["InstanceType"], quote["AvailabilityZone"])
                    if (
                        identity not in effective
                        or quote["Timestamp"] > effective[identity]["Timestamp"]
                    ):
                        effective[identity] = quote
            for (sku, zone), quote in effective.items():
                spec = specs[sku]
                gpus = spec["GpuInfo"]["Gpus"]
                architecture = spec["ProcessorInfo"]["SupportedArchitectures"][0]
                nvidia = all(g["Manufacturer"].upper() == "NVIDIA" for g in gpus)
                modern = all(g["Name"].upper() not in {"K80", "V100", "M60"} for g in gpus)
                full_gpu = all(g.get("GpuPartitionSize", 1) >= 1 for g in gpus)
                image = None
                image_error = None
                if self.settings.spotbot_aws_image_id or (nvidia and modern and full_gpu):
                    try:
                        image = self._image(region, architecture)
                    except ClientError as exc:
                        if exc.response.get("Error", {}).get("Code") == "ParameterNotFound":
                            self.image_cache[(region, architecture)] = None
                            image_error = "default_image_unavailable"
                        else:
                            raise
                else:
                    image_error = "custom_gpu_image_required"
                compatible = bool(
                    image and groups and subnets.get(zone) and self.settings.spotbot_aws_key_name
                )
                quota_sufficient = spec["VCpuInfo"]["DefaultVCpus"] <= quotas[sku[0]]
                gpu_count = sum(g.get("LogicalGpuCount") or g.get("Count", 0) for g in gpus)
                if not gpu_count:
                    continue
                description = ", ".join(f"{g['Manufacturer']} {g['Name']}" for g in gpus)
                details = {
                    "aws_region": region,
                    "architecture": architecture,
                    "gpu_specifications": gpus,
                    "physical_gpu_count": sum(g["Count"] for g in gpus),
                    "gpu_count_kind": "logical"
                    if any(g.get("GpuPartitionSize", 1) < 1 for g in gpus)
                    else "physical",
                    "availability_kind": "launch_attempt_required",
                    "quota_vcpus": quotas[sku[0]],
                    "quota_sufficient": quota_sufficient,
                    "vpc_id": vpc,
                    "subnet_id": subnets.get(zone),
                    "security_group_ids": groups,
                    "key_name": self.settings.spotbot_aws_key_name,
                    "default_image_error": image_error,
                    "root_device": image["root_device"] if image else None,
                    "image_id": image["image_id"] if image else None,
                    "instance_storage": spec.get("InstanceStorageInfo"),
                    "vendor_price_timestamp": quote["Timestamp"].isoformat(),
                }
                root_size = (
                    image["root_volume_gb"] if image else self.settings.spotbot_aws_root_volume_gb
                )
                offers.append(
                    Offer(
                        provider=self.name,
                        cloud="aws",
                        sku=sku,
                        region=region,
                        availability_zone=zone,
                        market="spot",
                        gpu_model=gpu_model(description),
                        gpu_description=description,
                        gpu_count=gpu_count,
                        vcpus=spec["VCpuInfo"]["DefaultVCpus"],
                        memory_gb=Decimal(spec["MemoryInfo"]["SizeInMiB"]) / 1024,
                        memory_unit="GiB",
                        storage_gb=root_size,
                        storage_unit="GiB",
                        price_hourly=quote["SpotPrice"],
                        available=compatible and quota_sufficient,
                        orderable=compatible and quota_sufficient,
                        source_url=f"https://ec2.{region}.amazonaws.com",
                        details=details,
                    )
                )
        return offers

    def plan(self, offer, launch, name, *, max_price_hourly=None):
        validate_launch(
            launch,
            {
                "image_id",
                "subnet_id",
                "security_group_ids",
                "key_name",
                "root_volume_gb",
                "cloud_init",
            },
        )
        if offer.market != "spot" or not offer.availability_zone:
            raise ValueError("AWS adapter requires a zonal Spot offer")
        if max_price_hourly is None:
            raise ValueError("AWS Spot requires max_price_hourly")
        d = offer.details
        image_id = launch.image_id or d.get("image_id")
        subnet_id = launch.subnet_id or d.get("subnet_id")
        groups = launch.security_group_ids or d.get("security_group_ids")
        key = launch.key_name or d.get("key_name")
        if not all([image_id, subnet_id, groups, key, d.get("root_device")]):
            raise ValueError("AWS launch defaults are incomplete")
        if launch.image_id and launch.image_id != d.get("image_id"):
            raise ValueError(
                "Configure SPOTBOT_AWS_IMAGE_ID and recollect before changing the image"
            )
        if launch.subnet_id and launch.subnet_id != d.get("subnet_id"):
            raise ValueError("AWS subnet must match the selected zonal offer")
        size = launch.root_volume_gb or int(offer.storage_gb)
        if size < int(offer.storage_gb):
            raise ValueError("AWS root volume is smaller than the catalog image requires")
        tags = [{"Key": "Name", "Value": name}, {"Key": "spotbot-managed", "Value": "true"}]
        payload = {
            "ImageId": image_id,
            "InstanceType": offer.sku,
            "MinCount": 1,
            "MaxCount": 1,
            "KeyName": key,
            "ClientToken": hashlib.sha256(name.encode()).hexdigest(),
            "InstanceInitiatedShutdownBehavior": "terminate",
            "Placement": {"AvailabilityZone": offer.availability_zone},
            "InstanceMarketOptions": {
                "MarketType": "spot",
                "SpotOptions": {
                    "SpotInstanceType": "one-time",
                    "InstanceInterruptionBehavior": "terminate",
                    "MaxPrice": str(max_price_hourly),
                },
            },
            "NetworkInterfaces": [
                {
                    "DeviceIndex": 0,
                    "SubnetId": subnet_id,
                    "Groups": groups,
                    "AssociatePublicIpAddress": self.settings.spotbot_aws_public_ip,
                    "DeleteOnTermination": True,
                }
            ],
            "BlockDeviceMappings": [
                {
                    "DeviceName": d["root_device"],
                    "Ebs": {
                        "VolumeSize": size,
                        "VolumeType": "gp3",
                        "Encrypted": True,
                        "DeleteOnTermination": True,
                    },
                }
            ],
            "MetadataOptions": {"HttpTokens": "required", "HttpEndpoint": "enabled"},
            "TagSpecifications": [
                {"ResourceType": r, "Tags": tags} for r in ["instance", "volume"]
            ],
        }
        if launch.cloud_init:
            payload["UserData"] = launch.cloud_init  # Boto3 base64-encodes this field.
        return {"method": "RunInstances", "region": d["aws_region"], "payload": payload}

    async def create(self, plan):
        response = await self._execute(
            lambda: self._client(plan["region"]).run_instances(**plan["payload"]), mutation=True
        )
        instances = response.get("Instances", [])
        if len(instances) != 1 or not instances[0].get("InstanceId"):
            raise ProviderError("invalid_create_response", ambiguous=True)
        return instances[0]["InstanceId"]

    def _instance(self, instance_id):
        from botocore.exceptions import ClientError

        for region in self.regions:
            try:
                result = self._client(region).describe_instances(InstanceIds=[instance_id])
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") == "InvalidInstanceID.NotFound":
                    continue
                raise
            rows = [i for r in result["Reservations"] for i in r["Instances"]]
            if rows:
                return region, rows[0]
        raise ProviderError("http_404")

    async def inspect(self, instance_id):
        _, instance = await self._execute(lambda: self._instance(instance_id))
        state = instance["State"]["Name"]
        tags = {t["Key"]: t["Value"] for t in instance.get("Tags", [])}
        ip = (
            instance.get("PublicIpAddress")
            if self.settings.spotbot_aws_public_ip
            else instance.get("PrivateIpAddress")
        )
        reason = instance.get("StateReason", {}).get("Code", "")
        return {
            "status": state,
            "ready": state == "running" and bool(ip),
            "terminated": state in {"terminated", "shutting-down"},
            "preempted": reason
            in {"Server.SpotInstanceTermination", "Server.SpotInstanceShutdown"},
            "name": tags.get("Name"),
            "ip": ip,
            "ssh_port": 22,
            "ssh_user": self.settings.spotbot_aws_ssh_user,
            "key_reference": instance.get("KeyName"),
        }

    async def delete(self, instance_id):
        def terminate():
            region, instance = self._instance(instance_id)
            tags = {t["Key"]: t["Value"] for t in instance.get("Tags", [])}
            if tags.get("spotbot-managed") != "true":
                raise ProviderError("aws_instance_not_managed")
            return self._client(region).terminate_instances(InstanceIds=[instance_id])

        await self._execute(terminate, mutation=True)
