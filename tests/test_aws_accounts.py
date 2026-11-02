"""Account isolation across purchase, replacement, replay, and backup cleanup."""

import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from spotbot.api import create_app
from spotbot.aws_accounts import account_settings
from spotbot.aws_provider import AWSProvider
from spotbot.config import Settings
from spotbot.providers import ProviderError
from spotbot.rental_accounts import RentalAccounts
from tests.test_aws import FakeAWS
from tests.test_rentals import Cloud, cycle, deliver
from tests.test_rentals import rental_env as rental_env  # noqa: F401


def enrollment(**changes):
    return dict(
        account_id="222222222222",
        profile="gpu-full",
        region="us-west-2",
        instance_types=["p5.test"],
        vpc_id="vpc-a",
        security_group_ids=["sg-a"],
        key_name="gpu-key",
        image_id="ami-0123456789abcdef0",
        interruption_queue_url="https://sqs.us-west-2.amazonaws.com/222222222222/interruptions",
        **changes,
    )


@pytest.mark.parametrize(
    "change",
    [
        {"instance_types": ["t3.micro"]},
        {"interruption_queue_url": "https://sqs.us-west-2.amazonaws.com/333333333333/events"},
        {"security_group_ids": ["sg-anything"]},
    ],
)
def test_enrollments_reject_invalid_or_cross_account_resources(change):
    value = enrollment()
    value.update(change)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, spotbot_aws_accounts=json.dumps({"gpuwest": value}))


def test_enrollments_reject_reserved_alias_and_ambiguous_routes():
    for value in ({"default": enrollment()}, {"a": enrollment(), "b": enrollment()}):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, spotbot_aws_accounts=json.dumps(value))


def test_expected_identity_is_checked_before_using_ec2():
    settings = Settings(_env_file=None, spotbot_aws_expected_account_id="222222222222")

    class WrongAccount:
        def client(self, name, **kwargs):
            assert name == "sts", "No EC2 operation may precede account verification"
            return SimpleNamespace(get_caller_identity=lambda: {"Account": "333333333333"})

    provider = AWSProvider(settings, None, session=WrongAccount())
    with pytest.raises(ProviderError, match="aws_account_identity_mismatch"):
        provider._client("us-west-2")
    assert not provider.clients


async def test_healthy_account_collects_when_other_account_is_unavailable(monkeypatch):
    provider = AWSProvider(Settings(_env_file=None), None)
    child = SimpleNamespace(collect=AsyncMock(return_value=["target-quote"]))
    provider.account_providers = {"gpuwest": child}
    monkeypatch.setattr(provider, "_execute", AsyncMock(side_effect=ProviderError("source_down")))
    assert await provider.collect() == ["target-quote"]
    child.collect.side_effect = ProviderError("target_down")
    with pytest.raises(ProviderError, match="source_down"):
        await provider.collect()


async def test_catalog_shadows_default_route_and_retains_target_backoff(monkeypatch):
    value = enrollment()
    value["instance_types"] = ["p5.4xlarge"]
    settings = Settings(
        _env_file=None,
        spotbot_aws_accounts=json.dumps({"gpuwest": value}),
        spotbot_aws_regions="us-west-2",
    )
    provider = AWSProvider(settings, None, session=FakeAWS())
    child = provider.fulfillment_providers()["gpuwest"]
    child.session = FakeAWS()
    child.identity_checked = True  # Identity verification is covered separately.
    assert all(o.sku != "p5.4xlarge" for o in provider._collect())
    offers = await provider.collect()
    targets = [o for o in offers if o.sku == "p5.4xlarge"]
    assert targets and all(o.details["aws_account"] == "gpuwest" for o in targets)
    assert all(o.details["aws_account_id"] == value["account_id"] for o in targets)
    child.note_failure(targets[0], ProviderError("aws_InsufficientInstanceCapacity"))
    assert provider.public_offer(targets[0], 900)["can_attempt"] is False
    provider.account_providers = {}
    assert provider.public_offer(targets[0], 900)["eligibility_status"] == "aws_account_not_enrolled"


@pytest.fixture
def account_env(rental_env, monkeypatch):
    env = rental_env
    original_engine, original_cloud = env.engine, env.cloud
    legacy, _ = original_engine.create(env.request, "tenant-a", "legacy-request")
    env.service.settings.spotbot_aws_accounts = json.dumps({"gpuwest": enrollment()})
    account = env.service.settings.aws_accounts["gpuwest"]
    provider = AWSProvider(
        account_settings(env.service.settings, "gpuwest", account), None, session=FakeAWS()
    )
    env.service.providers["aws"] = SimpleNamespace(
        configured=True,
        fulfillment_providers=lambda: {"gpuwest": provider},
    )
    router = RentalAccounts(env.service, original_engine)
    child = router.engines["gpuwest"]
    target_cloud = Cloud()
    child.backend = target_cloud
    monkeypatch.setattr(child, "poll_interruptions", AsyncMock())
    env.service.rentals = router
    env.engine, env.cloud = router, target_cloud
    target = env.offer.model_copy(deep=True)
    target.cloud = "aws-gpuwest"
    target.details.update(aws_account="gpuwest", aws_account_id=account.account_id)
    env.service.store.record_collection("aws", [env.offer, target])
    env.request = env.request.model_copy(deep=True)
    env.request.rfq.instance_types = ["p5.test"]
    env.legacy, env.original_cloud, env.target = legacy, original_cloud, target
    return env


async def test_web_purchase_is_pinned_and_legacy_lifetimes_keep_original_backend(account_env):
    env = account_env
    row, created = env.engine.create(env.request, "tenant-a", "purchase")
    assert created and row["rfq"]["account"] == "gpuwest"
    assert row["aws_account_id"] == "222222222222"
    replay, created = env.engine.create(env.request, "tenant-a", "purchase")
    assert not created and replay["id"] == row["id"]
    assert env.engine.get(env.legacy["id"], "tenant-a")["rfq"]["account"] == "default"
    assert env.engine.candidates(env.request.rfq) == [env.target]
    assert env.engine.default.candidates(env.request.rfq) == [env.offer]
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE" and len(env.cloud.creates) == 1
    assert len(env.original_cloud.creates) == 1
    generation = env.engine.current(row)
    assert generation["aws_account_id"] == "222222222222"
    assert generation["offer"]["cloud"] == "aws-gpuwest"
    assert all(b["aws_account_id"] == "222222222222" for b in env.engine.backups(row))


async def test_replacement_and_cleanup_use_same_account_while_old_instance_survives(account_env):
    env = account_env
    row, _ = env.engine.create(env.request, "tenant-a", "replace")
    row = await deliver(env, row["id"])
    first = env.engine.current(row)
    for v in first["volumes"]:
        env.cloud.files[v["volume_id"]]["weights"] = "customer-model"
    event = {
        "source": "aws.ec2",
        "detail-type": "EC2 Spot Instance Interruption Warning",
        "region": first["region"],
        "account": "222222222222",
        "detail": {"instance-id": first["instance_id"]},
    }
    # The two fake accounts intentionally have the same instance ID and Region.
    original = copy.deepcopy(env.engine.get(env.legacy["id"], "tenant-a"))
    child = env.engine.engines["gpuwest"]
    await child.handle_interruption(event)
    assert env.engine.get(env.legacy["id"], "tenant-a") == original
    wrong = {**event, "account": "333333333333"}
    with pytest.raises(ValueError, match="interruption_account_mismatch"):
        await child.handle_interruption(wrong)
    env.clock.advance(11)
    await cycle(env, 8)
    env.clock.advance(31)
    row = await deliver(env, row["id"])
    assert row["generation"] == 2 and len(env.cloud.creates) == 2
    for v in env.engine.current(row)["volumes"]:
        assert env.cloud.files[v["volume_id"]]["weights"] == "customer-model"
    assert not env.original_cloud.terminations
    await env.engine.release(row["id"], "tenant-a")
    env.clock.advance(11)
    await cycle(env, 15)
    env.clock.advance(61)
    await cycle(env, 3)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "CLOSED"
    assert env.cloud.deleted_snapshots
    assert not env.original_cloud.deleted_snapshots


async def test_account_reassignment_and_removal_fail_closed(account_env):
    env = account_env
    row, _ = env.engine.create(env.request, "tenant-a", "immutable")
    child = env.engine.engines["gpuwest"]
    child.settings.spotbot_aws_expected_account_id = "333333333333"
    with pytest.raises(ValueError, match="aws_account_identity_mismatch"):
        await env.engine.release(row["id"], "tenant-a")
    await env.engine.tick()
    assert not env.cloud.creates
    env.engine.engines.pop("gpuwest")
    assert env.engine.get(row["id"], "tenant-a")["id"] == row["id"]
    with pytest.raises(ValueError, match="aws_account_not_enrolled"):
        await env.engine.release(row["id"], "tenant-a")
    with pytest.raises(LookupError):
        await env.engine.release(row["id"], "tenant-b")


def test_paid_provider_preflight_uses_routed_backend_without_allocating(account_env):
    env = account_env
    env.cloud.preflight = AsyncMock()
    env.original_cloud.preflight = AsyncMock()
    client = TestClient(create_app(env.service.settings, env.service))
    result = client.post(
        "/v1/rentals/preflight",
        json=env.request.model_dump(mode="json"),
        headers={"Authorization": "Bearer " + "a" * 32},
    )
    assert result.status_code == 200, result.text
    assert result.json()["eligible"] is True
    env.cloud.preflight.assert_awaited_once()
    env.original_cloud.preflight.assert_not_called()
    assert not env.cloud.creates


def test_unprotected_orders_cannot_bypass_rental_routing(account_env):
    env = account_env
    provider = AWSProvider(env.service.settings, None)
    with pytest.raises(ValueError, match="additional_accounts_require_protected_rentals"):
        provider.plan(env.target, None, "unsafe", max_price_hourly=3)
