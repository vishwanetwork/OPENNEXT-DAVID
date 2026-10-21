"""RFQ-driven server lifetimes, recoverable disk sets, and durable replacement decisions."""

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid4, uuid5

from spotbot.models import gpu_model, timestamp, utcnow
from spotbot.providers import ProviderError
from spotbot.rental_aws import AWSRecovery, initial_image
from spotbot.rental_models import RFQ
from spotbot.storage.common import dump
from spotbot.storage.workflows import ConflictError, WorkflowStore

# The guest reports every 15s and flushes on its next report; allow two cycles before
# capturing without a confirmed flush. Routine captures are not on the recovery path.
BACKUP_FLUSH_WAIT_SECONDS = 30

logger = logging.getLogger(__name__)


def identity(*parts):
    return str(uuid5(NAMESPACE_URL, dump(list(parts))))


def at(value):
    return datetime.fromisoformat(value)


def document(kind, tenant_id, **values):
    return dict(
        id=str(uuid4()), kind=kind, tenant_id=tenant_id, created_at=timestamp(), version=0, **values
    )


class RentalEngine:
    def __init__(self, service, backend=None):
        self.service = service
        self.settings = service.settings
        self.db = WorkflowStore(service.store)
        self.backend = backend or AWSRecovery(
            service.providers["aws"], service.settings, guard=service.store.ensure_ownership
        )
        self.lock = asyncio.Lock()
        self.row_locks = {}

    def row_lock(self, rental_id):
        return self.row_locks.setdefault(rental_id, asyncio.Lock())

    def save(self, doc, event=None):
        return self.db.save(doc, doc["version"], event=event)

    def get(self, rental_id, tenant_id):
        value = self.db.get("rental", rental_id)
        if not value or value["tenant_id"] != tenant_id:
            raise LookupError("rental_not_found")
        return value

    def unmonitored_regions(self, rules):
        # Polling is only a fallback; never buy where interruption warnings cannot arrive.
        queues = json.loads(self.settings.spotbot_rental_interruption_queues)
        return sorted(set(rules.regions) - set(queues))

    def validate_rules(self, rules):
        if not self.settings.spotbot_rentals_enabled:
            raise ValueError("rentals_disabled")
        if not self.settings.spotbot_live_orders_enabled:
            raise ValueError("live_orders_disabled")
        if set(rules.regions) - set(self.settings.aws_order_regions):
            raise ValueError("region_not_enabled_for_orders")
        if set(rules.regions) - set(self.settings.rental_regions):
            raise ValueError("region_not_enabled_for_rentals")
        if self.unmonitored_regions(rules):
            raise ValueError("interruption_queue_not_configured")
        if not self.settings.enabled("aws") or not self.service.providers["aws"].configured:
            raise ValueError("missing_aws_credentials")
        if not self.settings.spotbot_rental_public_url:
            raise ValueError("guest_callback_url_required")
        if rules.expires_at <= utcnow():
            raise ValueError("rental_expired")

    def create(self, request, tenant_id, key):
        rules = request.rfq
        payload = request.model_dump(mode="json")
        # Preserve idempotency fingerprints accepted before this optional field existed.
        if not payload["rfq"]["initial_image_ids"]:
            payload["rfq"].pop("initial_image_ids")
        fingerprint = hashlib.sha256(dump(payload).encode()).hexdigest()
        rental_id = identity("rental", tenant_id, key)
        existing = self.db.get("rental", rental_id)
        if existing:
            if existing["fingerprint"] != fingerprint:
                raise ValueError("idempotency_key_conflict")
            return existing, False
        self.validate_rules(rules)
        if rules.acquisition_deadline <= utcnow():
            raise ValueError("acquisition_deadline_expired")
        row = document(
            "rental",
            tenant_id,
            rfq=rules.model_dump(mode="json"),
            fingerprint=fingerprint,
            state="QUEUED",
            generation=0,
            current_generation_id=None,
            current_backup_id=None,
            connection=None,
            attempts=0,
            next_attempt_at=timestamp(),
            error=None,
            estimated_cost_usd="0",
            end_requested=False,
            recovery_started_at=None,
        )
        row["id"] = rental_id
        try:
            self.save(row, "accepted")
        except ConflictError:
            return self.create(request, tenant_id, key)
        return row, True

    async def revise(self, rental_id, tenant_id, request, *, renewal=False):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["end_requested"] or row["state"] == "CLOSED":
                raise ValueError("rental_ending")
            old, rules = RFQ.model_validate(row["rfq"]), request.rfq
            if request.expected_version != old.rfq_version or rules.rfq_version <= old.rfq_version:
                raise ValueError("rfq_version_conflict")
            if (rules.rfq_id, rules.upstream_order_id) != (old.rfq_id, old.upstream_order_id):
                raise ValueError("rfq_identity_mismatch")
            # Live disks and software cannot be resized or reinterpreted by a policy edit.
            immutable = [
                "gpu_model",
                "gpu_count",
                "min_gpu_memory_gib",
                "min_vcpus",
                "min_memory_gib",
                "architecture",
                "initial_image_ids",
                "root_volume_gib",
                "data_disks",
                "ssh_key_name",
                "ssh_user",
                "http_port",
                "http_health_path",
                "account",
                "market",
            ]
            a, b = old.model_dump(), rules.model_dump()
            if any(a[k] != b[k] for k in immutable):
                raise ValueError("hardware_change_requires_new_rental")
            if renewal and rules.expires_at <= old.expires_at:
                raise ValueError("renewal_must_extend_expiry")
            self.validate_rules(rules)
            gen = self.current(row)
            needs_move = (
                gen
                and gen.get("instance_id")
                and (
                    gen["region"] not in rules.regions
                    or Decimal(gen["price_ceiling"]) > rules.max_price_hourly
                    or (rules.instance_types and gen["offer"]["sku"] not in rules.instance_types)
                )
            )
            if needs_move and gen["region"] not in rules.regions and not rules.allow_cross_region:
                raise ValueError("region_change_requires_cross_region_recovery")
            row.update(rfq=rules.model_dump(mode="json"), error=None)
            if needs_move and row["state"] in {"ACTIVE", "VERIFYING", "DELIVERING"}:
                row.update(
                    state="RECOVERING",
                    connection=None,
                    recovery_started_at=timestamp(),
                    current_backup_id=None,
                    flush_command=str(uuid4()),
                    flush_requested_at=timestamp(),
                )
            self.save(row, "policy_updated")
            return row

    async def release(self, rental_id, tenant_id):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["state"] != "CLOSED" and not row["end_requested"]:
                row.update(
                    end_requested=True,
                    state="ENDING",
                    connection=None,
                    error=None,
                    flush_command=str(uuid4()),
                    flush_requested_at=timestamp(),
                )
                self.save(row, "ending")
            return row

    def generations(self, row):
        return sorted(
            [
                g
                for g in self.db.list("generation", row["tenant_id"])
                if g["rental_id"] == row["id"]
            ],
            key=lambda g: g["generation"],
        )

    def backups(self, row):
        return sorted(
            [b for b in self.db.list("backup", row["tenant_id"]) if b["rental_id"] == row["id"]],
            key=lambda b: b["created_at"],
            reverse=True,
        )

    def current(self, row):
        return (
            self.db.get("generation", row["current_generation_id"])
            if row["current_generation_id"]
            else None
        )

    def request_backup(self, row, key, *, final=False, manual=False):
        gen = self.current(row)
        if not gen or not gen.get("volumes"):
            raise ValueError("disk_inventory_not_ready")
        backup_id = (
            identity("manual-backup", row["id"], key)
            if manual
            else identity("backup", row["id"], gen["id"], key)
        )
        old = self.db.get("backup", backup_id)
        if old:
            return old
        if any(
            b["state"] in {"REQUESTED", "CAPTURING", "PENDING", "REGISTERING", "IMAGE_PENDING"}
            for b in self.backups(row)
        ):
            raise ValueError("backup_already_running")
        value = document(
            "backup",
            row["tenant_id"],
            rental_id=row["id"],
            generation=gen["generation"],
            generation_id=gen["id"],
            region=gen["region"],
            state="REQUESTED",
            volumes=gen["volumes"],
            snapshots={},
            images={},
            image_id=None,
            capture_at=None,
            final=final,
            error=None,
            canaries=gen.get("canaries", {}),
            mounts=gen.get("mounts", []),
            consistency="crash_consistent",
        )
        value["id"] = backup_id
        try:
            self.save(value, "backup_requested")
        except ConflictError:
            return self.db.get("backup", backup_id)
        return value

    async def recover(self, rental_id, tenant_id, backup_id=None):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["end_requested"] or RFQ.model_validate(row["rfq"]).expires_at <= utcnow():
                raise ValueError("rental_ending")
            if backup_id:
                backup = self.db.get("backup", backup_id)
                if not backup or backup["rental_id"] != row["id"] or backup["state"] != "AVAILABLE":
                    raise ValueError("backup_not_available")
                if not RFQ.model_validate(row["rfq"]).allow_older_backup:
                    raise ValueError("older_backup_not_authorized")
            if row["state"] not in {"ACTIVE", "VERIFYING", "DELIVERING", "ACTION_REQUIRED"}:
                if row["state"] == "RECOVERING":
                    return row
                raise ValueError("recovery_not_allowed_in_current_state")
            row.update(
                state="RECOVERING",
                connection=None,
                recovery_started_at=timestamp(),
                current_backup_id=backup_id,
                error=None,
                flush_command=str(uuid4()),
                flush_requested_at=timestamp(),
                recovery_halted=False,
            )
            self.save(row, "recovering")
            return row

    async def gateway_ack(self, rental_id, tenant_id, ack):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["generation"] != ack.generation:
                raise ValueError("stale_generation")
            if row["state"] == "ACTIVE" and ack.accepted:
                return row
            if row["state"] != "DELIVERING" or row["end_requested"]:
                raise ValueError("handoff_not_pending")
            if RFQ.model_validate(row["rfq"]).expires_at <= utcnow():
                raise ValueError("rental_expired")
            if row.get("recovery_started_at") and utcnow() >= at(
                row["recovery_started_at"]
            ) + timedelta(seconds=RFQ.model_validate(row["rfq"]).max_recovery_seconds):
                raise ValueError("recovery_deadline_expired")
            row.update(
                state="ACTIVE" if ack.accepted else "ENDING",
                end_requested=not ack.accepted,
                error=None if ack.accepted else "gateway_rejected",
            )
            if ack.accepted:
                row["recovery_started_at"] = None
            self.save(row, "active" if ack.accepted else "ending")
            return row

    async def agent_report(self, report):
        async with self.row_lock(report.rental_id):
            row = self.db.get("rental", report.rental_id)
            gen = self.current(row) if row else None
            if (
                not gen
                or gen["generation"] != report.generation
                or gen.get("instance_id") != report.instance_id
            ):
                raise PermissionError("invalid_agent_identity")
            if gen["state"] in {"STOPPED", "REJECTED"} or row["state"] == "CLOSED":
                raise PermissionError("agent_generation_ended")
            if not hmac.compare_digest(gen["agent_token"], report.token.get_secret_value()):
                raise PermissionError("invalid_agent_token")
            gen.update(
                report=report.model_dump(mode="json", exclude={"token"}), heartbeat_at=timestamp()
            )
            self.save(gen)
            if report.interruption and row["state"] in {"ACTIVE", "VERIFYING", "DELIVERING"}:
                row.update(
                    state="RECOVERING",
                    connection=None,
                    recovery_started_at=timestamp(),
                    current_backup_id=None,
                    error="spot_interruption",
                    flush_command=str(uuid4()),
                    flush_requested_at=timestamp(),
                )
                self.save(row, "recovering")
            pending = next(
                (
                    b["flush_command"]
                    for b in self.backups(row)
                    if b["state"] == "REQUESTED"
                    and b["generation_id"] == gen["id"]
                    and b.get("flush_command")
                ),
                None,
            )
            command = row.get("flush_command")
            if not command or command == report.flushed_command:
                # A stop/recovery flush comes first; once acknowledged, serve the backup flush.
                command = pending or command
            return dict(
                flush_command=command,
                create_canaries=not gen.get("source_backup_id") and not gen.get("verified_at"),
                initialize_disks=[
                    v
                    for v in gen.get("volumes", [])
                    if v["device"] != gen.get("image_metadata", {}).get("RootDeviceName")
                ]
                if not gen.get("source_backup_id") and not gen.get("verified_at")
                else [],
            )

    async def reconcile(self, rental_id, tenant_id, *, confirm_absent=False):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            gen = self.current(row)
            if not gen or gen["state"] not in {"SUBMITTING", "NEEDS_RECONCILIATION"}:
                raise ValueError("no_uncertain_acquisition")
            found = await self.backend.find_instance(gen)
            if found:
                gen.update(instance_id=found, state="BOOTING", started_at=gen["created_at"])
                row.update(state="ENDING" if row["end_requested"] else "PROVISIONING", error=None)
            elif confirm_absent:
                gen.update(state="REJECTED", error="operator_confirmed_absent")
                row.update(state="ENDING" if row["end_requested"] else "QUEUED", error=None)
            else:
                raise ValueError("creation_outcome_still_uncertain")
            self.save(gen)
            self.save(row, "reconciled")
            return row

    async def reconcile_backup(self, rental_id, tenant_id, backup_id, *, confirm_absent=False):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            backup = self.db.get("backup", backup_id)
            if not backup or backup["rental_id"] != row["id"]:
                raise LookupError("backup_not_found")
            if backup["state"] != "NEEDS_RECONCILIATION":
                raise ValueError("backup_not_uncertain")
            image_id = await self.backend.find_image(backup)
            found = await self.backend.snapshots(backup)
            required = {v["volume_id"] for v in backup["volumes"]}
            if image_id:
                backup.update(
                    state="IMAGE_PENDING",
                    image_id=image_id,
                    images={**backup["images"], backup["region"]: image_id},
                    error=None,
                )
            elif {s["VolumeId"] for s in found} == required and len(found) == len(required):
                backup.update(
                    state="PENDING",
                    snapshots={s["VolumeId"]: s["SnapshotId"] for s in found},
                    error=None,
                )
            elif confirm_absent:
                backup.update(state="CAPTURING", error=None)
                backup.pop("capture_inflight", None)
            else:
                raise ValueError("backup_outcome_still_uncertain")
            self.save(backup, "backup_reconciled")
            if row["state"] == "ACTION_REQUIRED" and row["error"] in {
                "initial_backup_unavailable",
                "final_backup_unavailable",
            }:
                row.update(
                    state="ENDING"
                    if row["end_requested"]
                    else "RECOVERING"
                    if backup["final"]
                    else "VERIFYING",
                    error=None,
                )
                self.save(row, "reconciled")
            return backup

    def candidates(self, rules, *, region=None):
        values = []
        now = utcnow()
        for offer in self.service.store.latest(
            provider="aws", market="spot", gpu_model=rules.gpu_model
        ):
            d = offer.details
            memory = [
                g.get("MemoryInfo", {}).get("SizeInMiB", 0) for g in d.get("gpu_specifications", [])
            ]
            if (
                offer.orderable
                and offer.region in rules.regions
                and offer.region in self.settings.aws_order_regions
                and (not region or offer.region == region)
                and offer.gpu_count == rules.gpu_count
                and offer.vcpus >= rules.min_vcpus
                and offer.memory_gb >= rules.min_memory_gib
                and d.get("architecture") == rules.architecture
                and memory
                and min(memory) >= rules.min_gpu_memory_gib * 1024
                and offer.price_hourly <= rules.max_price_hourly
                and (not rules.instance_types or offer.sku in rules.instance_types)
                and (now - at(offer.observed_at)).total_seconds()
                <= self.settings.spotbot_price_max_age_seconds
                and d.get("quota_sufficient")
                and d.get("subnet_id")
                and d.get("security_group_ids")
            ):
                values.append(offer)
        return sorted(
            values,
            key=lambda o: (
                rules.regions.index(o.region) if rules.selection == "region_order" else 0,
                o.price_hourly,
                o.region,
                o.availability_zone or "",
            ),
        )

    async def tick(self):
        if not self.settings.spotbot_rentals_enabled or self.lock.locked():
            return
        async with self.lock:
            self.service.store.ensure_ownership()
            try:
                await self.poll_interruptions()
                self.event_consumer_error = None
            except Exception as exc:
                self.event_consumer_error = type(exc).__name__
                logger.warning("Interruption queue polling failed; continuing lifecycle checks")
            for entry in self.db.list("rental"):
                async with self.row_lock(entry["id"]):
                    row = self.db.get("rental", entry["id"])
                    try:
                        await self._step(row)
                    except ConflictError:
                        continue
                    except ProviderError as exc:
                        row = self.db.get("rental", entry["id"])
                        row["error"] = exc.code
                        self.save(row, "operation_failed")
                    except Exception as exc:
                        logger.warning(
                            "Rental cycle failed for %s: %s", entry["id"], type(exc).__name__
                        )

    async def poll_interruptions(self):
        for region, url in json.loads(self.settings.spotbot_rental_interruption_queues).items():
            provider = self.backend.provider
            client = provider._client(region, "sqs")
            response = await provider._execute(
                lambda c=client, u=url: c.receive_message(
                    QueueUrl=u, MaxNumberOfMessages=10, WaitTimeSeconds=0
                )
            )
            for message in response.get("Messages", []):
                try:
                    event = json.loads(message["Body"])
                    await self.handle_interruption(event)
                except (ValueError, KeyError, TypeError):
                    # Let queue redrive policy move invalid messages into the DLQ.
                    logger.warning("Invalid interruption message; leaving it for queue redrive")
                    continue
                await provider._execute(
                    lambda c=client, m=message, u=url: c.delete_message(
                        QueueUrl=u, ReceiptHandle=m["ReceiptHandle"]
                    )
                )

    async def handle_interruption(self, event):
        if event.get("source") != "aws.ec2" or event.get("detail-type") not in {
            "EC2 Spot Instance Interruption Warning",
            "EC2 Instance State-change Notification",
        }:
            raise ValueError("unsupported_interruption_event")
        detail = event["detail"]
        if event["detail-type"] == "EC2 Instance State-change Notification" and detail.get(
            "state"
        ) not in {"terminated", "stopped", "shutting-down"}:
            return
        for entry in self.db.list("rental"):
            gen = self.current(entry)
            if (
                not gen
                or gen.get("instance_id") != detail["instance-id"]
                or gen["region"] != event["region"]
            ):
                continue
            async with self.row_lock(entry["id"]):
                row = self.db.get("rental", entry["id"])
                if row["end_requested"] or row["state"] not in {
                    "ACTIVE",
                    "PROVISIONING",
                    "VERIFYING",
                    "DELIVERING",
                }:
                    return
                row.update(
                    state="RECOVERING",
                    connection=None,
                    recovery_started_at=timestamp(),
                    current_backup_id=None,
                    error="spot_interruption",
                    flush_command=str(uuid4()),
                    flush_requested_at=timestamp(),
                )
                self.save(row, "recovering")
            return

    def cost(self, row):
        now, result = utcnow(), Decimal(0)
        for gen in self.generations(row):
            if gen.get("started_at") or (
                gen["id"] == row["current_generation_id"]
                and gen["state"] in {"SUBMITTING", "NEEDS_RECONCILIATION"}
            ):
                seconds = max(
                    0,
                    (
                        at(gen.get("ended_at") or now.isoformat())
                        - at(gen.get("started_at") or gen["created_at"])
                    ).total_seconds(),
                )
                result += Decimal(gen["price_ceiling"]) * Decimal(str(seconds)) / 3600
            for volume in gen.get("volumes", []):
                end = at(
                    gen.get("deleted_volume_times", {}).get(volume["volume_id"], now.isoformat())
                )
                seconds = max(0, (end - at(gen["created_at"])).total_seconds())
                result += (
                    Decimal(volume["size_gib"])
                    * self.settings.spotbot_rental_storage_reserve_usd_gib_month
                    * Decimal(str(seconds))
                    / Decimal(2592000)
                )
        for backup in self.backups(row):
            end = at(backup.get("deleted_at", now.isoformat()))
            seconds = max(0, (end - at(backup["created_at"])).total_seconds())
            result += (
                Decimal(sum(v["size_gib"] for v in backup["volumes"]))
                * max(1, len(backup["images"]))
                * self.settings.spotbot_rental_storage_reserve_usd_gib_month
                * Decimal(str(seconds))
                / Decimal(2592000)
            )
        return result.quantize(Decimal("0.000001"))

    async def _step(self, row):
        rules = RFQ.model_validate(row["rfq"])
        if row["state"] == "CLOSED":
            row["estimated_cost_usd"] = str(self.cost(row))
            self.save(row)
            await self._cleanup(row, final=True)
            return
        estimate = self.cost(row)
        row["estimated_cost_usd"] = str(estimate)
        self.save(row)
        if rules.expires_at <= utcnow() or estimate >= rules.budget_usd or row["end_requested"]:
            if row["state"] != "ENDING":
                row.update(
                    state="ENDING",
                    end_requested=True,
                    connection=None,
                    flush_command=str(uuid4()),
                    flush_requested_at=timestamp(),
                    error="budget_limit_reached" if estimate >= rules.budget_usd else row["error"],
                )
                self.save(row, "ending")
        for backup in self.backups(row):
            if backup["state"] in {
                "REQUESTED",
                "CAPTURING",
                "PENDING",
                "REGISTERING",
                "IMAGE_PENDING",
            }:
                await self._backup_step(backup)
        gen = self.current(row)
        if gen and gen["state"] in {"SUBMITTING", "NEEDS_RECONCILIATION"}:
            instance_id = await self.backend.find_instance(gen)
            if instance_id:
                gen.update(instance_id=instance_id, state="BOOTING", started_at=gen["created_at"])
                self.save(gen)
                if row["state"] != "ENDING":
                    row.update(state="PROVISIONING", error=None)
                    self.save(row, "reconciled")
            else:
                gen.update(state="NEEDS_RECONCILIATION")
                self.save(gen)
                if row["state"] != "ENDING":
                    row.update(state="NEEDS_RECONCILIATION", error="creation_outcome_uncertain")
                    self.save(row, "needs_reconciliation")
                return
        if (
            row.get("recovery_started_at")
            and not row["end_requested"]
            and utcnow()
            >= at(row["recovery_started_at"]) + timedelta(seconds=rules.max_recovery_seconds)
        ):
            if not row.get("recovery_halted"):
                row.update(
                    recovery_halted=True,
                    error="recovery_wait_limit_reached",
                    connection=None,
                    state="RECOVERING"
                    if gen and gen.get("instance_id") and gen["state"] != "STOPPED"
                    else "ACTION_REQUIRED",
                )
                self.save(row, "action_required")
        if row["state"] == "ENDING":
            await self._end_or_recover(row, gen, rules, ending=True)
        elif row["state"] == "RECOVERING":
            await self._end_or_recover(row, gen, rules, ending=False)
        elif row["state"] in {"QUEUED", "WAITING_CAPACITY"}:
            if rules.not_before and utcnow() < rules.not_before:
                return
            await self._acquire(row, rules)
        elif row["state"] in {"PROVISIONING", "VERIFYING", "DELIVERING", "ACTIVE"}:
            await self._monitor(row, gen, rules)
        await self._cleanup(row, final=False)

    async def _acquire(self, row, rules):
        now = utcnow()
        if set(rules.regions) - set(self.settings.rental_regions):
            row.update(state="ACTION_REQUIRED", error="region_not_enabled_for_rentals")
            self.save(row, "action_required")
            return
        if self.unmonitored_regions(rules):
            row.update(state="ACTION_REQUIRED", error="interruption_queue_not_configured")
            self.save(row, "action_required")
            return
        if not self.settings.spotbot_live_orders_enabled or not self.settings.enabled("aws"):
            row.update(state="ACTION_REQUIRED", error="live_orders_disabled")
            self.save(row, "action_required")
            return
        deadline = rules.acquisition_deadline
        source = (
            self.db.get("backup", row["current_backup_id"]) if row["current_backup_id"] else None
        )
        if row["recovery_started_at"]:
            deadline = min(
                rules.expires_at,
                at(row["recovery_started_at"]) + timedelta(seconds=rules.max_recovery_seconds),
            )
        if now >= deadline or row["attempts"] >= rules.max_attempts:
            row.update(
                state="ACTION_REQUIRED" if row["recovery_started_at"] else "ENDING",
                end_requested=not bool(row["recovery_started_at"]),
                error="acquisition_limit_reached",
            )
            self.save(row, "acquisition_failed")
            return
        if at(row["next_attempt_at"]) > now:
            return
        options = self.candidates(
            rules, region=source["region"] if source and not rules.allow_cross_region else None
        )
        if not options:
            row.update(
                state="WAITING_CAPACITY",
                error="no_eligible_offer",
                next_attempt_at=(now + timedelta(seconds=rules.retry_seconds)).isoformat(),
            )
            self.save(row, "waiting_capacity")
            return
        reserve = rules.max_price_hourly / 60 + Decimal(
            rules.root_volume_gib + sum(d.size_gib for d in rules.data_disks)
        ) * self.settings.spotbot_rental_storage_reserve_usd_gib_month * Decimal(
            rules.backup.final_retention_seconds
        ) / Decimal(2592000)
        if self.cost(row) + reserve >= rules.budget_usd:
            row.update(state="ENDING", end_requested=True, error="insufficient_budget_reserve")
            self.save(row, "ending")
            return
        # Sweep every eligible pool (instance type x zone) in one attempt, starting where the
        # last sweep stopped; capacity rejections return quickly and pools fail independently.
        start = row["attempts"] % len(options)
        sweep = {}  # Account quota and instance specs cannot change across rejected requests.
        tried = 0
        for offer in (options[start:] + options[:start])[: self.settings.spotbot_rental_pools_per_attempt]:
            if row["attempts"] >= rules.max_attempts or utcnow() >= deadline:
                break
            outcome = await self._launch_offer(row, rules, offer, source, sweep, first=not tried)
            tried += 1
            if outcome != "retry":
                return
        if tried:
            self.save(row, "acquisition_failed")

    async def _launch_offer(self, row, rules, offer, source, sweep, *, first):
        """Try one pool. Returns "launched", "retry" (try the next pool), or "stop"."""
        now = utcnow()
        image_id = initial_image(rules, self.settings, offer.region, offer.details["image_id"])
        if source:
            image_id = source["images"].get(offer.region)
            if not image_id:
                image_id = await self.backend.copy_image(source, offer.region)
                source["images"][offer.region] = image_id
                self.save(source)
            image = await self.backend.image(offer.region, image_id)
            if image["State"] != "available":
                row["error"] = "recovery_image_pending"
                self.save(row)
                return "stop"
        image = await self.backend.image(offer.region, image_id)
        metadata = {
            k: image[k]
            for k in ["Architecture", "RootDeviceName", "BootMode", "EnaSupport", "SriovNetSupport"]
            if k in image
        }
        gen = document(
            "generation",
            row["tenant_id"],
            rental_id=row["id"],
            generation=row["generation"] + 1,
            region=offer.region,
            state="SUBMITTING",
            image_id=image_id,
            image_metadata=metadata,
            offer=offer.model_dump(mode="json"),
            source_backup_id=source["id"] if source else None,
            instance_id=None,
            volumes=[],
            agent_token=secrets.token_urlsafe(32),
            price_ceiling=str(rules.max_price_hourly),
            report={},
            deleted_volumes=[],
        )
        self.save(gen)
        row.update(
            current_generation_id=gen["id"],
            generation=gen["generation"],
            attempts=row["attempts"] + 1,
            state="PROVISIONING",
            connection=None,
            next_attempt_at=(now + timedelta(seconds=rules.retry_seconds)).isoformat(),
        )
        # One provisioning event per sweep; intermediate pools would only flood the outbox.
        self.save(row, "provisioning" if first else None)
        try:
            gen["instance_id"] = await self.backend.launch(
                row, gen, offer, rules, source, sweep=sweep
            )
        except ProviderError as exc:
            gen.update(
                state="NEEDS_RECONCILIATION" if exc.ambiguous else "REJECTED", error=exc.code
            )
            self.save(gen)
            row.update(
                state="NEEDS_RECONCILIATION"
                if exc.ambiguous
                else "WAITING_CAPACITY"
                if exc.retryable
                else "ACTION_REQUIRED",
                error=exc.code,
            )
            if exc.retryable and not exc.ambiguous:
                self.save(row)
                return "retry"
            self.save(row, "acquisition_failed")
            return "stop"
        gen.update(state="BOOTING", started_at=timestamp())
        self.save(gen)
        # A clock deadline can pass while RunInstances is in flight.
        if rules.expires_at <= utcnow():
            row.update(state="ENDING", end_requested=True)
            self.save(row, "ending")
        return "launched"

    async def _monitor(self, row, gen, rules):
        if not gen or not gen.get("instance_id"):
            raise ProviderError("generation_instance_missing")
        instance = await self.backend.instance(gen)
        if not instance or instance["State"]["Name"] in {"terminated", "shutting-down", "stopped"}:
            row.update(
                state="RECOVERING",
                recovery_started_at=timestamp(),
                current_backup_id=None,
                connection=None,
                error="instance_unavailable",
            )
            self.save(row, "recovering")
            return
        if instance["State"]["Name"] != "running":
            return
        volumes = await self.backend.inventory(gen, instance)
        gen["volumes"] = volumes
        report = gen.get("report", {})
        fresh = (
            gen.get("heartbeat_at") and (utcnow() - at(gen["heartbeat_at"])).total_seconds() <= 60
        )
        # Boot and restore timeouts apply only before the first successful verification. Once a
        # generation has served, guest silence or a failed self-check does not prove it stopped
        # (the cloud still reports it running): keep the writer and its route, and report it.
        verified = bool(gen.get("verified_at"))
        booting_too_long = (
            not verified
            and (utcnow() - at(gen["created_at"])).total_seconds()
            > self.settings.spotbot_rental_boot_timeout_seconds
        )
        if not fresh:
            self.save(gen)
            if verified:
                self._degrade(row, "guest_heartbeat_lost")
            elif booting_too_long:
                row.update(
                    state="RECOVERING",
                    recovery_started_at=timestamp(),
                    current_backup_id=None,
                    connection=None,
                    error="guest_boot_timeout",
                )
                self.save(row, "recovering")
            return
        ready = (
            report.get("ssh_ready")
            and report.get("gpu_count") == rules.gpu_count
            and gpu_model(report.get("gpu_model", "")) == rules.gpu_model
            and report.get("gpu_memory_mib", 0) >= rules.min_gpu_memory_gib * 1024 * 0.98
            and {v["volume_id"] for v in volumes} <= set(report.get("volume_ids", []))
        )
        by_device = {v["device"]: report.get("canaries", {}).get(v["volume_id"]) for v in volumes}
        if not all(by_device.values()):
            ready = False
        if gen.get("source_backup_id") and not verified:
            source = self.db.get("backup", gen["source_backup_id"])
            ready = (
                ready
                and source["canaries"] == by_device
                and set(source["mounts"]) <= set(report.get("mounts", []))
            )
            if not ready and booting_too_long:
                row.update(
                    state="ENDING",
                    end_requested=True,
                    error="restore_validation_failed",
                    connection=None,
                )
                self.save(row, "restore_failed")
                return
        # A partial report must not replace the canaries that later backups use for restore checks.
        if all(by_device.values()) or not verified:
            gen.update(canaries=by_device, mounts=report.get("mounts", []))
        self.save(gen)
        if not ready:
            if verified:
                self._degrade(row, "guest_check_failed")
                return
            if booting_too_long:
                row.update(
                    state="ENDING",
                    end_requested=True,
                    connection=None,
                    error="guest_validation_failed",
                )
            else:
                row["error"] = "guest_validation_pending"
            self.save(row)
            return
        if row.get("degraded"):
            row.update(degraded=None, degraded_at=None, error=None)
            self.save(row, "healthy")
        initial = self.request_backup(row, "initial")
        if initial["state"] != "AVAILABLE":
            if initial["state"] in {"FAILED", "NEEDS_RECONCILIATION"}:
                row.update(state="ACTION_REQUIRED", error="initial_backup_unavailable")
            else:
                row.update(state="VERIFYING", error="initial_backup_pending")
            self.save(row)
            return
        ip = instance.get("PublicIpAddress") or instance.get("PrivateIpAddress")
        if not ip:
            return
        if rules.http_port:
            try:
                response = await self.service.client.get(
                    f"http://{ip}:{rules.http_port}{rules.http_health_path}", timeout=5
                )
                if response.status_code != 200:
                    return
            except Exception:
                return
        if row["state"] not in {"ACTIVE", "DELIVERING"}:
            gen.update(state="READY", verified_at=timestamp())
            self.save(gen)
            if gen.get("source_backup_id"):
                source = self.db.get("backup", gen["source_backup_id"])
                source["restore_verified_at"] = timestamp()
                self.save(source, "restore_verified")
            row.update(
                state="DELIVERING" if rules.require_gateway_ack else "ACTIVE",
                error=None,
                flush_command=None,
                flush_requested_at=None,
                connection=dict(
                    rental_id=row["id"],
                    generation=gen["generation"],
                    instance_id=gen["instance_id"],
                    region=gen["region"],
                    ssh={
                        "host": ip,
                        "port": 22,
                        "user": rules.ssh_user,
                        "key_reference": rules.ssh_key_name,
                    },
                    http=f"http://{ip}:{rules.http_port}" if rules.http_port else None,
                ),
            )
            if not rules.require_gateway_ack:
                row["recovery_started_at"] = None
            self.save(row, "handoff" if rules.require_gateway_ack else "active")
        last = max(
            (at(b["created_at"]) for b in self.backups(row) if b["generation_id"] == gen["id"]),
            default=utcnow(),
        )
        if (utcnow() - last).total_seconds() >= rules.backup.interval_seconds and not any(
            b["state"] in {"REQUESTED", "CAPTURING", "PENDING", "REGISTERING", "IMAGE_PENDING"}
            for b in self.backups(row)
        ):
            self.request_backup(
                row, str(int(utcnow().timestamp()) // rules.backup.interval_seconds)
            )

    def _degrade(self, row, reason):
        """Report a serving generation that cannot currently prove its health, once per reason."""
        if row.get("degraded") != reason:
            row.update(degraded=reason, degraded_at=timestamp(), error=reason)
            self.save(row, "degraded")

    async def _end_or_recover(self, row, gen, rules, *, ending):
        if not gen or gen["state"] == "REJECTED":
            if ending:
                row.update(state="CLOSED", closed_at=timestamp())
                self.save(row, "closed")
            else:
                row["state"] = (
                    "ACTION_REQUIRED" if row.get("recovery_halted") else "WAITING_CAPACITY"
                )
                self.save(row)
            return
        if not gen.get("instance_id"):
            return
        instance = await self.backend.instance(gen)
        stopped = not instance or instance["State"]["Name"] == "terminated"
        if not stopped:
            if instance["State"]["Name"] != "shutting-down":
                # Preserve and persist every disk before issuing termination.
                gen["volumes"] = await self.backend.inventory(gen, instance)
                self.save(gen)
                if not row.get("flush_command"):
                    row.update(flush_command=str(uuid4()), flush_requested_at=timestamp())
                    self.save(row)
                flushed = gen.get("report", {}).get("flushed_command") == row["flush_command"]
                if not flushed and (utcnow() - at(row["flush_requested_at"])).total_seconds() < 10:
                    return
                await self.backend.terminate(gen)
            return
        if not gen.get("ended_at"):
            gen.update(ended_at=timestamp(), state="STOPPED")
            self.save(gen)
        if not gen.get("volumes"):
            row.update(state="ACTION_REQUIRED", error="retained_disk_inventory_missing")
            self.save(row, "action_required")
            return
        if not await self.backend.volumes_available(gen):
            return
        if any(
            b["state"] in {"REQUESTED", "CAPTURING", "PENDING", "REGISTERING", "IMAGE_PENDING"}
            and not b["final"]
            for b in self.backups(row)
        ):
            return
        final = self.request_backup(row, "final", final=True)
        selected = (
            self.db.get("backup", row["current_backup_id"]) if row["current_backup_id"] else final
        )
        if selected["state"] != "AVAILABLE":
            if final["state"] in {"FAILED", "NEEDS_RECONCILIATION"}:
                if rules.allow_older_backup:
                    selected = next(
                        (b for b in self.backups(row) if b["state"] == "AVAILABLE"), final
                    )
                if selected["state"] != "AVAILABLE":
                    row.update(state="ACTION_REQUIRED", error="final_backup_unavailable")
                    self.save(row, "action_required")
            return
        if ending:
            row.update(state="CLOSED", closed_at=timestamp(), current_backup_id=selected["id"])
            self.save(row, "closed")
        else:
            row.update(
                state="ACTION_REQUIRED" if row.get("recovery_halted") else "WAITING_CAPACITY",
                current_backup_id=selected["id"],
                error="recovery_wait_limit_reached" if row.get("recovery_halted") else None,
            )
            self.save(row, "backup_ready")

    async def _backup_step(self, backup):
        gen = self.db.get("generation", backup["generation_id"])
        try:
            await self._capture(backup, gen)
        except ProviderError as exc:
            # Retryable failures resume the same stage; restarting capture could register a second
            # image for snapshots that already exist.
            backup.update(
                state="NEEDS_RECONCILIATION"
                if exc.ambiguous
                else backup["state"]
                if exc.retryable
                else "FAILED",
                error=exc.code,
            )
            self.save(backup, "backup_failed")

    def _guest_flushed(self, backup, gen):
        """Ask a running guest to run its pre-backup hook and sync before a routine capture."""
        if gen["state"] == "STOPPED":
            return True  # Retained disks of a stopped writer cannot change.
        if not backup.get("flush_command"):
            backup.update(flush_command=str(uuid4()), flush_requested_at=timestamp())
            self.save(backup)
            return False
        if gen.get("report", {}).get("flushed_command") == backup["flush_command"]:
            backup["consistency"] = "guest_flushed"
            return True
        # An unresponsive guest must not block recovery points; record crash consistency.
        elapsed = (utcnow() - at(backup["flush_requested_at"])).total_seconds()
        return elapsed >= BACKUP_FLUSH_WAIT_SECONDS

    async def _capture(self, backup, gen):
        if backup["state"] == "REQUESTED":
            if not self._guest_flushed(backup, gen):
                return
            backup.update(state="CAPTURING", capture_at=timestamp())
            self.save(backup)
        if backup["state"] == "CAPTURING":
            found = await self.backend.snapshots(backup)
            by_volume = {s["VolumeId"]: s for s in found}
            if len(by_volume) != len(found):
                raise ProviderError("ambiguous_duplicate_snapshots", ambiguous=True)
            required = {v["volume_id"] for v in backup["volumes"]}
            if set(by_volume) - required:
                raise ProviderError("snapshot_disk_set_mismatch")
            pending = backup.get("capture_inflight")
            if pending and not (
                required <= set(by_volume) if pending == "all" else pending in by_volume
            ):
                if (utcnow() - at(backup["updated_at"])).total_seconds() > 60:
                    raise ProviderError("snapshot_creation_uncertain", ambiguous=True)
                return
            if required <= set(by_volume):
                backup.update(
                    state="PENDING", snapshots={v: s["SnapshotId"] for v, s in by_volume.items()}
                )
                self.save(backup)
            else:
                stopped = gen["state"] == "STOPPED"
                volume = next(iter(required - set(by_volume))) if stopped else None
                backup["capture_inflight"] = volume or "all"
                self.save(backup)
                try:
                    await self.backend.start_snapshots(backup, gen, volume)
                except ProviderError as exc:
                    if not exc.ambiguous:
                        # AWS rejected the request, so nothing is in flight: retry next cycle.
                        backup.pop("capture_inflight", None)
                        self.save(backup)
                    raise
                return
        if backup["state"] == "PENDING":
            found = await self.backend.snapshots(backup)
            if any(s["State"] == "error" for s in found):
                raise ProviderError("snapshot_failed")
            if {s["SnapshotId"] for s in found} != set(backup["snapshots"].values()):
                raise ProviderError("snapshot_set_incomplete")
            if not all(s["State"] == "completed" for s in found):
                return
            backup["state"] = "REGISTERING"
            self.save(backup)
            try:
                image_id = await self.backend.register_image(backup, gen, found)
            except ProviderError as exc:
                if not exc.ambiguous:
                    # A rejected registration created no image; register again from PENDING.
                    backup["state"] = "PENDING"
                    self.save(backup)
                raise
            backup.update(
                state="IMAGE_PENDING", image_id=image_id, images={backup["region"]: image_id}
            )
            self.save(backup)
        if backup["state"] == "REGISTERING":
            image_id = await self.backend.find_image(backup)
            if not image_id:
                if (utcnow() - at(backup["updated_at"])).total_seconds() > 60:
                    raise ProviderError("image_creation_uncertain", ambiguous=True)
                return
            backup.update(
                state="IMAGE_PENDING", image_id=image_id, images={backup["region"]: image_id}
            )
            self.save(backup)
        if backup["state"] == "IMAGE_PENDING":
            image = await self.backend.image(backup["region"], backup["image_id"])
            if image["State"] == "failed":
                raise ProviderError("image_failed")
            if image["State"] == "available":
                backup.update(state="AVAILABLE", completed_at=timestamp(), error=None)
                self.save(backup, "backup_available")

    async def _cleanup(self, row, *, final):
        rules = RFQ.model_validate(row["rfq"])
        backups = self.backups(row)
        available = [b for b in backups if b["state"] == "AVAILABLE"]
        retention_ended = (
            final
            and (utcnow() - at(row["closed_at"])).total_seconds()
            >= rules.backup.final_retention_seconds
        )
        protected = {b["id"] for b in available[: rules.backup.keep]}
        if row.get("current_backup_id"):
            protected.add(row["current_backup_id"])
        if retention_ended:
            protected.clear()
        for backup in backups:
            if (backup["state"] == "AVAILABLE" and backup["id"] not in protected) or (
                retention_ended
                and backup["state"]
                in {
                    "FAILED",
                    "NEEDS_RECONCILIATION",
                    "PENDING",
                    "REGISTERING",
                    "IMAGE_PENDING",
                    "CAPTURING",
                    "REQUESTED",
                }
            ):
                # Persist snapshot ownership references before deregistration.
                await self.backend.delete_backup(backup)
                backup["state"] = "DELETING"
                self.save(backup)
            if backup["state"] == "DELETING":
                for region, image_id in backup["images"].items():
                    await self.backend.delete_image(region, image_id, row["id"])
                for region, ids in backup.get("cleanup_snapshots", {}).items():
                    for snapshot_id in ids:
                        await self.backend.delete_snapshot(region, snapshot_id)
                backup.update(state="DELETED", deleted_at=timestamp())
                self.save(backup, "backup_deleted")
        # Source volumes are retained until a verified replacement or final retention expiry.
        current = self.current(row)
        safe_old = current and current.get("verified_at") and row["state"] == "ACTIVE"
        for gen in self.generations(row):
            if gen["state"] != "STOPPED" or not (
                retention_ended or (safe_old and gen["id"] != current["id"])
            ):
                continue
            complete = any(
                b["generation_id"] == gen["id"] and b["final"] and b["state"] == "AVAILABLE"
                for b in self.backups(row)
            )
            if not complete and not retention_ended:
                continue
            for volume in gen.get("volumes", []):
                if volume["volume_id"] not in gen["deleted_volumes"]:
                    await self.backend.delete_volume(gen, volume["volume_id"])
                    gen["deleted_volumes"].append(volume["volume_id"])
                    gen.setdefault("deleted_volume_times", {})[volume["volume_id"]] = timestamp()
                    self.save(gen)

    async def run(self):
        while True:
            try:
                await self.tick()
            except Exception:
                logger.warning("Rental worker cycle failed; retrying")
            await asyncio.sleep(self.settings.spotbot_rental_worker_seconds)
