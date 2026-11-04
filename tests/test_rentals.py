"""State-machine acceptance tests with durable storage and a deterministic cloud."""

import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from spotbot.api import create_app
from spotbot.models import Offer
from spotbot.providers import ProviderError
from spotbot.rental_models import AgentReport, GatewayAck, RentalRequest, RevisionRequest
from spotbot.rentals import CLOSED_RENTAL_SECONDS, RentalEngine


class Clock:
    def __init__(self):
        self.value = datetime(2026, 10, 20, tzinfo=UTC)

    def now(self):
        return self.value

    def advance(self, seconds=1):
        self.value += timedelta(seconds=seconds)


class Cloud:
    def __init__(self):
        self.instances, self.volumes, self.snapshot_sets, self.images = {}, {}, {}, {}
        self.files = {}
        self.creates, self.deleted_volumes, self.deleted_snapshots = [], [], []
        self.launch_error = None
        self.snapshot_error = None
        self.pending_snapshots = False
        self.slow_termination = False  # GPU instances stay shutting-down for minutes.
        self.terminations = []
        self.reclaiming = set()  # Generations AWS has marked for Spot reclamation.
        self.interruption_checks = 0
        self.base = dict(
            ImageId="ami-base",
            State="available",
            Architecture="x86_64",
            RootDeviceName="/dev/sda1",
            BlockDeviceMappings=[
                {"DeviceName": "/dev/sda1", "Ebs": {"SnapshotId": "snap-base", "VolumeSize": 50}}
            ],
        )

    async def image(self, region, image_id):
        return copy.deepcopy(self.images.get((region, image_id), self.base))

    async def launch(self, row, gen, offer, rules, backup, **options):
        self.creates.append(copy.deepcopy(gen))
        if self.launch_error and not self.launch_error.ambiguous:
            raise self.launch_error
        instance_id = "i-" + f"{len(self.creates):08x}"
        self.instances[gen["id"]] = dict(
            InstanceId=instance_id, State={"Name": "running"}, PublicIpAddress="127.0.0.1"
        )
        disks = [
            {"device": "/dev/sda1", "size_gib": rules.root_volume_gib},
            *[dict(device=d.device, size_gib=d.size_gib) for d in rules.data_disks],
        ]
        for i, disk in enumerate(disks):
            disk["volume_id"] = "vol-" + f"{len(self.creates):04x}{i:04x}"
            disk["rental_id"] = row["id"]
            disk["generation_id"] = gen["id"]
            self.volumes[disk["volume_id"]] = disk
            if backup:
                old = next(v for v in backup["volumes"] if v["device"] == disk["device"])
                snap = next(
                    s for s in self.snapshot_sets[backup["id"]] if s["VolumeId"] == old["volume_id"]
                )
                self.files[disk["volume_id"]] = copy.deepcopy(snap["files"])
            else:
                self.files[disk["volume_id"]] = {
                    "canary": hashlib.sha256(disk["device"].encode()).hexdigest()
                }
        if self.launch_error:
            raise self.launch_error
        return instance_id

    async def find_instance(self, gen):
        return self.instances.get(gen["id"], {}).get("InstanceId")

    async def instance(self, gen):
        return copy.deepcopy(self.instances.get(gen["id"]))

    async def inventory(self, gen, instance):
        return [
            {k: v[k] for k in ["device", "size_gib", "volume_id"]}
            for v in self.volumes.values()
            if v["generation_id"] == gen["id"]
        ]

    async def terminate(self, gen):
        self.terminations.append(gen["id"])
        self.instances[gen["id"]]["State"]["Name"] = (
            "shutting-down" if self.slow_termination else "terminated"
        )

    async def interruption_confirmed(self, gen):
        self.interruption_checks += 1
        return gen["id"] in self.reclaiming

    def finish_shutdown(self):
        for instance in self.instances.values():
            if instance["State"]["Name"] == "shutting-down":
                instance["State"]["Name"] = "terminated"

    async def volumes_available(self, gen):
        return self.instances[gen["id"]]["State"]["Name"] == "terminated"

    async def snapshots(self, backup):
        return copy.deepcopy(self.snapshot_sets.get(backup["id"], []))

    async def start_snapshots(self, backup, gen, volume=None):
        found = self.snapshot_sets.setdefault(backup["id"], [])
        for v in backup["volumes"]:
            if not volume or v["volume_id"] == volume:
                found.append(
                    dict(
                        SnapshotId="snap-" + backup["id"][:8] + v["volume_id"][-2:],
                        VolumeId=v["volume_id"],
                        State="pending" if self.pending_snapshots else "completed",
                        files=copy.deepcopy(self.files[v["volume_id"]]),
                    )
                )
        if self.snapshot_error:
            raise self.snapshot_error
        return found

    async def register_image(self, backup, gen, snapshots):
        image_id = "ami-" + backup["id"][:8]
        image = copy.deepcopy(self.base)
        image.update(
            ImageId=image_id,
            BlockDeviceMappings=[
                {
                    "DeviceName": v["device"],
                    "Ebs": {
                        "SnapshotId": next(
                            s["SnapshotId"] for s in snapshots if s["VolumeId"] == v["volume_id"]
                        ),
                        "VolumeSize": v["size_gib"],
                    },
                }
                for v in backup["volumes"]
            ],
        )
        self.images[(backup["region"], image_id)] = image
        return image_id

    async def find_image(self, backup):
        image_id = "ami-" + backup["id"][:8]
        return image_id if (backup["region"], image_id) in self.images else None

    async def copy_image(self, backup, region):
        image_id = "ami-copy-" + backup["id"][:8]
        self.images[(region, image_id)] = copy.deepcopy(
            self.images[(backup["region"], backup["image_id"])]
        )
        return image_id

    async def delete_backup(self, backup):
        backup["cleanup_snapshots"] = {
            backup["region"]: [s["SnapshotId"] for s in self.snapshot_sets.get(backup["id"], [])]
        }

    async def delete_image(self, region, image_id, rental_id):
        self.images.pop((region, image_id), None)

    async def delete_snapshot(self, region, snapshot_id):
        self.deleted_snapshots.append(snapshot_id)

    async def delete_volume(self, gen, volume_id):
        self.deleted_volumes.append(volume_id)


@pytest.fixture
def rental_env(service_factory, monkeypatch):
    # Load the lazy backend before replacing the clock: an import during the
    # fixture would retain the fake clock after monkeypatch restores the model.
    import importlib

    importlib.import_module("spotbot.storage.sqlite")
    clock = Clock()
    monkeypatch.setattr("spotbot.models.utcnow", clock.now)
    monkeypatch.setattr("spotbot.rentals.utcnow", clock.now)
    monkeypatch.setattr("spotbot.rental_aws.utcnow", clock.now)
    service = service_factory(
        lambda request: None,
        spotbot_rentals_enabled=True,
        spotbot_live_orders_enabled=True,
        spotbot_enabled_providers="aws",
        spotbot_aws_regions="us-west-2,us-east-1",
        spotbot_rental_public_url="https://bot.example.com",
        spotbot_rental_interruption_queues=json.dumps(
            {r: f"https://sqs.{r}.amazonaws.com/123456789012/interruptions" for r in ("us-west-2", "us-east-1")}
        ),
        spotbot_rental_tenant_tokens=SecretStr(
            '{"tenant-a":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tenant-b":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
        ),
    )
    cloud = Cloud()
    service.providers["aws"] = SimpleNamespace(configured=True)
    service.rentals = RentalEngine(service, cloud)

    async def no_queue_messages():
        return None

    # Tests deliver interruption events directly; the fake cloud has no SQS client.
    monkeypatch.setattr(service.rentals, "poll_interruptions", no_queue_messages)
    rfq = dict(
        rfq_id="rfq-1",
        rfq_version=1,
        upstream_order_id="order-1",
        regions=["us-west-2"],
        gpu_model="H100",
        gpu_count=1,
        min_gpu_memory_gib=80,
        price_unit="instance_hour",
        max_price_hourly="3",
        budget_usd="100",
        ssh_key_name="customer",
        acquisition_deadline=(clock.now() + timedelta(hours=1)).isoformat(),
        expires_at=(clock.now() + timedelta(hours=2)).isoformat(),
        data_disks=[{"device": "/dev/sdf", "size_gib": 100}],
        backup={"final_retention_seconds": 60},
    )
    offer = Offer(
        provider="aws",
        cloud="aws",
        sku="p5.test",
        region="us-west-2",
        availability_zone="us-west-2a",
        market="spot",
        gpu_model="H100",
        gpu_description="NVIDIA H100",
        gpu_count=1,
        vcpus=16,
        memory_gb=128,
        storage_gb=50,
        price_hourly="2",
        available=False,
        source_url="https://ec2.us-west-2.amazonaws.com",
        details=dict(
            architecture="x86_64",
            gpu_specifications=[{"MemoryInfo": {"SizeInMiB": 81920}}],
            quota_sufficient=True,
            subnet_id="subnet-a",
            security_group_ids=["sg-test"],
            image_id="ami-base",
        ),
    )
    service.store.record_collection("aws", [offer])
    return SimpleNamespace(
        service=service,
        engine=service.rentals,
        cloud=cloud,
        clock=clock,
        request=RentalRequest(rfq=rfq),
        offer=offer,
        frozen={},
    )


async def cycle(env, n=1):
    for _ in range(n):
        await env.engine.tick()
        env.clock.advance()


async def report_ready(env, rental_id, *, freeze=False, ack_freeze=True, thawed=None, interruption=False):
    row = env.engine.get(rental_id, "tenant-a")
    gen = env.engine.current(row)
    volumes = await env.cloud.inventory(gen, None)

    def report(flushed, frozen=None):
        return AgentReport(
            freeze_supported=freeze,
            frozen_command=frozen or env.frozen.get(gen["id"]),
            thawed_command=thawed,
            interruption=interruption,
            rental_id=rental_id,
            generation=gen["generation"],
            instance_id=gen["instance_id"],
            token=gen["agent_token"],
            gpu_model="NVIDIA H100 80GB",
            gpu_count=1,
            gpu_memory_mib=81559,
            ssh_ready=True,
            volume_ids=[v["volume_id"] for v in volumes],
            mounts=["/", "/data/sdf"],
            canaries={v["volume_id"]: env.cloud.files[v["volume_id"]]["canary"] for v in volumes},
            flushed_command=flushed,
        )

    flushed = row.get("flush_command")
    instructions = await env.engine.agent_report(report(flushed))
    # Like the real agent: run a requested flush, then report it immediately.
    if instructions["flush_command"] and instructions["flush_command"] != flushed:
        flushed = instructions["flush_command"]
        instructions = await env.engine.agent_report(report(flushed))
    command = instructions.get("freeze_command")
    if freeze and ack_freeze and command and not env.frozen.get(gen["id"]):
        env.frozen[gen["id"]] = command  # The fake guest never writes once frozen.
        await env.engine.agent_report(report(flushed, command))


async def deliver(env, rental_id):
    for _ in range(20):
        row = env.engine.get(rental_id, "tenant-a")
        if (
            env.engine.current(row)
            and env.engine.current(row).get("instance_id")
            and env.engine.current(row)["state"] not in {"STOPPED", "REJECTED"}
        ):
            await report_ready(env, rental_id)
        await cycle(env)
        row = env.engine.get(rental_id, "tenant-a")
        if row["state"] == "DELIVERING":
            return await env.engine.gateway_ack(
                rental_id, "tenant-a", GatewayAck(generation=row["generation"], accepted=True)
            )
    pytest.fail(str(env.engine.get(rental_id, "tenant-a")))


async def test_full_server_backup_replacement_and_expiry(rental_env):
    env = rental_env
    row, created = env.engine.create(env.request, "tenant-a", "request-1")
    assert created
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE" and row["generation"] == 1
    first = env.engine.current(row)
    for volume in first["volumes"]:
        env.cloud.files[volume["volume_id"]]["customer-file"] = "weights-and-software"
    event = {
        "source": "aws.ec2",
        "detail-type": "EC2 Spot Instance Interruption Warning",
        "region": first["region"],
        "detail": {"instance-id": first["instance_id"]},
    }
    await env.engine.handle_interruption(event)
    await env.engine.handle_interruption(event)
    assert env.engine.get(row["id"], "tenant-a")["connection"] is None
    env.clock.advance(11)
    await cycle(env, 8)
    env.clock.advance(31)
    row = await deliver(env, row["id"])
    assert row["generation"] == 2 and len(env.cloud.creates) == 2
    second = env.engine.current(row)
    for volume in second["volumes"]:
        assert env.cloud.files[volume["volume_id"]]["customer-file"] == "weights-and-software"
    await cycle(env)
    assert set(v["volume_id"] for v in first["volumes"]) <= set(env.cloud.deleted_volumes)
    env.clock.advance(7200)
    await cycle(env, 15)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "CLOSED"
    assert len(env.cloud.creates) == 2
    # Retention (60 s here) is enforced at the closed-rental cleanup cadence.
    env.clock.advance(CLOSED_RENTAL_SECONDS + 1)
    await cycle(env, 2)
    assert not env.cloud.images
    assert all(v in env.cloud.deleted_volumes for v in env.cloud.volumes)
    assert env.cloud.deleted_snapshots


async def test_rfq_initial_image_is_scoped_and_recovery_uses_backup(rental_env):
    env = rental_env
    request = env.request.model_copy(deep=True)
    region = request.rfq.regions[0]
    request.rfq.initial_image_ids = {region: "ami-0123456789abcdef0"}
    row, _ = env.engine.create(request, "tenant-a", "custom-image")
    row = await deliver(env, row["id"])
    assert env.engine.current(row)["image_id"] == "ami-0123456789abcdef0"
    assert env.offer.details["image_id"] == "ami-base"
    changed = request.model_copy(deep=True)
    changed.rfq.initial_image_ids = {region: "ami-abcdef01234567890"}
    with pytest.raises(ValueError, match="idempotency_key_conflict"):
        env.engine.create(changed, "tenant-a", "custom-image")
    await env.engine.recover(row["id"], "tenant-a", None)
    env.clock.advance(11)
    await cycle(env, 8)
    env.clock.advance(31)
    row = await deliver(env, row["id"])
    assert row["generation"] == 2
    assert env.engine.current(row)["image_id"] != "ami-0123456789abcdef0"
    assert env.engine.current(row)["source_backup_id"]


async def test_operator_base_image_is_the_default_and_rfq_images_override_it(rental_env):
    env = rental_env
    env.service.settings.spotbot_rental_initial_images = json.dumps(
        {"us-west-2": "ami-0aaaaaaaaaaaaaaaa"}
    )
    row, _ = env.engine.create(env.request, "tenant-a", "operator-base")
    row = await deliver(env, row["id"])
    assert env.engine.current(row)["image_id"] == "ami-0aaaaaaaaaaaaaaaa"
    request = env.request.model_copy(deep=True)
    request.rfq.initial_image_ids = {"us-west-2": "ami-0123456789abcdef0"}
    custom, _ = env.engine.create(request, "tenant-a", "rfq-image")
    custom = await deliver(env, custom["id"])
    assert env.engine.current(custom)["image_id"] == "ami-0123456789abcdef0"


def test_operator_base_images_must_name_rental_regions_and_amis():
    from spotbot.config import Settings

    values = dict(
        _env_file=None,
        spotbot_aws_regions="us-west-2,us-east-1",
        spotbot_rental_regions="us-west-2",
    )
    for images in ({"us-east-1": "ami-0aaaaaaaaaaaaaaaa"}, {"us-west-2": "not-an-ami"}):
        with pytest.raises(ValidationError, match="initial images"):
            Settings(**values, spotbot_rental_initial_images=json.dumps(images))
    ok = Settings(**values, spotbot_rental_initial_images='{"us-west-2": "ami-0aaaaaaaaaaaaaaaa"}')
    assert ok.rental_initial_images == {"us-west-2": "ami-0aaaaaaaaaaaaaaaa"}


async def test_recovery_region_enrollment_does_not_expand_legacy_regions(rental_env):
    env = rental_env
    assert env.service.settings.aws_order_regions == ["us-west-2", "us-east-1"]
    env.service.settings.spotbot_rental_regions = "us-west-2"
    denied = env.request.model_copy(deep=True)
    denied.rfq.regions = ["us-east-1"]
    with pytest.raises(ValueError, match="region_not_enabled_for_rentals"):
        env.engine.create(denied, "tenant-a", "unprepared-region")
    assert not env.cloud.creates
    assert env.service.settings.aws_order_regions == ["us-west-2", "us-east-1"]
    row, _ = env.engine.create(env.request, "tenant-a", "queued-before-region-removal")
    env.service.settings.spotbot_rental_regions = "us-east-1"
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTION_REQUIRED" and row["error"] == "region_not_enabled_for_rentals"
    assert not env.cloud.creates


async def test_rentals_never_buy_where_interruption_warnings_cannot_arrive(rental_env):
    env = rental_env
    queues = json.loads(env.service.settings.spotbot_rental_interruption_queues)
    queued, _ = env.engine.create(env.request, "tenant-a", "queue-removed-later")
    env.service.settings.spotbot_rental_interruption_queues = json.dumps(
        {"us-east-1": queues["us-east-1"]}
    )
    with pytest.raises(ValueError, match="interruption_queue_not_configured"):
        env.engine.create(env.request, "tenant-a", "unmonitored-region")
    await cycle(env)
    row = env.engine.get(queued["id"], "tenant-a")
    assert row["state"] == "ACTION_REQUIRED" and row["error"] == "interruption_queue_not_configured"
    assert not env.cloud.creates


def test_every_rental_region_requires_an_interruption_queue():
    from spotbot.config import Settings

    values = dict(
        _env_file=None,
        spotbot_rentals_enabled=True,
        spotbot_aws_regions="us-west-2,us-east-1",
        spotbot_rental_regions="us-west-2,us-east-1",
        spotbot_rental_interruption_queues=json.dumps(
            {"us-west-2": "https://sqs.us-west-2.amazonaws.com/123456789012/interruptions"}
        ),
    )
    with pytest.raises(ValidationError, match="requires an interruption queue"):
        Settings(**values)
    assert Settings(**dict(values, spotbot_rental_regions="us-west-2")).rental_regions == ["us-west-2"]


def test_customer_reference_is_part_of_the_idempotent_request(rental_env):
    env = rental_env
    request = env.request.model_copy(deep=True)
    request.rfq.customer_ref = "opennext:user-1"
    row, created = env.engine.create(request, "tenant-a", "customer-order")
    assert created and row["rfq"]["customer_ref"] == "opennext:user-1"
    other = request.model_copy(deep=True)
    other.rfq.customer_ref = "opennext:user-2"
    with pytest.raises(ValueError, match="idempotency_key_conflict"):
        env.engine.create(other, "tenant-a", "customer-order")


def test_rfq_initial_image_validation_and_legacy_idempotency(rental_env):
    env = rental_env
    old = env.request.model_dump(mode="json")
    for name in ("initial_image_ids", "ssh_public_key", "customer_ref", "service_seconds",
                 "procurement_account", "inference", "retail_hourly_cents", "funding"):
        old["rfq"].pop(name)  # A client from before these optional fields existed.
    from spotbot.storage.common import dump

    row, _ = env.engine.create(env.request, "tenant-a", "old-client")
    assert row["fingerprint"] == hashlib.sha256(dump(old).encode()).hexdigest()
    assert env.engine.create(RentalRequest.model_validate(old), "tenant-a", "old-client")[1] is False
    for images in ({"us-east-1": "ami-0123456789abcdef0"}, {env.request.rfq.regions[0]: "ami-invalid"}):
        invalid = env.request.model_dump(mode="json")
        invalid["rfq"]["initial_image_ids"] = images
        with pytest.raises(ValidationError, match="initial_images_must_cover"):
            RentalRequest.model_validate(invalid)


async def test_unknown_create_is_reconciled_without_repurchase(rental_env):
    env = rental_env
    env.cloud.launch_error = ProviderError("aws_transport_error", ambiguous=True)
    row, _ = env.engine.create(env.request, "tenant-a", "uncertain")
    await cycle(env)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "NEEDS_RECONCILIATION"
    env.cloud.launch_error = None
    await cycle(env)
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE" and len(env.cloud.creates) == 1


async def test_pending_final_snapshot_survives_instance_termination(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "pending")
    row = await deliver(env, row["id"])
    env.cloud.pending_snapshots = True
    await env.engine.release(row["id"], "tenant-a")
    env.clock.advance(11)
    await cycle(env, 10)
    gen = env.engine.current(env.engine.get(row["id"], "tenant-a"))
    assert gen["state"] == "STOPPED" and env.cloud.volumes
    assert env.engine.get(row["id"], "tenant-a")["state"] == "ENDING"
    for values in env.cloud.snapshot_sets.values():
        for value in values:
            value["State"] = "completed"
    await cycle(env, 5)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "CLOSED"


async def test_snapshot_timeout_adopts_tagged_result(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "snap-timeout")
    await cycle(env)
    await report_ready(env, row["id"])
    await cycle(env)
    await cycle(env)
    await report_ready(env, row["id"])  # The guest flushes before the initial capture.
    env.cloud.snapshot_error = ProviderError("aws_transport_error", ambiguous=True)
    await cycle(env)
    backup = env.engine.backups(env.engine.get(row["id"], "tenant-a"))[0]
    assert backup["state"] == "NEEDS_RECONCILIATION"
    env.cloud.snapshot_error = None
    await env.engine.reconcile_backup(row["id"], "tenant-a", backup["id"])
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE"
    assert len(env.cloud.snapshot_sets[backup["id"]]) == 2


async def test_routine_backup_waits_for_guest_flush_and_records_it(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "flush-before-backup")
    row = await deliver(env, row["id"])
    env.clock.advance(901)
    await report_ready(env, row["id"])  # Fresh heartbeat; no routine flush requested yet.
    await cycle(env, 2)
    backup = next(b for b in env.engine.backups(row) if b["state"] == "REQUESTED")
    command = backup["flush_command"]
    snapshots = len(env.cloud.snapshot_sets)
    await cycle(env)
    assert env.engine.db.get("backup", backup["id"])["state"] == "REQUESTED"
    assert len(env.cloud.snapshot_sets) == snapshots  # No capture before the guest syncs.
    gen = env.engine.current(env.engine.get(row["id"], "tenant-a"))
    instructions = await env.engine.agent_report(
        AgentReport(
            rental_id=row["id"], generation=gen["generation"], instance_id=gen["instance_id"],
            token=gen["agent_token"], ssh_ready=True,
            flushed_command=env.engine.get(row["id"], "tenant-a").get("flush_command"),
        )
    )
    assert instructions["flush_command"] == command
    await report_ready(env, row["id"])
    await cycle(env)
    backup = env.engine.db.get("backup", backup["id"])
    assert backup["state"] != "REQUESTED" and backup["consistency"] == "guest_flushed"


async def test_unresponsive_guest_does_not_block_routine_backups(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "silent-guest")
    row = await deliver(env, row["id"])
    env.clock.advance(901)
    await report_ready(env, row["id"])  # Fresh heartbeat; no routine flush requested yet.
    await cycle(env, 2)
    backup = next(b for b in env.engine.backups(row) if b["state"] == "REQUESTED")
    env.clock.advance(31)
    await cycle(env)
    backup = env.engine.db.get("backup", backup["id"])
    assert backup["state"] != "REQUESTED" and backup["consistency"] == "crash_consistent"


async def freeze_capable_recovery(env, key):
    row, _ = env.engine.create(env.request, "tenant-a", key)
    row = await deliver(env, row["id"])
    old = env.engine.current(row)
    for volume in old["volumes"]:
        env.cloud.files[volume["volume_id"]]["late"] = "written-before-freeze"
    await report_ready(env, row["id"], freeze=True, ack_freeze=False)
    await env.engine.recover(row["id"], "tenant-a")
    await cycle(env)
    return env.engine.get(row["id"], "tenant-a"), old


def frozen_backups(env, row):
    return [b for b in env.engine.backups(row) if b.get("frozen_command")]


async def test_frozen_switch_captures_before_terminating_and_skips_shutdown(rental_env):
    env = rental_env
    env.cloud.slow_termination = True
    row, old = await freeze_capable_recovery(env, "frozen-switch")
    command = row["freeze_command"]
    assert command and row["freeze_generation_id"] == old["id"]
    await cycle(env, 3)
    assert not frozen_backups(env, row) and not env.cloud.terminations  # No capture unconfirmed.
    await report_ready(env, row["id"], freeze=True)  # The guest freezes and confirms.
    for _ in range(8):
        await cycle(env)
        row = env.engine.get(row["id"], "tenant-a")
        if row["state"] != "RECOVERING":
            break
    backup = frozen_backups(env, row)[0]
    assert backup["final"] and backup["consistency"] == "guest_frozen"
    assert row["current_backup_id"] == backup["id"]
    # Terminated only after the snapshots existed, and the old server is still shutting down.
    assert env.cloud.terminations == [old["id"]]
    assert env.cloud.instances[old["id"]]["State"]["Name"] == "shutting-down"
    env.clock.advance(31)  # The ordinary retry delay since the last launch request.
    row = await deliver(env, row["id"])
    assert row["generation"] > old["generation"]
    for volume in env.engine.current(row)["volumes"]:
        assert env.cloud.files[volume["volume_id"]]["late"] == "written-before-freeze"
    # The replacement's guest is never asked to freeze.
    gen = env.engine.current(row)
    instructions = await env.engine.agent_report(
        AgentReport(rental_id=row["id"], generation=gen["generation"], instance_id=gen["instance_id"],
                    token=gen["agent_token"], freeze_supported=True)
    )
    assert instructions["freeze_command"] is None
    # Once AWS finishes, cleanup stops the old generation and releases its disks.
    env.cloud.finish_shutdown()
    await cycle(env, 2)
    stopped = env.engine.db.get("generation", old["id"])
    assert stopped["state"] == "STOPPED" and stopped["ended_at"]
    assert {v["volume_id"] for v in old["volumes"]} <= set(env.cloud.deleted_volumes)


async def test_unconfirmed_freeze_falls_back_to_capturing_retained_disks(rental_env):
    env = rental_env
    row, old = await freeze_capable_recovery(env, "freeze-unconfirmed")
    env.clock.advance(46)
    await cycle(env, 8)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["freeze_abandoned"] == "freeze_unconfirmed" and not frozen_backups(env, row)
    final = env.engine.db.get("backup", row["current_backup_id"])
    assert final["final"] and final["consistency"] == "crash_consistent"
    assert env.engine.db.get("generation", old["id"])["state"] == "STOPPED"  # Captured after stop.


async def test_freeze_trust_expiry_before_termination_falls_back(rental_env):
    env = rental_env
    row, old = await freeze_capable_recovery(env, "freeze-trust")
    original = env.cloud.start_snapshots

    async def throttled(*args, **kwargs):
        raise ProviderError("aws_RequestLimitExceeded", retryable=True)  # Nothing created.

    env.cloud.start_snapshots = throttled
    await report_ready(env, row["id"], freeze=True)
    await cycle(env, 3)
    assert frozen_backups(env, row) and not env.cloud.terminations
    env.clock.advance(301)
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["freeze_abandoned"] == "freeze_trust_expired"
    assert not frozen_backups(env, row)[0]["final"]  # Not the final disk state any more.
    env.cloud.start_snapshots = original
    await cycle(env, 12)
    row = env.engine.get(row["id"], "tenant-a")
    final = env.engine.db.get("backup", row["current_backup_id"])
    assert final["final"] and not final.get("frozen_command")


async def test_guest_watchdog_thaw_abandons_the_frozen_snapshot(rental_env):
    env = rental_env
    row, old = await freeze_capable_recovery(env, "freeze-thawed")
    await report_ready(env, row["id"], freeze=True, ack_freeze=False, thawed=row["freeze_command"])
    await cycle(env)
    assert env.engine.get(row["id"], "tenant-a")["freeze_abandoned"] == "guest_thawed"


async def test_old_agents_and_explicit_backups_keep_the_ordinary_path(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "old-agent")
    row = await deliver(env, row["id"])
    await env.engine.recover(row["id"], "tenant-a")
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["freeze_abandoned"] == "freeze_unsupported" and not row.get("freeze_command")


async def test_recovery_to_a_named_backup_never_uses_the_frozen_snapshot(rental_env):
    env = rental_env
    request = env.request.model_copy(deep=True)
    request.rfq.allow_older_backup = True
    row, _ = env.engine.create(request, "tenant-a", "named-backup")
    row = await deliver(env, row["id"])
    backup = next(b for b in env.engine.backups(row) if b["state"] == "AVAILABLE")
    await report_ready(env, row["id"], freeze=True)
    await env.engine.recover(row["id"], "tenant-a", backup["id"])
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["freeze_abandoned"] == "explicit_backup_requested"
    assert row["current_backup_id"] == backup["id"] and not frozen_backups(env, row)


async def test_unacknowledged_handoff_needs_an_operator_after_the_timeout(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "no-gateway-ack")
    for _ in range(20):
        gen = env.engine.current(env.engine.get(row["id"], "tenant-a"))
        if gen and gen.get("instance_id"):
            await report_ready(env, row["id"])
        await cycle(env)
        row = env.engine.get(row["id"], "tenant-a")
        if row["state"] == "DELIVERING":
            break
    assert row["state"] == "DELIVERING" and row["delivering_at"]
    env.clock.advance(590)
    await report_ready(env, row["id"])
    await cycle(env)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "DELIVERING"
    env.clock.advance(15)
    await report_ready(env, row["id"])
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTION_REQUIRED" and row["error"] == "gateway_ack_timeout"
    assert "rental.action_required" in event_types(env, row["id"])
    # A late acknowledgement cannot activate it; the operator recovers or releases.
    with pytest.raises(ValueError):
        await env.engine.gateway_ack(row["id"], "tenant-a", GatewayAck(generation=row["generation"], accepted=True))
    assert env.cloud.instances[env.engine.current(row)["id"]]["State"]["Name"] == "running"
    await env.engine.release(row["id"], "tenant-a")
    assert env.engine.get(row["id"], "tenant-a")["end_requested"]


async def test_forged_guest_interruption_does_not_replace_the_server(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "forged-interruption")
    row = await deliver(env, row["id"])
    await report_ready(env, row["id"], interruption=True)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTIVE" and env.cloud.interruption_checks == 1
    assert env.engine.current(row)["unconfirmed_interruption_at"]
    await report_ready(env, row["id"], interruption=True)
    assert env.cloud.interruption_checks == 1  # Rate-limited: one AWS check per 15 s.
    env.clock.advance(16)
    await report_ready(env, row["id"], interruption=True)
    assert env.cloud.interruption_checks == 2
    assert env.engine.get(row["id"], "tenant-a")["state"] == "ACTIVE"
    assert not env.cloud.terminations


async def test_guest_interruption_confirmed_by_aws_starts_recovery(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "confirmed-interruption")
    row = await deliver(env, row["id"])
    env.cloud.reclaiming.add(env.engine.current(row)["id"])
    await report_ready(env, row["id"], interruption=True)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "RECOVERING" and row["error"] == "spot_interruption"


def test_rfq_for_a_24_gb_gpu_selects_an_aws_l4_offer(rental_env):
    env = rental_env
    offer = copy.deepcopy(env.offer)
    offer.gpu_model, offer.sku = "L4", "g6.xlarge"
    offer.details["gpu_specifications"] = [{"MemoryInfo": {"SizeInMiB": 22888}}]
    env.service.store.record_collection("aws", [offer])
    rules = env.request.rfq.model_copy(update={"gpu_model": "L4", "min_gpu_memory_gib": 24})
    assert [o.sku for o in env.engine.candidates(rules)] == ["g6.xlarge"]
    assert not env.engine.candidates(rules.model_copy(update={"min_gpu_memory_gib": 32}))


def test_gpu_memory_uses_nominal_capacity_as_marketed():
    from spotbot.rental_models import gpu_memory_sufficient

    assert gpu_memory_sufficient(22888, 24)  # AWS L4 / A10G "24 GB"
    assert gpu_memory_sufficient(23034, 24)  # nvidia-smi L4
    assert gpu_memory_sufficient(15360, 16)  # T4 "16 GB"
    assert gpu_memory_sufficient(45776, 48)  # L40S "48 GB"
    assert gpu_memory_sufficient(81559, 80)  # H100 "80 GB"
    assert not gpu_memory_sufficient(16384, 24)
    assert not gpu_memory_sufficient(40960, 48)


async def test_recovery_keeps_original_rfq_limits(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "constraints")
    row = await deliver(env, row["id"])
    await env.engine.recover(row["id"], "tenant-a")
    env.clock.advance(11)
    await cycle(env, 8)
    offer = copy.deepcopy(env.offer)
    offer.region, offer.availability_zone, offer.price_hourly = (
        "us-east-1",
        "us-east-1a",
        Decimal(1),
    )
    env.service.store.record_collection("aws", [offer])
    env.clock.advance(31)
    await cycle(env, 5)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "WAITING_CAPACITY" and len(env.cloud.creates) == 1


def four_pools(env):
    offers = []
    for zone, price in (("a", "2.0"), ("b", "2.1"), ("c", "2.2"), ("d", "2.3")):
        offer = copy.deepcopy(env.offer)
        offer.availability_zone, offer.price_hourly = "us-west-2" + zone, Decimal(price)
        offers.append(offer)
    env.service.store.record_collection("aws", offers)


def fail_first(env, count, error):
    original, zones = env.cloud.launch, []

    async def launch(row, gen, offer, rules, backup, **options):
        zones.append(offer.availability_zone)
        if len(zones) <= count:
            raise error
        return await original(row, gen, offer, rules, backup, **options)

    env.cloud.launch = launch
    return zones


async def test_one_attempt_sweeps_every_pool_until_capacity_is_found(rental_env):
    env = rental_env
    four_pools(env)
    zones = fail_first(env, 3, ProviderError("aws_InsufficientInstanceCapacity", retryable=True))
    row, _ = env.engine.create(env.request, "tenant-a", "sweep")
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert zones == ["us-west-2a", "us-west-2b", "us-west-2c", "us-west-2d"]
    assert row["state"] == "PROVISIONING" and row["attempts"] == 1  # One sweep, four pools.
    assert env.engine.current(row)["offer"]["availability_zone"] == "us-west-2d"
    events = event_types(env, row["id"])
    assert events.count("rental.provisioning") == 1 and "rental.acquisition_failed" not in events


async def test_failed_sweep_waits_and_the_next_one_rotates_its_start(rental_env):
    env = rental_env
    four_pools(env)
    env.service.settings.spotbot_rental_pools_per_attempt = 3
    zones = fail_first(env, 99, ProviderError("aws_InsufficientInstanceCapacity", retryable=True))
    row, _ = env.engine.create(env.request, "tenant-a", "sweep-wait")
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert zones == ["us-west-2a", "us-west-2b", "us-west-2c"] and row["attempts"] == 1
    assert row["state"] == "WAITING_CAPACITY"
    assert event_types(env, row["id"]).count("rental.acquisition_failed") == 1
    await cycle(env)
    assert len(zones) == 3  # Waits retry_seconds before the next sweep.
    env.clock.advance(30)
    await cycle(env)
    assert zones[3:] == ["us-west-2d", "us-west-2a", "us-west-2b"]


async def test_ambiguous_create_stops_the_sweep(rental_env):
    env = rental_env
    four_pools(env)
    zones = fail_first(env, 99, ProviderError("aws_transport_error", ambiguous=True))
    row, _ = env.engine.create(env.request, "tenant-a", "sweep-ambiguous")
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert zones == ["us-west-2a"]  # Never buy elsewhere while a create may have succeeded.
    assert row["state"] == "NEEDS_RECONCILIATION"


async def test_max_attempts_counts_sweeps_not_pools(rental_env):
    env = rental_env
    four_pools(env)
    request = env.request.model_copy(deep=True)
    request.rfq.max_attempts = 2
    zones = fail_first(env, 99, ProviderError("aws_InsufficientInstanceCapacity", retryable=True))
    row, _ = env.engine.create(request, "tenant-a", "sweep-limit")
    for _ in range(3):
        await cycle(env)
        env.clock.advance(30)
    row = env.engine.get(row["id"], "tenant-a")
    # max_attempts counts sweeps, so a default RFQ is not exhausted by pool count.
    assert len(zones) == 8 and row["attempts"] == 2
    assert row["state"] == "ENDING" and row["error"] == "acquisition_limit_reached"


async def test_expiry_during_create_never_delivers(rental_env):
    env = rental_env
    original = env.cloud.launch

    async def slow(*args, **options):
        result = await original(*args, **options)
        env.clock.advance(7201)
        return result

    env.cloud.launch = slow
    row, _ = env.engine.create(env.request, "tenant-a", "expiry")
    await cycle(env)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "ENDING"
    assert env.engine.get(row["id"], "tenant-a")["connection"] is None
    await cycle(env, 20)
    assert len(env.cloud.creates) == 1


async def test_duplicate_request_and_stale_revisions(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "same")
    same, created = env.engine.create(env.request, "tenant-a", "same")
    assert row["id"] == same["id"] and not created
    changed = env.request.model_copy(deep=True)
    changed.rfq.max_price_hourly = Decimal(4)
    with pytest.raises(ValueError, match="idempotency_key_conflict"):
        env.engine.create(changed, "tenant-a", "same")
    with pytest.raises(ValueError, match="rfq_version_conflict"):
        await env.engine.revise(
            row["id"], "tenant-a", RevisionRequest(expected_version=1, rfq=changed.rfq)
        )
    changed.rfq.rfq_version = 2
    revised = await env.engine.revise(
        row["id"], "tenant-a", RevisionRequest(expected_version=1, rfq=changed.rfq)
    )
    assert revised["rfq"]["rfq_version"] == 2


def test_rental_api_authentication_and_tenant_isolation(rental_env):
    env = rental_env
    client = TestClient(create_app(env.service.settings, env.service))
    path = "/v1/rentals"
    assert client.get(path).status_code == 401
    headers = {"Authorization": "Bearer " + "a" * 32, "Idempotency-Key": "api"}
    response = client.post(path, headers=headers, json=env.request.model_dump(mode="json"))
    assert response.status_code == 200, response.text
    rental_id = response.json()["rental"]["id"]
    assert (
        client.get(
            path + "/" + rental_id, headers={"Authorization": "Bearer " + "b" * 32}
        ).status_code
        == 404
    )
    assert (
        client.get(
            path, headers={"Authorization": "Bearer " + "a" * 32, "X-SpotBot-Tenant": "tenant-b"}
        ).status_code
        == 403
    )
    response = client.get(path + "/" + rental_id + "/generations", headers=headers)
    assert "agent_token" not in response.text


def test_unsupported_rfq_rules_are_rejected(rental_env):
    env = rental_env
    for field, value in [
        ("server_count", 2),
        ("market", "on_demand"),
        ("price_unit", "gpu_hour"),
        ("providers", ["lambda"]),
    ]:
        data = env.request.model_dump(mode="json")
        data["rfq"][field] = value
        with pytest.raises(ValidationError):
            RentalRequest.model_validate(data)


async def test_budget_reserve_prevents_unaffordable_purchase(rental_env):
    env = rental_env
    env.request.rfq.budget_usd = Decimal("0.001")
    row, _ = env.engine.create(env.request, "tenant-a", "budget")
    await cycle(env)
    assert not env.cloud.creates
    assert env.engine.get(row["id"], "tenant-a")["error"] == "insufficient_budget_reserve"


async def test_stale_gateway_ack_cannot_switch_new_generation(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "ack")
    await cycle(env)
    with pytest.raises(ValueError, match="stale_generation"):
        await env.engine.gateway_ack(
            row["id"], "tenant-a", GatewayAck(generation=99, accepted=True)
        )


async def test_worker_restart_continues_from_database(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "restart")
    await cycle(env)
    env.engine = RentalEngine(env.service, env.cloud)
    env.service.rentals = env.engine
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE" and len(env.cloud.creates) == 1


async def test_no_warning_termination_recovers_latest_files(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "no-warning")
    row = await deliver(env, row["id"])
    gen = env.engine.current(row)
    for v in gen["volumes"]:
        env.cloud.files[v["volume_id"]]["recent"] = "written-after-periodic-backup"
    await env.cloud.terminate(gen)
    await cycle(env, 9)
    env.clock.advance(31)
    row = await deliver(env, row["id"])
    assert row["generation"] == 2
    assert all(
        env.cloud.files[v["volume_id"]]["recent"] == "written-after-periodic-backup"
        for v in env.engine.current(row)["volumes"]
    )


async def test_closed_rental_keeps_only_its_final_snapshot(rental_env):
    """Ending deletes the disks as soon as the final snapshot is available; the snapshot is
    kept for the retention period."""
    env = rental_env
    env.request.rfq.backup.final_retention_seconds = 604800
    row, _ = env.engine.create(env.request, "tenant-a", "close-keeps-snapshot")
    row = await deliver(env, row["id"])
    volumes = {v["volume_id"] for v in env.engine.current(row)["volumes"]}
    await env.engine.release(row["id"], "tenant-a")
    for _ in range(6):
        env.clock.advance(11)
        await cycle(env, 4)
        env.cloud.finish_shutdown()
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "CLOSED"
    final = next(b for b in env.engine.backups(row) if b["final"])
    assert final["state"] == "AVAILABLE" and env.cloud.images
    assert volumes <= set(env.cloud.deleted_volumes) and not env.cloud.deleted_snapshots
    env.clock.advance(604801)
    await cycle(env, 2)
    assert env.engine.backups(row)[0]["state"] == "DELETED" and env.cloud.deleted_snapshots


async def test_closed_rental_without_a_final_snapshot_keeps_its_disks(rental_env):
    env = rental_env
    env.request.rfq.backup.final_retention_seconds = 604800
    row, _ = env.engine.create(env.request, "tenant-a", "close-without-snapshot")
    row = await deliver(env, row["id"])
    env.cloud.snapshot_error = ProviderError("aws_AccessDenied")
    await env.engine.release(row["id"], "tenant-a")
    for _ in range(6):
        env.clock.advance(11)
        await cycle(env, 4)
        env.cloud.finish_shutdown()
    assert not env.cloud.deleted_volumes


async def test_failed_final_backup_preserves_source_disks(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "failed-backup")
    row = await deliver(env, row["id"])
    env.cloud.snapshot_error = ProviderError("aws_AccessDenied")
    await env.engine.recover(row["id"], "tenant-a")
    env.clock.advance(11)
    await cycle(env, 8)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTION_REQUIRED"
    assert row["error"] == "final_backup_unavailable"
    assert not env.cloud.deleted_volumes and len(env.cloud.creates) == 1


async def test_cross_region_restore_requires_allowed_policy_and_image_copy(rental_env):
    env = rental_env
    env.request.rfq.regions = ["us-west-2", "us-east-1"]
    env.request.rfq.allow_cross_region = True
    row, _ = env.engine.create(env.request, "tenant-a", "cross-region")
    row = await deliver(env, row["id"])
    await env.engine.recover(row["id"], "tenant-a")
    env.clock.advance(11)
    await cycle(env, 8)
    offer = copy.deepcopy(env.offer)
    offer.region, offer.availability_zone = "us-east-1", "us-east-1a"
    env.service.store.record_collection("aws", [offer])
    env.clock.advance(31)
    row = await deliver(env, row["id"])
    assert env.engine.current(row)["region"] == "us-east-1"
    assert env.engine.current(row)["image_id"].startswith("ami-copy-")


def test_agent_validation_does_not_echo_secret(rental_env):
    env = rental_env
    client = TestClient(create_app(env.service.settings, env.service))
    secret = "sensitive-agent-secret"
    response = client.post("/v1/agents/report", json={"token": secret, "generation": -1})
    assert response.status_code == 422 and secret not in response.text


async def test_recovery_deadline_halts_new_acquisitions_but_preserves_disks(rental_env):
    env = rental_env
    env.request.rfq.max_recovery_seconds = 30
    row, _ = env.engine.create(env.request, "tenant-a", "recovery-deadline")
    row = await deliver(env, row["id"])
    await env.engine.recover(row["id"], "tenant-a")
    env.clock.advance(31)
    await cycle(env, 15)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTION_REQUIRED" and row["recovery_halted"]
    assert len(env.cloud.creates) == 1 and not env.cloud.deleted_volumes


async def test_queue_failure_does_not_block_expiry(rental_env, monkeypatch):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "broken-queue")

    async def broken_queue():
        raise OSError("queue unavailable")

    monkeypatch.setattr(env.engine, "poll_interruptions", broken_queue)
    env.clock.advance(7201)
    await cycle(env)
    assert env.engine.get(row["id"], "tenant-a")["state"] == "CLOSED"
    assert not env.cloud.creates


async def test_manual_backup_idempotency_is_stable_across_generations(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "backup-replay")
    row = await deliver(env, row["id"])
    backup = env.engine.request_backup(row, "manual-request", manual=True)
    await cycle(env, 5)
    await env.engine.recover(row["id"], "tenant-a")
    env.clock.advance(11)
    await cycle(env, 8)
    env.clock.advance(31)
    row = await deliver(env, row["id"])
    replay = env.engine.request_backup(row, "manual-request", manual=True)
    assert replay["id"] == backup["id"] and replay["generation"] == 1


def event_types(env, rental_id):
    return [e["payload"]["type"] for e in env.service.store.events(order_id=rental_id, limit=1000)]


async def serve(env, rental_id, minutes):
    for _ in range(minutes * 4):
        env.clock.advance(15)
        await report_ready(env, rental_id)
    await cycle(env)


async def test_heartbeat_gap_keeps_a_verified_server_serving(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "heartbeat")
    row = await deliver(env, row["id"])
    await serve(env, row["id"], 30)
    connection = env.engine.get(row["id"], "tenant-a")["connection"]
    # Control-plane or callback outage: ten minutes without reports from a healthy server.
    for _ in range(40):
        env.clock.advance(15)
        await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    gen = env.engine.current(row)
    assert (row["state"], row["degraded"], row["error"]) == (
        "ACTIVE",
        "guest_heartbeat_lost",
        "guest_heartbeat_lost",
    )
    assert row["connection"] == connection and not row["end_requested"]
    assert env.cloud.instances[gen["id"]]["State"]["Name"] == "running"
    assert len(env.cloud.creates) == 1
    assert event_types(env, row["id"]).count("rental.degraded") == 1
    # Reports resume: the same generation stays active without a new handoff.
    handoffs = event_types(env, row["id"]).count("rental.handoff")
    await serve(env, row["id"], 1)
    row = env.engine.get(row["id"], "tenant-a")
    assert (row["state"], row["degraded"], row["error"]) == ("ACTIVE", None, None)
    assert row["connection"] == connection
    assert event_types(env, row["id"]).count("rental.healthy") == 1
    assert event_types(env, row["id"]).count("rental.handoff") == handoffs


async def test_failed_self_check_does_not_end_a_verified_rental(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "self-check")
    row = await deliver(env, row["id"])
    await serve(env, row["id"], 30)
    gen = env.engine.current(env.engine.get(row["id"], "tenant-a"))
    # nvidia-smi timed out under load, so the report carries no GPU fields.
    await env.engine.agent_report(
        AgentReport(
            rental_id=row["id"],
            generation=gen["generation"],
            instance_id=gen["instance_id"],
            token=gen["agent_token"],
            ssh_ready=True,
            volume_ids=[v["volume_id"] for v in gen["volumes"]],
            mounts=gen["mounts"],
        )
    )
    await cycle(env, 3)
    row = env.engine.get(row["id"], "tenant-a")
    assert (row["state"], row["error"], row["end_requested"]) == (
        "ACTIVE",
        "guest_check_failed",
        False,
    )
    # The partial report did not erase the canaries later backups need for restore checks.
    assert all(env.engine.current(row)["canaries"].values())
    await serve(env, row["id"], 1)
    assert env.engine.get(row["id"], "tenant-a")["error"] is None


async def test_unverified_generation_still_recovers_after_boot_timeout(rental_env):
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "silent-boot")
    await cycle(env, 2)
    assert env.engine.current(env.engine.get(row["id"], "tenant-a"))["instance_id"]
    env.clock.advance(env.service.settings.spotbot_rental_boot_timeout_seconds + 1)
    await cycle(env)
    row = env.engine.get(row["id"], "tenant-a")
    assert (row["state"], row["error"]) == ("RECOVERING", "guest_boot_timeout")


async def test_rejected_snapshot_and_image_requests_are_retried(rental_env):
    env = rental_env
    start, register = env.cloud.start_snapshots, env.cloud.register_image
    calls = {"snapshots": 0, "images": 0}

    async def throttled_snapshots(backup, gen, volume=None):
        calls["snapshots"] += 1
        if calls["snapshots"] == 1:
            # AWS rejected the request outright: no snapshot exists.
            raise ProviderError("aws_RequestLimitExceeded", retryable=True)
        return await start(backup, gen, volume)

    async def throttled_registration(backup, gen, snapshots):
        calls["images"] += 1
        if calls["images"] == 1:
            raise ProviderError("aws_RequestLimitExceeded", retryable=True)
        return await register(backup, gen, snapshots)

    env.cloud.start_snapshots = throttled_snapshots
    env.cloud.register_image = throttled_registration
    row, _ = env.engine.create(env.request, "tenant-a", "throttled")
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE"
    (backup,) = env.engine.backups(row)
    # One rejected request each, retried automatically: no operator reconciliation.
    assert (backup["state"], backup["error"]) == ("AVAILABLE", None)
    assert calls == {"snapshots": 2, "images": 2}
    assert len(env.cloud.snapshot_sets[backup["id"]]) == len(backup["volumes"])


async def test_retention_of_the_initial_backup_keeps_a_delivered_rental_active(rental_env):
    """Routine backups retire the initial one after `keep` newer points; the rental stays up."""
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "long-running")
    row = await deliver(env, row["id"])
    initial = next(b for b in env.engine.backups(row) if b["state"] == "AVAILABLE")
    for _ in range(12):
        env.clock.advance(901)
        await report_ready(env, row["id"])
        await cycle(env, 3)
        await report_ready(env, row["id"])
        await cycle(env, 3)
        if env.engine.db.get("backup", initial["id"])["state"] == "DELETED":
            break
    assert env.engine.db.get("backup", initial["id"])["state"] == "DELETED"
    await report_ready(env, row["id"])
    await cycle(env, 3)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTIVE" and row["error"] is None and row["connection"]


def test_service_intervals_follow_delivery_replacement_and_end(monkeypatch):
    from spotbot import rentals as module

    clock = [datetime.fromisoformat("2026-10-29T00:10:00+00:00")]
    monkeypatch.setattr(module, "utcnow", lambda: clock[0])
    row = dict(
        state="PROVISIONING",
        end_requested=False,
        rfq=dict(
            acquisition_deadline="2026-10-29T01:00:00+00:00",
            expires_at="2026-10-29T03:00:00+00:00",
            service_seconds=7200,
        ),
    )

    def step(minutes, **changes):
        clock[0] += timedelta(minutes=minutes)
        row.update(changes)
        module.track_service(row)

    step(0)
    assert row["service_intervals"] == [] and "service_started_at" not in row
    # Handed over 15 minutes in: the two paid hours start now, not at the deadline.
    step(5, state="DELIVERING")
    assert row["rfq"]["expires_at"] == "2026-10-29T02:15:00+00:00"
    step(1, state="ACTIVE")
    step(30, state="RECOVERING")  # A Spot interruption pauses the service.
    step(10, state="DELIVERING")
    step(1, state="ACTIVE")
    step(20, state="ENDING", end_requested=True)
    step(5, state="CLOSED")
    assert row["rfq"]["expires_at"] == "2026-10-29T02:15:00+00:00"  # Set once.
    assert module.service_seconds(row) == 50 * 60
    assert [p["end_reason"] for p in row["service_intervals"]] == ["interrupted", "ended"]


def test_service_window_never_extends_the_requested_expiry(monkeypatch):
    from spotbot import rentals as module

    monkeypatch.setattr(
        module, "utcnow", lambda: datetime.fromisoformat("2026-10-29T01:05:00+00:00")
    )
    row = dict(
        state="ACTIVE",
        end_requested=False,
        rfq=dict(
            acquisition_deadline="2026-10-29T01:00:00+00:00",
            expires_at="2026-10-29T02:00:00+00:00",
            service_seconds=3600,
        ),
    )
    module.track_service(row)
    # Launched just before the deadline and delivered after it: capped at the request.
    assert row["rfq"]["expires_at"] == "2026-10-29T02:00:00+00:00"
    assert row["service_intervals"][0]["end"] is None


async def test_closed_rentals_are_stepped_at_the_cleanup_cadence(rental_env):
    """Closed rentals only have retention cleanup left: one step per interval, not per tick."""
    env = rental_env
    row, _ = env.engine.create(env.request, "tenant-a", "closed-cadence")
    row = await deliver(env, row["id"])
    await env.engine.release(row["id"], "tenant-a")
    for _ in range(6):
        env.clock.advance(11)
        await cycle(env, 4)
        env.cloud.finish_shutdown()
    assert env.engine.get(row["id"], "tenant-a")["state"] == "CLOSED"
    steps = []
    original = env.engine._step

    async def counted(value):
        steps.append(value["id"])
        return await original(value)

    env.engine._step = counted
    await cycle(env, 5)
    first = steps.count(row["id"])
    assert first <= 1
    env.clock.advance(CLOSED_RENTAL_SECONDS + 1)
    await cycle(env, 3)
    assert steps.count(row["id"]) == first + 1
