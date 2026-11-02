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

from spotbot import rental_tasks as tasks
from spotbot.models import gpu_model, timestamp, utcnow
from spotbot.providers import ProviderError
from spotbot.rental_aws import AWSRecovery, initial_image
from spotbot.rental_models import RFQ, gpu_memory_sufficient
from spotbot.storage.common import dump
from spotbot.storage.workflows import ConflictError, WorkflowStore

# The guest reports every 15s and flushes on its next report; allow two cycles before
# capturing without a confirmed flush. Routine captures are not on the recovery path.
BACKUP_FLUSH_WAIT_SECONDS = 30
# Lossless fast recovery: wait this long for the guest to confirm every protected filesystem
# is frozen, and terminate within the trust window (well inside the guest's 900 s watchdog),
# so no write can follow the snapshot. Otherwise fall back to capturing retained disks.
FREEZE_ACK_SECONDS = 45
FREEZE_TRUST_SECONDS = 300
# Minimum spacing of AWS checks for a guest-reported interruption, per generation.
INTERRUPTION_CHECK_SECONDS = 15
ACTIVE_BACKUP_STATES = {"REQUESTED", "CAPTURING", "PENDING", "REGISTERING", "IMAGE_PENDING"}

logger = logging.getLogger(__name__)


def identity(*parts):
    return str(uuid5(NAMESPACE_URL, dump(list(parts))))


def at(value):
    return datetime.fromisoformat(value)


def document(kind, tenant_id, **values):
    return dict(
        id=str(uuid4()), kind=kind, tenant_id=tenant_id, created_at=timestamp(), version=0, **values
    )


def track_service(row):
    """Record when the customer has a delivered server, for usage billing.

    `service_intervals` holds one `{start, end, end_reason}` per period the rental was ACTIVE
    and not ending. `end_reason` is `ended` for an end request (the customer, expiry or budget)
    and `interrupted` otherwise (a Spot replacement or a failed health check). On the
    first handoff, a `service_seconds` RFQ moves `expires_at` to the delivery time plus that
    duration, so the paid time starts at delivery rather than at the order.
    """
    now = utcnow()
    rfq = row["rfq"]
    if row["state"] in {"DELIVERING", "ACTIVE"} and not row.get("service_started_at"):
        row["service_started_at"] = now.isoformat()
        if rfq.get("service_seconds"):
            # The RFQ requires expiry strictly after the acquisition deadline.
            end = max(
                now + timedelta(seconds=rfq["service_seconds"]),
                at(rfq["acquisition_deadline"]) + timedelta(seconds=1),
            )
            rfq["expires_at"] = min(at(rfq["expires_at"]), end).isoformat()
    intervals = row.setdefault("service_intervals", [])
    serving = row["state"] == "ACTIVE" and not row.get("end_requested")
    if serving and (not intervals or intervals[-1]["end"]):
        intervals.append(dict(start=now.isoformat(), end=None))
    elif not serving and intervals and not intervals[-1]["end"]:
        intervals[-1]["end"] = now.isoformat()
        intervals[-1]["end_reason"] = "ended" if row.get("end_requested") else "interrupted"


def service_seconds(row, now=None):
    """Seconds the customer had a delivered server, including an open period up to `now`."""
    now = now or utcnow()
    return sum(
        max(0.0, ((at(i["end"]) if i["end"] else now) - at(i["start"])).total_seconds())
        for i in row.get("service_intervals") or []
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
        self.sealer = tasks.Sealer(service.settings.spotbot_rental_task_key.get_secret_value())

    def row_lock(self, rental_id):
        return self.row_locks.setdefault(rental_id, asyncio.Lock())

    def save(self, doc, event=None):
        if doc["kind"] == "rental":
            track_service(doc)
            tasks.scrub(doc)
        return self.db.save(doc, doc["version"], event=event)

    def get(self, rental_id, tenant_id):
        value = self.db.get("rental", rental_id)
        if not value or value["tenant_id"] != tenant_id:
            raise LookupError("rental_not_found")
        return value

    def backend_for(self, rules):
        return self.backend

    def unmonitored_regions(self, rules):
        # Polling is only a fallback; never buy where interruption warnings cannot arrive.
        queues = json.loads(self.settings.spotbot_rental_interruption_queues)
        return sorted(set(rules.regions) - set(queues))

    def validate_rules(self, rules):
        if rules.account != self.settings.spotbot_aws_account_name:
            raise ValueError("aws_account_not_enrolled")
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
        # Preserve idempotency fingerprints accepted before these optional fields existed.
        if not payload["rfq"]["initial_image_ids"]:
            payload["rfq"].pop("initial_image_ids")
        for name in ("ssh_public_key", "customer_ref", "service_seconds"):
            if payload["rfq"][name] is None:
                payload["rfq"].pop(name)
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
            aws_account_id=self.settings.spotbot_aws_expected_account_id or None,
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
            # Customer keys the guest agent installs; changed later through set_ssh_keys.
            ssh_keys=dict(version=1, keys=[rules.ssh_public_key] if rules.ssh_public_key else []),
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
                "ssh_public_key",
                "customer_ref",
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

    async def set_ssh_keys(self, rental_id, tenant_id, keys):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["state"] == "CLOSED" or row["end_requested"]:
                raise ValueError("rental_ended")
            current = row.get("ssh_keys") or dict(version=0, keys=[])
            if current["keys"] != keys:
                row["ssh_keys"] = dict(version=current["version"] + 1, keys=keys)
                self.save(row, "ssh_keys_updated")
            return self.ssh_keys(row)

    def ssh_keys(self, row):
        """The rental's customer key set and whether the current server has installed it."""
        value = row.get("ssh_keys") or dict(version=0, keys=[])
        gen = self.current(row)
        applied = ((gen or {}).get("report") or {}).get("ssh_keys_version")
        return dict(
            version=value["version"],
            keys=value["keys"],
            applied_version=applied,
            installed=applied == value["version"] and row["state"] != "CLOSED",
        )

    async def set_task(self, rental_id, tenant_id, request):
        """Set or (with None) remove the managed task, until its first run starts."""
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["state"] == "CLOSED" or row["end_requested"]:
                raise ValueError("rental_ended")
            if not tasks.editable(row):
                raise ValueError("task_started")
            if request is None:
                row.update(task=None, task_outcome=None)
            else:
                row["task"] = tasks.build(row, request, self.sealer)
                row.update(task_seq=row["task"]["version"], task_outcome=None)
            self.save(row, "task_updated")
            return tasks.detail(row)

    async def stop_task(self, rental_id, tenant_id):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            tasks.stop(row)
            self.save(row, "task_updated")
            return tasks.detail(row)

    def task(self, row):
        gen = self.current(row)
        return tasks.detail(row, ((gen or {}).get("report") or {}).get("task"))

    def _request_end(self, row):
        row.update(
            end_requested=True,
            state="ENDING",
            connection=None,
            error=None,
            flush_command=str(uuid4()),
            flush_requested_at=timestamp(),
        )

    async def release(self, rental_id, tenant_id):
        async with self.row_lock(rental_id):
            row = self.get(rental_id, tenant_id)
            if row["state"] != "CLOSED" and not row["end_requested"]:
                self._request_end(row)
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
            aws_account_id=row.get("aws_account_id"),
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
                await self._guest_interruption(row, gen)
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
            freeze = (
                row.get("freeze_command")
                if row["state"] == "RECOVERING" and row.get("freeze_generation_id") == gen["id"]
                else None
            )
            ending = bool(report.task) and tasks.record(row, gen, report.task) == "end"
            skipped = not report.task and tasks.skip_replacement(row, gen)
            if ending:
                # The customer chose to end the server when the task finished this way.
                self._request_end(row)
                row["end_cause"] = "task_" + row["task_outcome"]["state"]
                self.save(row, "ending")
            elif report.task or skipped:
                self._save_task_run(row)
            keys = row.get("ssh_keys")
            instruction = tasks.instruction(row, gen, self.sealer)
            # Commit dispatch under the same rental lock as edits/stops, before delivery.
            self._save_task_run(row)
            return dict(
                task=instruction,
                authorized_keys=dict(
                    version=keys["version"],
                    user=row["rfq"].get("ssh_user", "ubuntu"),
                    keys=keys["keys"],
                )
                if keys
                else None,
                freeze_command=freeze,
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

    def _save_task_run(self, row):
        """Save a task report; a report that changed nothing is not written again."""
        stored = self.db.get("rental", row["id"])
        if any(stored.get(k) != row.get(k) for k in ("task", "task_runs", "task_outcome")):
            self.save(row, "task_finished" if row.get("task_outcome") else None)

    async def _guest_interruption(self, row, gen):
        """Recover on a guest-reported Spot warning only when AWS confirms it."""
        checked = gen.get("interruption_checked_at")
        if checked and (utcnow() - at(checked)).total_seconds() < INTERRUPTION_CHECK_SECONDS:
            return  # The guest repeats the report every 5 s; EventBridge remains the main path.
        gen["interruption_checked_at"] = timestamp()
        try:
            confirmed = await self.backend.interruption_confirmed(gen)
        except ProviderError:
            confirmed = False
        if not confirmed:
            gen["unconfirmed_interruption_at"] = timestamp()
            self.save(gen)
            return
        self.save(gen)
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
                and d.get("aws_account", "default") == rules.account
                and (
                    not self.settings.spotbot_aws_expected_account_id
                    or d.get("aws_account_id") == self.settings.spotbot_aws_expected_account_id
                )
                and offer.region in rules.regions
                and offer.region in self.settings.aws_order_regions
                and (not region or offer.region == region)
                and offer.gpu_count == rules.gpu_count
                and offer.vcpus >= rules.min_vcpus
                and offer.memory_gb >= rules.min_memory_gib
                and d.get("architecture") == rules.architecture
                and memory
                and gpu_memory_sufficient(min(memory), rules.min_gpu_memory_gib)
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
                if entry["rfq"].get("account", "default") != self.settings.spotbot_aws_account_name:
                    continue
                if (
                    entry.get("aws_account_id")
                    and entry["aws_account_id"] != self.settings.spotbot_aws_expected_account_id
                ):
                    logger.error("Rental account enrollment mismatch: rental=%s", entry["id"])
                    continue
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
        if (
            self.settings.spotbot_aws_expected_account_id
            and event.get("account") != self.settings.spotbot_aws_expected_account_id
        ):
            raise ValueError("interruption_account_mismatch")
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
            if entry["rfq"].get("account", "default") != self.settings.spotbot_aws_account_name:
                continue
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
        # One sweep is one attempt toward max_attempts; the cursor rotates the starting pool.
        start = row.get("pool_cursor", row["attempts"]) % len(options)
        row["attempts"] += 1
        sweep = {}  # Account quota and instance specs cannot change across rejected requests.
        tried = 0
        for offer in (options[start:] + options[:start])[
            : self.settings.spotbot_rental_pools_per_attempt
        ]:
            if utcnow() >= deadline:
                break
            row["pool_cursor"] = row.get("pool_cursor", start) + 1
            outcome = await self._launch_offer(row, rules, offer, source, sweep, first=not tried)
            tried += 1
            if outcome != "retry":
                return
        self.save(row, "acquisition_failed" if tried else None)

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
            aws_account_id=row.get("aws_account_id"),
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
        if (
            row["state"] == "DELIVERING"
            and row.get("delivering_at")
            and (utcnow() - at(row["delivering_at"])).total_seconds()
            > self.settings.spotbot_rental_delivery_timeout_seconds
        ):
            # The server keeps running; an operator fixes the gateway, then recovers or releases.
            row.update(state="ACTION_REQUIRED", connection=None, error="gateway_ack_timeout")
            self.save(row, "action_required")
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
            and gpu_memory_sufficient(report.get("gpu_memory_mib", 0), rules.min_gpu_memory_gib)
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
        # Routine retention deletes the initial backup of a long-running generation; once the
        # generation was verified, that is not a reason to take it out of service again.
        retired = verified and initial["state"] in {"DELETING", "DELETED"}
        if initial["state"] != "AVAILABLE" and not retired:
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
                freeze_abandoned=None,
                frozen_confirmed_at=None,
                connection=dict(
                    rental_id=row["id"],
                    generation=gen["generation"],
                    instance_id=gen["instance_id"],
                    region=gen["region"],
                    ssh={
                        "host": ip,
                        "port": 22,
                        "user": rules.ssh_user,
                        "key_reference": rules.ssh_key_name or "customer-public-key",
                    },
                    http=f"http://{ip}:{rules.http_port}" if rules.http_port else None,
                ),
            )
            if rules.require_gateway_ack:
                row["delivering_at"] = timestamp()
            else:
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
        if not ending and await self._frozen_switch(row, gen, instance):
            return
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

    def _abandon_freeze(self, row, reason, backup=None):
        """Use the ordinary path: terminate, then capture the retained disks."""
        if backup and backup["state"] in ACTIVE_BACKUP_STATES | {"AVAILABLE"}:
            # Still a valid recovery point, but no longer the final disk state.
            backup["final"] = False
            self.save(backup)
        row.update(freeze_abandoned=reason)
        self.save(row)
        return False

    async def _frozen_switch(self, row, gen, instance):
        """Capture a recovering server while the guest holds its filesystems frozen.

        Returns True while this path owns the step. The snapshot is taken only after the
        guest confirms the freeze, and the server is terminated as soon as the snapshots
        exist, without thawing, so nothing can be written after the recovery point. The
        replacement then need not wait for AWS to finish shutting the old server down.
        """
        state = instance["State"]["Name"] if instance else "terminated"
        command = row.get("freeze_command")
        backup = (
            self.db.get("backup", identity("backup", row["id"], gen["id"], "frozen-" + command))
            if command
            else None
        )
        if backup and gen.get("terminate_requested_at"):
            if backup["state"] in {"FAILED", "NEEDS_RECONCILIATION"}:
                return self._abandon_freeze(row, "frozen_backup_failed", backup)
            if backup["state"] != "AVAILABLE":
                return True
            row.update(
                state="ACTION_REQUIRED" if row.get("recovery_halted") else "WAITING_CAPACITY",
                current_backup_id=backup["id"],
                error="recovery_wait_limit_reached" if row.get("recovery_halted") else None,
                freeze_command=None,
                freeze_generation_id=None,
            )
            self.save(row, "backup_ready")
            return True
        if row.get("freeze_abandoned"):
            return False
        if state != "running":
            # Lost before this path terminated it: capture the retained disks instead.
            return self._abandon_freeze(row, "server_stopped", backup) if command else False
        report = gen.get("report", {})
        fresh = (
            gen.get("heartbeat_at") and (utcnow() - at(gen["heartbeat_at"])).total_seconds() <= 60
        )
        if not command:
            if row.get("current_backup_id"):
                return self._abandon_freeze(row, "explicit_backup_requested")
            if not (gen.get("verified_at") and fresh and report.get("freeze_supported")):
                return self._abandon_freeze(row, "freeze_unsupported")
            gen["volumes"] = await self.backend.inventory(gen, instance)
            self.save(gen)
            row.update(
                freeze_command=str(uuid4()),
                freeze_requested_at=timestamp(),
                freeze_generation_id=gen["id"],
                frozen_confirmed_at=None,
            )
            self.save(row)
            return True
        if report.get("thawed_command") == command:
            return self._abandon_freeze(row, "guest_thawed", backup)
        if report.get("frozen_command") != command:
            if (utcnow() - at(row["freeze_requested_at"])).total_seconds() < FREEZE_ACK_SECONDS:
                return True
            return self._abandon_freeze(row, "freeze_unconfirmed", backup)
        if not row.get("frozen_confirmed_at"):
            row["frozen_confirmed_at"] = timestamp()
            self.save(row)
        if (utcnow() - at(row["frozen_confirmed_at"])).total_seconds() >= FREEZE_TRUST_SECONDS:
            return self._abandon_freeze(row, "freeze_trust_expired", backup)
        if not backup:
            if any(b["state"] in ACTIVE_BACKUP_STATES for b in self.backups(row)):
                return True  # A routine capture finishes first; the trust window still applies.
            backup = self.request_backup(row, "frozen-" + command, final=True)
            backup.update(frozen_command=command, consistency="guest_frozen")
            self.save(backup)
            return True
        if backup["state"] in {"FAILED", "NEEDS_RECONCILIATION"}:
            return self._abandon_freeze(row, "frozen_backup_failed", backup)
        if backup["state"] in {"REQUESTED", "CAPTURING"}:
            return True
        # Every snapshot exists, so the recovery point lies inside the freeze. Never thaw.
        await self.backend.terminate(gen)
        gen["terminate_requested_at"] = timestamp()
        self.save(gen)
        return True

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
        if backup.get("frozen_command"):
            return True  # The guest flushed and froze every filesystem before confirming.
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
        # A server terminated by the fast path may still be shutting down after the rental moved
        # on; record when it actually stopped so billing ends and its disks can be released.
        for gen in self.generations(row):
            if gen.get("terminate_requested_at") and gen["state"] != "STOPPED":
                instance = await self.backend.instance(gen)
                if not instance or instance["State"]["Name"] == "terminated":
                    gen.update(state="STOPPED", ended_at=timestamp())
                    self.save(gen)
        # A stopped server's volumes go once its final snapshot is available and either the
        # rental has closed (the snapshot alone is kept for the retention period) or a verified
        # replacement runs. Without a final snapshot they stay until retention ends.
        current = self.current(row)
        safe_old = current and current.get("verified_at") and row["state"] == "ACTIVE"
        for gen in self.generations(row):
            if gen["state"] != "STOPPED":
                continue
            complete = any(
                b["generation_id"] == gen["id"] and b["final"] and b["state"] == "AVAILABLE"
                for b in self.backups(row)
            )
            replaced = safe_old and gen["id"] != current["id"]
            if not (retention_ended or (complete and (final or replaced))):
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
