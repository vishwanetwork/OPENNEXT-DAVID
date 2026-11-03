"""Operator-enrolled AWS accounts; no credentials are accepted from an RFQ."""

import json

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AWSAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str = Field(pattern=r"^\d{12}$")
    profile: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.-]+$")
    region: str = Field(pattern=r"^[a-z]{2}(?:-[a-z]+)+-\d$")
    instance_types: list[str] = Field(min_length=1, max_length=50)
    vpc_id: str = Field(pattern=r"^vpc-[a-f0-9]+$")
    security_group_ids: list[str] = Field(min_length=1, max_length=5)
    key_name: str = Field(min_length=1, max_length=255)
    image_id: str = Field(pattern=r"^ami-(?:[a-f0-9]{8}|[a-f0-9]{17})$")
    ssh_user: str = Field("ubuntu", pattern=r"^[a-z_][a-z0-9_-]{0,31}$")
    root_volume_gb: int = Field(80, ge=8, le=16384)
    interruption_queue_url: str

    @model_validator(mode="after")
    def scope(self):
        import re

        if any(not re.fullmatch(r"[gp][a-z0-9-]*\.[a-z0-9]+", t) for t in self.instance_types):
            raise ValueError("Additional accounts require explicit GPU instance types")
        if any(not re.fullmatch(r"sg-[a-f0-9]+", g) for g in self.security_group_ids):
            raise ValueError("Invalid additional-account security group")
        if not re.fullmatch(
            rf"https://sqs\.{re.escape(self.region)}\.amazonaws\.com/{self.account_id}/[A-Za-z0-9_-]+",
            self.interruption_queue_url,
        ):
            raise ValueError("Interruption queue must belong to the enrolled account and Region")
        return self


def parse_accounts(value):
    import re

    raw = json.loads(value)
    if not isinstance(raw, dict) or len(raw) > 16:
        raise ValueError("AWS accounts must be an object with at most 16 enrollments")
    accounts, pools = {}, set()
    for alias, body in raw.items():
        if alias == "default" or not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", alias):
            raise ValueError("Invalid or reserved AWS account alias")
        account = AWSAccount.model_validate(body)
        for sku in set(account.instance_types):
            pool = (account.region, sku)
            if pool in pools:
                raise ValueError("Additional accounts cannot overlap a Region/instance-type route")
            pools.add(pool)
        accounts[alias] = account
    return accounts


def account_settings(settings, alias, account):
    return settings.model_copy(
        update={
            "spotbot_aws_accounts": "{}",
            "spotbot_aws_account_name": alias,
            "spotbot_aws_profile": account.profile,
            "spotbot_aws_expected_account_id": account.account_id,
            "spotbot_aws_regions": account.region,
            "spotbot_aws_price_regions": "",
            "spotbot_aws_price_profile": "",
            "spotbot_aws_reference_regions": "",
            "spotbot_aws_instance_types": list(account.instance_types),
            "spotbot_aws_vpc_id": account.vpc_id,
            "spotbot_aws_security_group_ids": ",".join(account.security_group_ids),
            "spotbot_aws_key_name": account.key_name,
            "spotbot_aws_image_id": account.image_id,
            "spotbot_aws_root_volume_gb": account.root_volume_gb,
            "spotbot_aws_ssh_user": account.ssh_user,
            "spotbot_rental_regions": account.region,
            "spotbot_rental_initial_images": json.dumps({account.region: account.image_id}),
            "spotbot_rental_interruption_queues": json.dumps(
                {account.region: account.interruption_queue_url}
            ),
        }
    )


def resolved_account(settings, rules):
    if rules.procurement_account is not None:
        name = rules.procurement_account
        if name != "default" and name not in settings.aws_accounts:
            raise ValueError("aws_account_not_enrolled")
        return name
    if rules.account != "default":
        if rules.account not in settings.aws_accounts:
            raise ValueError("aws_account_not_enrolled")
        return rules.account
    if not rules.instance_types:
        return "default"
    matches = [
        alias
        for alias, account in settings.aws_accounts.items()
        if set(rules.regions) == {account.region}
        and set(rules.instance_types) <= set(account.instance_types)
    ]
    return matches[0] if len(matches) == 1 else "default"
