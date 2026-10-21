"""Read-only deployment checks. A passing report never reserves cloud capacity."""

import json
import re
from urllib.parse import urlsplit

from spotbot.aws_provider import AWSProvider
from spotbot.models import gpu_model, utcnow
from spotbot.rental_aws import approved_initial_image, initial_disk_layout_allowed

EVENT_TYPES = {
    "EC2 Spot Instance Interruption Warning",
    "EC2 Instance State-change Notification",
}
SAFE_ERRORS = {
    "queue_missing",
    "queue_identity_mismatch",
    "queue_encryption_missing",
    "queue_dead_letter_missing",
    "queue_policy_not_account_bound",
    "interruption_rules_missing",
    "aws_image_unavailable",
    "aws_default_image_has_license_charges",
}


def check(name, passed, *, required=True, **details):
    return dict(
        name=name,
        status="passed" if passed else "failed" if required else "warning",
        required=required,
        **details,
    )


def passed(checks):
    return all(c["status"] == "passed" for c in checks if c["required"])


def error_code(exc):
    """Do not include arbitrary SDK messages, URLs, headers, or validation input."""
    if isinstance(exc, ValueError) and str(exc) in SAFE_ERRORS:
        return str(exc)
    code = getattr(exc, "code", None) or getattr(exc, "response", {}).get("Error", {}).get("Code")
    return (
        code
        if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", code)
        else type(exc).__name__
    )


def safe_url(value):
    url = urlsplit(value)
    return bool(
        url.hostname
        and not url.username
        and not url.password
        and not url.query
        and not url.fragment
        and (
            url.scheme == "https"
            or (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})
        )
    )


def configuration_checks(settings, rules, gateway=None):
    checks = [
        check("rentals_enabled", settings.spotbot_rentals_enabled),
        check("live_orders_enabled", settings.spotbot_live_orders_enabled),
        check("background_worker_enabled", settings.spotbot_background_enabled),
        check("aws_provider_enabled", settings.enabled("aws")),
        check("service_authentication", bool(settings.spotbot_api_key.get_secret_value())),
        check("guest_callback_url", safe_url(settings.spotbot_rental_public_url)),
        check("rfq_regions_enabled", not (set(rules.regions) - set(settings.rental_regions))),
        check("acquisition_deadline", rules.acquisition_deadline > utcnow()),
        check("rental_expiry", rules.expires_at > utcnow()),
    ]
    queues = json.loads(settings.spotbot_rental_interruption_queues)
    checks.append(check("interruption_queues_configured", all(r in queues for r in rules.regions)))
    if rules.require_gateway_ack:
        checks.extend(
            [
                check("gateway_webhook_url", safe_url(settings.spotbot_gateway_webhook_url)),
                check(
                    "gateway_signing_secret",
                    len(settings.spotbot_gateway_webhook_secret.get_secret_value()) >= 32,
                ),
                check(
                    "gateway_restricted_token",
                    len(settings.spotbot_rental_gateway_token.get_secret_value()) >= 32,
                ),
            ]
        )
    if gateway:
        checks.extend(
            [
                check(
                    "gateway_bot_url_matches",
                    gateway.bot_url == settings.spotbot_rental_public_url.rstrip("/"),
                ),
                check(
                    "gateway_bot_token_matches",
                    gateway.bot_token.get_secret_value()
                    == settings.spotbot_rental_gateway_token.get_secret_value(),
                ),
                check(
                    "gateway_signing_secret_matches",
                    gateway.webhook_secret.get_secret_value()
                    == settings.spotbot_gateway_webhook_secret.get_secret_value(),
                ),
                check(
                    "gateway_http_domain", not rules.http_port or bool(gateway.public_http_domain)
                ),
            ]
        )
        separate = True
        if gateway.storage_backend == settings.spotbot_storage_backend:
            if gateway.storage_backend == "sqlite":
                separate = (
                    gateway.database_path.resolve() != settings.spotbot_database_path.resolve()
                )
            elif gateway.storage_backend == "mysql":

                def database(url):
                    value = urlsplit(url)
                    return value.hostname, value.port or 3306, value.path.rstrip("/")

                separate = database(gateway.mysql_url.get_secret_value()) != database(
                    settings.spotbot_mysql_url.get_secret_value()
                )
            else:
                separate = gateway.dynamodb_table != settings.spotbot_dynamodb_table or (
                    gateway.dynamodb_region
                    and settings.spotbot_dynamodb_region
                    and gateway.dynamodb_region != settings.spotbot_dynamodb_region
                )
        checks.append(check("gateway_separate_database", bool(separate)))
    return checks


def queue_rules(attributes, region, account):
    """Accept account-bound EventBridge grants; reject broad queue write access."""
    arn = attributes["QueueArn"]
    if not re.fullmatch(rf"arn:[a-z-]+:sqs:{re.escape(region)}:{account}:[A-Za-z0-9_-]+", arn):
        raise ValueError("queue_identity_mismatch")
    if attributes.get("SqsManagedSseEnabled") != "true" and not attributes.get("KmsMasterKeyId"):
        raise ValueError("queue_encryption_missing")
    dead_letter = json.loads(attributes.get("RedrivePolicy", "{}"))
    if (
        not dead_letter.get("deadLetterTargetArn", "").startswith(arn.rsplit(":", 1)[0] + ":")
        or int(dead_letter.get("maxReceiveCount", 0)) < 1
    ):
        raise ValueError("queue_dead_letter_missing")
    names = []
    policy = json.loads(attributes.get("Policy", "{}"))
    for statement in policy.get("Statement", []):
        if statement.get("Effect") != "Allow":
            continue
        principal = statement.get("Principal", {})
        if principal == {"AWS": f"arn:aws:iam::{account}:root"}:
            continue
        condition = statement.get("Condition", {})
        rule = condition.get("ArnEquals", {}).get("aws:SourceArn", "")
        source_account = condition.get("StringEquals", {}).get("aws:SourceAccount")
        action = statement.get("Action")
        resources = statement.get("Resource", [])
        resources = [resources] if isinstance(resources, str) else resources
        if (
            principal != {"Service": "events.amazonaws.com"}
            or source_account != account
            or not isinstance(resources, list)
            or arn not in resources
            or any(
                not isinstance(r, str) or not r.startswith(arn.rsplit(":", 1)[0] + ":")
                for r in resources
            )
            or action not in ("sqs:SendMessage", ["sqs:SendMessage"])
            or not isinstance(rule, str)
            or not re.fullmatch(
                rf"arn:[a-z-]+:events:{re.escape(region)}:{account}:rule/[A-Za-z0-9_.-]+", rule
            )
        ):
            raise ValueError("queue_policy_not_account_bound")
        names.append(rule.rsplit("/", 1)[1])
    if not names or len(names) > 4:
        raise ValueError("interruption_rules_missing")
    return list(dict.fromkeys(names))


class Readiness:
    def __init__(self, settings, *, session=None):
        self.settings, self.session = settings, session

    def region(self, rules, region, account):
        config = self.settings.model_copy(
            update={"spotbot_aws_regions": region, "spotbot_aws_key_name": rules.ssh_key_name}
        )
        provider = AWSProvider(config, None, session=self.session)
        ec2 = provider._client(region)
        checks, candidates = [], []
        try:
            key = ec2.describe_key_pairs(KeyNames=[rules.ssh_key_name])["KeyPairs"]
            checks.append(
                check(
                    "ssh_key_registered", len(key) == 1 and key[0]["KeyName"] == rules.ssh_key_name
                )
            )
            offers = provider._collect()
            for offer in offers:
                d = offer.details
                gpus = d.get("gpu_specifications", [])
                if (
                    offer.orderable
                    and offer.gpu_model == gpu_model(rules.gpu_model)
                    and offer.gpu_count == rules.gpu_count
                    and offer.vcpus >= rules.min_vcpus
                    and offer.memory_gb >= rules.min_memory_gib
                    and d.get("architecture") == rules.architecture
                    and gpus
                    and min(g.get("MemoryInfo", {}).get("SizeInMiB", 0) for g in gpus)
                    >= rules.min_gpu_memory_gib * 1024
                    and offer.price_hourly <= rules.max_price_hourly
                    and (not rules.instance_types or offer.sku in rules.instance_types)
                    and d.get("quota_sufficient")
                    and d.get("subnet_id")
                    and d.get("security_group_ids")
                ):
                    candidates.append(offer)
            checks.append(check("affordable_quota_eligible_offers", bool(candidates)))
            if candidates:
                offer = min(candidates, key=lambda o: o.price_hourly)
                image_id = rules.initial_image_ids.get(region, offer.details["image_id"])
                image = ec2.describe_images(ImageIds=[image_id])["Images"][0]
                checks.append(check("initial_image_approved", image_id == offer.details["image_id"] or approved_initial_image(image)))
                checks.append(check("initial_image_disk_layout", initial_disk_layout_allowed(image, rules, strict_sizes=image_id != offer.details["image_id"])))
                checks.append(
                    check(
                        "linux_ebs_image",
                        image.get("RootDeviceType") == "ebs"
                        and image.get("State") == "available"
                        and image.get("Architecture") == rules.architecture
                        and image.get("PlatformDetails", "Linux/UNIX") == "Linux/UNIX"
                        and not image.get("ProductCodes"),
                    )
                )
                subnet = ec2.describe_subnets(SubnetIds=[offer.details["subnet_id"]])["Subnets"][0]
                groups = ec2.describe_security_groups(GroupIds=offer.details["security_group_ids"])[
                    "SecurityGroups"
                ]
                checks.append(
                    check(
                        "network_resources_match",
                        subnet.get("State") == "available"
                        and bool(groups)
                        and all(g["VpcId"] == subnet["VpcId"] for g in groups)
                        and {g["GroupId"] for g in groups}
                        == set(offer.details["security_group_ids"]),
                    )
                )
        except Exception as exc:
            checks.append(check("cloud_catalog_access", False, error=error_code(exc)))
        queue_url = json.loads(self.settings.spotbot_rental_interruption_queues).get(region)
        try:
            if not queue_url:
                raise ValueError("queue_missing")
            attributes = provider._client(region, "sqs").get_queue_attributes(
                QueueUrl=queue_url, AttributeNames=["All"]
            )["Attributes"]
            names = queue_rules(attributes, region, account)
            events = provider._client(region, "events")
            found = set()
            for name in names:
                rule = events.describe_rule(Name=name)
                pattern = json.loads(rule.get("EventPattern", "{}"))
                targets = events.list_targets_by_rule(Rule=name)["Targets"]
                if (
                    rule["State"] == "ENABLED"
                    and pattern.get("source") == ["aws.ec2"]
                    and any(t.get("Arn") == attributes["QueueArn"] for t in targets)
                ):
                    found.update(EVENT_TYPES.intersection(pattern.get("detail-type", [])))
            checks.append(check("interruption_event_delivery", EVENT_TYPES <= found))
        except Exception as exc:
            checks.append(check("interruption_event_delivery", False, error=error_code(exc)))
        return dict(
            region=region,
            checks=checks,
            preflight_passed=passed(checks),
            candidate_count=len(candidates),
            cheapest_candidates=[
                dict(sku=o.sku, zone=o.availability_zone, price_hourly=str(o.price_hourly))
                for o in sorted(candidates, key=lambda o: o.price_hourly)[:10]
            ],
        )

    async def run(self, rules, *, aws=False, gateway=None):
        import asyncio

        checks = configuration_checks(self.settings, rules, gateway)
        result = dict(
            configuration_ready=passed(checks),
            checks=checks,
            regions=[],
            cloud_preflight_passed=None,
            mutation_permissions_verified=False,
            live_launch_verified=False,
            limitations=[
                "No capacity is reserved or guaranteed.",
                "Snapshot, image, KMS and cleanup permissions require controlled acceptance.",
                "Guest bootstrap, routes, SSH authentication and actual disk restore require a live test.",
                "Security-group ingress, routes, DNS/TLS and guest callback reachability are not verified.",
            ],
        )
        if not aws:
            return result
        try:
            provider = AWSProvider(self.settings, None, session=self.session)
            caller = await asyncio.to_thread(
                provider._client(rules.regions[0], "sts").get_caller_identity
            )
            account = caller["Account"]
            if not re.fullmatch(r"[0-9]{12}", account):
                raise ValueError("invalid_account")
            result["aws_account"] = account
            # Bound SDK calls run off the event loop; no Service/database is opened.
            for region in rules.regions:
                if region not in self.settings.rental_regions:
                    result["regions"].append(
                        dict(
                            region=region,
                            preflight_passed=False,
                            checks=[check("rfq_region_enabled", False)],
                            candidate_count=0,
                            cheapest_candidates=[],
                        )
                    )
                else:
                    result["regions"].append(
                        await asyncio.to_thread(self.region, rules, region, account)
                    )
            # The bot may buy in any RFQ Region, so every Region must be recovery-ready.
            # Only the current lack of an affordable offer is tolerated per Region.
            result["cloud_preflight_passed"] = any(
                r["preflight_passed"] for r in result["regions"]
            ) and all(
                c["status"] == "passed"
                for r in result["regions"]
                for c in r["checks"]
                if c["required"] and c["name"] != "affordable_quota_eligible_offers"
            )
        except Exception as exc:
            result["cloud_preflight_passed"] = False
            result["checks"].append(check("aws_identity", False, error=error_code(exc)))
        return result
