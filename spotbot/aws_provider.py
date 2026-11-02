"""EC2 Spot adapter using the standard AWS SDK credential chain."""

import asyncio
import hashlib
import json
import logging
import time
from datetime import UTC, datetime
from decimal import Decimal

from spotbot.models import Offer, gpu_model
from spotbot.providers import Provider, ProviderError, validate_launch

logger = logging.getLogger(__name__)

# The Price List API is served from us-east-1 and covers every EC2 region.
PRICE_LIST_REGION = "us-east-1"
LIST_PRICE_FILTERS = {
    "operatingSystem": "Linux",
    "tenancy": "Shared",
    "preInstalledSw": "NA",
    "capacitystatus": "Used",
    "marketoption": "OnDemand",
    "licenseModel": "No License required",
    "instanceFamily": "GPU instance",
}
RESERVED_HOURS = {"1yr": 8760, "3yr": 26280}


class AWSProvider(Provider):
    name = "aws"
    base_url = "https://ec2.amazonaws.com"

    def __init__(self, settings, client, *, session=None):
        super().__init__(settings, client)
        self.session = session
        self.reference_session = None
        self.account_providers = None
        self.identity_checked = False
        self.clients = {}
        self.sdk_lock = asyncio.Lock()
        self.image_cache = {}
        self.capacity_failures = {}
        self.quota_failures = {}

    def note_failure(self, offer, error):
        if error.code in {"aws_InsufficientInstanceCapacity", "aws_InsufficientHostCapacity"}:
            self.capacity_failures[offer.offer_id] = (
                time.monotonic() + self.settings.spotbot_aws_capacity_backoff_seconds
            )
        if error.code in {"aws_MaxSpotInstanceCountExceeded", "aws_VcpuLimitExceeded"}:
            key = (offer.region, self._quota_family(offer.sku))
            self.quota_failures[key] = (
                time.monotonic() + self.settings.spotbot_aws_capacity_backoff_seconds
            )

    def public_offer(self, offer, max_age):
        account = offer.details.get("aws_account", "default")
        if self.settings.spotbot_aws_account_name == "default" and account != "default":
            provider = self.fulfillment_providers().get(account)
            if (
                provider is None
                or offer.details.get("aws_account_id")
                != provider.settings.spotbot_aws_expected_account_id
                or offer.region not in provider.regions
                or offer.sku not in provider.settings.spotbot_aws_instance_types
            ):
                data = super().public_offer(offer, max_age)
                data.update(
                    orderable=False,
                    can_attempt=False,
                    eligibility_status="aws_account_not_enrolled",
                )
                return data
            return provider.public_offer(offer, max_age)
        data = super().public_offer(offer, max_age)
        remaining = self.capacity_failures.get(offer.offer_id, 0) - time.monotonic()
        if remaining > 0:
            data["capacity_status"] = "unavailable"
            data["can_attempt"] = False
            data["capacity_retry_after_seconds"] = int(remaining) + 1
        quota_retry = (
            self.quota_failures.get((offer.region, self._quota_family(offer.sku)), 0)
            - time.monotonic()
        )
        if quota_retry > 0:
            data["can_attempt"] = False
            data["eligibility_status"] = "quota_rejected_at_launch"
            data["quota_retry_after_seconds"] = int(quota_retry) + 1
        return data

    @staticmethod
    def _quota_family(sku):
        if sku.startswith(("g", "vt")):
            return "g"
        return "p" if sku.startswith("p") else None

    def _quota_usage(self, ec2, specs):
        used = {"g": 0, "p": 0}
        known = {"g": True, "p": True}
        counted = set()

        def count(sku):
            family = self._quota_family(sku)
            if family:
                if sku not in specs:
                    known[family] = False
                else:
                    used[family] += specs[sku]["VCpuInfo"]["DefaultVCpus"]

        # Count the entire account, including instances launched outside this bot.
        for page in ec2.get_paginator("describe_instances").paginate(
            Filters=[
                {"Name": "instance-lifecycle", "Values": ["spot"]},
                {"Name": "instance-state-name", "Values": ["pending", "running"]},
            ]
        ):
            for reservation in page["Reservations"]:
                for instance in reservation["Instances"]:
                    counted.add(instance["InstanceId"])
                    count(instance["InstanceType"])
        for page in ec2.get_paginator("describe_spot_instance_requests").paginate(
            Filters=[{"Name": "state", "Values": ["open", "active"]}]
        ):
            for request in page["SpotInstanceRequests"]:
                if request.get("InstanceId") in counted:
                    continue
                if request.get("InstanceId"):
                    counted.add(request["InstanceId"])
                count(request.get("LaunchSpecification", {}).get("InstanceType", ""))
                if not request.get("LaunchSpecification", {}).get("InstanceType"):
                    known = {"g": False, "p": False}
        return used, known

    @property
    def regions(self):
        return self.settings.aws_order_regions

    def _session(self):
        if self.session is None:
            try:
                import boto3
            except ImportError as exc:
                raise ProviderError("aws_sdk_not_installed") from exc
            self.session = (
                boto3.Session(profile_name=self.settings.spotbot_aws_profile)
                if self.settings.spotbot_aws_profile
                else boto3.Session()
            )
        return self.session

    def fulfillment_providers(self):
        if self.account_providers is None:
            from spotbot.aws_accounts import account_settings

            self.account_providers = {
                name: AWSProvider(account_settings(self.settings, name, account), self.client)
                for name, account in self.settings.aws_accounts.items()
            }
        return self.account_providers

    @property
    def configured(self):
        if not self.settings.enabled(self.name):
            return False
        try:
            return self._session().get_credentials() is not None
        except Exception:
            return False

    def _client(self, region, service="ec2", *, price_reference=False):
        from botocore.config import Config

        separate = price_reference and bool(self.settings.spotbot_aws_price_profile)
        if (
            not separate
            and self.settings.spotbot_aws_expected_account_id
            and not self.identity_checked
        ):
            identity = (
                self._session()
                .client(
                    "sts",
                    region_name=region,
                    config=Config(
                        retries={"total_max_attempts": 1}, connect_timeout=5, read_timeout=10
                    ),
                )
                .get_caller_identity()
            )
            if identity.get("Account") != self.settings.spotbot_aws_expected_account_id:
                raise ProviderError("aws_account_identity_mismatch")
            self.identity_checked = True
        key = ("reference", region, service) if separate else (region, service)
        if key not in self.clients:
            if separate:
                if self.reference_session is None:
                    import boto3

                    self.reference_session = boto3.Session(
                        profile_name=self.settings.spotbot_aws_price_profile
                    )
                session = self.reference_session
            else:
                session = self._session()
            self.clients[key] = session.client(
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
                quota_rejected = code in {"MaxSpotInstanceCountExceeded", "VcpuLimitExceeded"}
                raise ProviderError(
                    "aws_" + code,
                    retryable=capacity
                    or quota_rejected
                    or code in {"RequestLimitExceeded", "Throttling", "ThrottlingException"},
                    ambiguous=mutation
                    and not (capacity or quota_rejected)
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
        offers, failures, successes = [], [], 0
        try:
            offers = await self._execute(self._collect)
            successes += 1
        except Exception as exc:
            failures.append(exc)
        for name, provider in self.fulfillment_providers().items():
            try:
                offers.extend(await provider.collect())
                successes += 1
            except Exception as exc:
                code = exc.code if isinstance(exc, ProviderError) else type(exc).__name__
                logger.warning(
                    "Additional AWS account collection failed: account=%s code=%s", name, code
                )
                failures.append(exc)
        if not successes and failures:
            raise failures[0]
        if failures:
            logger.warning("AWS collection completed with account gaps: count=%d", len(failures))
        return offers

    async def collect_list_prices(self):
        return await self._each_region(self.settings.aws_price_regions, self._collect_list_prices)

    async def collect_price_regions(self):
        regions = [r for r in self.settings.aws_price_regions if r not in self.regions]
        return await self._each_region(regions, self._collect_price_region)

    async def collect_account_prices(self):
        return await self._each_region(
            self.settings.aws_reference_regions,
            lambda region: self._collect_price_region(region, price_reference=True),
        )

    async def _each_region(self, regions, collect):
        # One SDK call per Region keeps order operations from waiting behind a long sweep,
        # and one failing Region does not discard the others.
        offers, failures = [], []
        for region in regions:
            try:
                offers.extend(await self._execute(lambda region=region: collect(region)))
            except ProviderError as exc:
                failures.append(exc)
                logger.warning("AWS price collection failed: region=%s code=%s", region, exc.code)
        if failures and len(failures) == len(regions):
            raise failures[0]
        return offers

    @staticmethod
    def _instance_types(ec2):
        all_specs = {
            t["InstanceType"]: t
            for page in ec2.get_paginator("describe_instance_types").paginate(
                Filters=[{"Name": "instance-type", "Values": ["g*", "p*", "vt*"]}]
            )
            for t in page["InstanceTypes"]
        }
        specs = {
            name: spec for name, spec in all_specs.items() if spec.get("GpuInfo", {}).get("Gpus")
        }
        return all_specs, specs

    @staticmethod
    def _gpu_summary(spec):
        gpus = spec["GpuInfo"]["Gpus"]
        return {
            "gpu_count": sum(g.get("LogicalGpuCount") or g.get("Count", 0) for g in gpus),
            "description": ", ".join(f"{g['Manufacturer']} {g['Name']}" for g in gpus),
            "details": {
                "gpu_specifications": gpus,
                "physical_gpu_count": sum(g["Count"] for g in gpus),
                "gpu_count_kind": "logical"
                if any(g.get("GpuPartitionSize", 1) < 1 for g in gpus)
                else "physical",
            },
        }

    def _collect_list_prices(self, region):
        """Published Linux On-demand and Reserved rates, with the vendor's effective dates."""
        pricing = self._client(PRICE_LIST_REGION, "pricing")
        _, specs = self._instance_types(self._client(region))
        # Price-only Regions keep the No Upfront terms the comparison uses, limiting history growth.
        no_upfront_only = region not in self.regions
        filters = [
            {"Type": "TERM_MATCH", "Field": field, "Value": value}
            for field, value in {**LIST_PRICE_FILTERS, "regionCode": region}.items()
        ]
        offers = []
        for page in pricing.get_paginator("get_products").paginate(
            ServiceCode="AmazonEC2", Filters=filters
        ):
            for raw in page["PriceList"]:
                product = json.loads(raw) if isinstance(raw, str) else raw
                offers.extend(self._list_offers(product, region, specs, no_upfront_only))
        return offers

    def _collect_price_region(self, region, *, price_reference=False):
        """Current Spot references; separate identities never establish launch eligibility."""
        ec2 = self._client(region, price_reference=price_reference)
        _, specs = self._instance_types(ec2)
        if not specs:
            return []
        lowest, zones = {}, {}
        for page in ec2.get_paginator("describe_spot_price_history").paginate(
            InstanceTypes=list(specs),
            ProductDescriptions=["Linux/UNIX"],
            StartTime=datetime.now(UTC),
        ):
            for quote in page["SpotPriceHistory"]:
                identity = (quote["InstanceType"], quote["AvailabilityZone"])
                if identity not in zones or quote["Timestamp"] > zones[identity]["Timestamp"]:
                    zones[identity] = quote
        for (sku, _), quote in zones.items():
            if sku not in lowest or Decimal(quote["SpotPrice"]) < Decimal(lowest[sku]["SpotPrice"]):
                lowest[sku] = quote
        offers = []
        for sku, quote in lowest.items():
            spec, summary = specs[sku], self._gpu_summary(specs[sku])
            if not summary["gpu_count"]:
                continue
            offers.append(
                Offer(
                    provider=self.name,
                    cloud="aws",
                    sku=sku,
                    region=region,
                    market="spot",
                    gpu_model=gpu_model(summary["description"]),
                    gpu_description=summary["description"],
                    gpu_count=summary["gpu_count"],
                    vcpus=spec["VCpuInfo"]["DefaultVCpus"],
                    memory_gb=Decimal(spec["MemoryInfo"]["SizeInMiB"]) / 1024,
                    memory_unit="GiB",
                    storage_gb=self.settings.spotbot_aws_root_volume_gb,
                    storage_unit="GiB",
                    price_hourly=quote["SpotPrice"],
                    available=False,
                    orderable=False,
                    source_url=f"https://ec2.{region}.amazonaws.com",
                    details={
                        "aws_region": region,
                        **summary["details"],
                        "availability_kind": "price_reference",
                        "capacity_status": "unknown",
                        "eligibility_status": "price_only_account"
                        if price_reference
                        else "price_only_region",
                        "lowest_zone": quote["AvailabilityZone"],
                        "zone_count": sum(1 for s, _ in zones if s == sku),
                        "vendor_price_timestamp": quote["Timestamp"].isoformat(),
                    },
                )
            )
        return offers

    def _list_offers(self, product, region, specs, no_upfront_only=False):
        sku = product.get("product", {}).get("attributes", {}).get("instanceType")
        spec = specs.get(sku)
        if not spec:
            return []
        summary = self._gpu_summary(spec)
        if not summary["gpu_count"]:
            return []
        terms = product.get("terms", {})

        def offer(market, price, term, extra):
            return Offer(
                provider=self.name,
                cloud="aws",
                sku=sku,
                region=region,
                market=market,
                gpu_model=gpu_model(summary["description"]),
                gpu_description=summary["description"],
                gpu_count=summary["gpu_count"],
                vcpus=spec["VCpuInfo"]["DefaultVCpus"],
                memory_gb=Decimal(spec["MemoryInfo"]["SizeInMiB"]) / 1024,
                memory_unit="GiB",
                storage_gb=0,
                storage_unit="GiB",
                price_hourly=price,
                price_kind="list",
                available=False,
                orderable=False,
                source_url="https://pricing.us-east-1.amazonaws.com",
                effective_at=term.get("effectiveDate"),
                details={
                    "aws_region": region,
                    **summary["details"],
                    "price_source": "aws_price_list",
                    "offer_term_code": term.get("offerTermCode"),
                    "eligibility_status": "list_price_only",
                    **extra,
                },
            )

        def dimensions(term):
            values = {}
            for dimension in term.get("priceDimensions", {}).values():
                usd = dimension.get("pricePerUnit", {}).get("USD")
                if usd is not None:
                    values[dimension.get("unit")] = Decimal(usd)
            return values

        result = []
        for term in terms.get("OnDemand", {}).values():
            hourly = dimensions(term).get("Hrs")
            if hourly and hourly > 0:
                result.append(offer("on_demand", hourly, term, {}))
        for term in terms.get("Reserved", {}).values():
            attributes = term.get("termAttributes", {})
            hours = RESERVED_HOURS.get(attributes.get("LeaseContractLength"))
            if not hours or attributes.get("OfferingClass") not in {"standard", "convertible"}:
                continue
            if no_upfront_only and attributes.get("PurchaseOption") != "No Upfront":
                continue
            values = dimensions(term)
            recurring, upfront = values.get("Hrs", Decimal(0)), values.get("Quantity", Decimal(0))
            # Effective hourly cost spreads any upfront payment across the whole term.
            hourly = recurring + upfront / hours
            if hourly > 0:
                result.append(
                    offer(
                        "reserved",
                        hourly.quantize(Decimal("0.000001")),
                        term,
                        {
                            "lease_contract_length": attributes["LeaseContractLength"],
                            "purchase_option": attributes.get("PurchaseOption"),
                            "offering_class": attributes["OfferingClass"],
                            "upfront_usd": str(upfront),
                            "recurring_hourly_usd": str(recurring),
                        },
                    )
                )
        return result

    def _collect(self):
        from botocore.exceptions import ClientError

        offers = []
        for region in self.regions:
            ec2 = self._client(region)
            all_specs, specs = self._instance_types(ec2)
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
            used, usage_known = self._quota_usage(ec2, all_specs)
            remaining_quotas = {family: max(0, quotas[family] - used[family]) for family in quotas}
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
                # Older clients route by Region/SKU. Publish only the enrolled
                # account for that route so its displayed quote matches fulfillment.
                if any(
                    account.region == region and sku in account.instance_types
                    for account in self.settings.aws_accounts.values()
                ):
                    continue
                if (
                    self.settings.spotbot_aws_instance_types
                    and sku not in self.settings.spotbot_aws_instance_types
                ):
                    continue
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
                quota_sufficient = (
                    usage_known[sku[0]]
                    and spec["VCpuInfo"]["DefaultVCpus"] <= remaining_quotas[sku[0]]
                )
                gpu_count = sum(g.get("LogicalGpuCount") or g.get("Count", 0) for g in gpus)
                if not gpu_count:
                    continue
                description = ", ".join(f"{g['Manufacturer']} {g['Name']}" for g in gpus)
                details = {
                    "aws_account": self.settings.spotbot_aws_account_name,
                    "aws_account_id": self.settings.spotbot_aws_expected_account_id or None,
                    "aws_region": region,
                    "architecture": architecture,
                    "gpu_specifications": gpus,
                    "physical_gpu_count": sum(g["Count"] for g in gpus),
                    "gpu_count_kind": "logical"
                    if any(g.get("GpuPartitionSize", 1) < 1 for g in gpus)
                    else "physical",
                    "availability_kind": "launch_attempt_required",
                    "capacity_status": "unknown",
                    "quota_vcpus": quotas[sku[0]],
                    "quota_used_vcpus": used[sku[0]],
                    "quota_remaining_vcpus": remaining_quotas[sku[0]]
                    if usage_known[sku[0]]
                    else None,
                    "quota_usage_known": usage_known[sku[0]],
                    "quota_usage_kind": "account_instance_and_request_snapshot",
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
                details["eligibility_status"] = (
                    "quota_usage_unknown"
                    if not usage_known[sku[0]]
                    else "quota_insufficient"
                    if not quota_sufficient
                    else "launch_defaults_incomplete"
                    if not compatible
                    else "eligible"
                )
                root_size = (
                    image["root_volume_gb"] if image else self.settings.spotbot_aws_root_volume_gb
                )
                offers.append(
                    Offer(
                        provider=self.name,
                        cloud="aws"
                        if self.settings.spotbot_aws_account_name == "default"
                        else "aws-" + self.settings.spotbot_aws_account_name,
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
                        available=False,
                        orderable=compatible and quota_sufficient,
                        source_url=f"https://ec2.{region}.amazonaws.com",
                        details=details,
                    )
                )
        return offers

    def plan(self, offer, launch, name, *, max_price_hourly=None):
        if offer.details.get("aws_account", "default") != "default":
            raise ValueError("additional_accounts_require_protected_rentals")
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
