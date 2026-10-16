import asyncio
import hashlib
import hmac
import logging
import time
from datetime import datetime

import httpx

from spotbot.config import Settings
from spotbot.models import OrderRequest, timestamp, utcnow
from spotbot.providers import ProviderError, providers
from spotbot.storage import create_store
from spotbot.storage.common import dump, fingerprint

logger = logging.getLogger(__name__)


def order_public(order: dict) -> dict:
    # Never return persisted bootstrap, key material, or provider payloads to the gateway.
    return {
        k: order[k]
        for k in [
            "id",
            "state",
            "offer",
            "instance_id",
            "attempts",
            "created_at",
            "updated_at",
            "expires_at",
            "error",
            "handoff",
        ]
    }


def sanitized_plan(plan: dict) -> dict:
    def redact(value):
        if isinstance(value, dict):
            return {
                k: "[redacted]"
                if k in {"user_data", "UserData", "cloud_init", "launch_configuration", "ssh_key"}
                else redact(v)
                for k, v in value.items()
            }
        if isinstance(value, list):
            return [redact(v) for v in value]
        return value

    return redact(plan)


class Service:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.store = create_store(settings)
        self.client = client or httpx.AsyncClient(
            timeout=settings.spotbot_http_timeout_seconds, follow_redirects=False
        )
        self._own_client = client is None
        self.providers = providers(settings, self.client)
        self.collect_lock = asyncio.Lock()
        self.list_prices_due = 0.0
        self.worker_lock = asyncio.Lock()

    def acquire(self):
        self.store.acquire()
        self.store.recover()

    async def close(self):
        if self._own_client:
            await self.client.aclose()
        self.store.close()

    async def collect(self, only: str | None = None):
        async with self.collect_lock:

            async def one(provider):
                if not self.settings.enabled(provider.name):
                    return {"provider": provider.name, "status": "disabled", "count": 0}
                if not provider.configured and provider.name != "vultr":
                    missing = (
                        "missing_aws_credentials" if provider.name == "aws" else "missing_api_key"
                    )
                    self.store.record_collection(provider.name, [], missing)
                    return {
                        "provider": provider.name,
                        "status": "skipped",
                        "count": 0,
                        "error": missing,
                    }
                try:
                    offers = await provider.collect()
                    self.store.record_collection(provider.name, offers)
                    return {"provider": provider.name, "status": "ok", "count": len(offers)}
                except Exception as exc:
                    # Vendor response bodies and exception strings can contain secrets.
                    code = exc.code if isinstance(exc, ProviderError) else "invalid_catalog_schema"
                    self.store.record_collection(provider.name, [], code)
                    logger.warning("Collection failed for %s: %s", provider.name, code)
                    return {"provider": provider.name, "status": "error", "count": 0, "error": code}

            selected = [
                p
                for name, p in self.providers.items()
                if (only is None and self.settings.enabled(name)) or only == name
            ]
            results = await asyncio.gather(*(one(p) for p in selected))
            aws = self.providers.get("aws")
            if aws in selected and aws.configured and self.settings.spotbot_aws_list_prices_enabled:
                listed = await self._collect_list_prices(aws)
                if listed:
                    results.append(listed)
            return results

    async def _collect_list_prices(self, aws):
        # Published rates change rarely; storing them every Spot cycle would multiply history.
        if time.monotonic() < self.list_prices_due:
            return None
        interval = self.settings.spotbot_aws_list_price_interval_seconds
        try:
            offers = await aws.collect_list_prices()
            self.store.record_collection("aws_list", offers)
            self.list_prices_due = time.monotonic() + interval
            return {"provider": "aws_list", "status": "ok", "count": len(offers)}
        except Exception as exc:
            code = exc.code if isinstance(exc, ProviderError) else "invalid_catalog_schema"
            self.store.record_collection("aws_list", [], code)
            self.list_prices_due = time.monotonic() + min(interval, 1800)
            logger.warning("Collection failed for aws_list: %s", code)
            return {"provider": "aws_list", "status": "error", "count": 0, "error": code}

    def create_order(self, request: OrderRequest, key: str):
        if request.dry_run and not self.settings.spotbot_dry_run_enabled:
            raise ValueError("dry_run_disabled")
        # Idempotent replay returns the original order even if its offer disappears later.
        row = self.store.get_order_by_key(key)
        if row:
            if fingerprint(request) != row["fingerprint"]:
                raise ValueError("idempotency_key_conflict")
            return order_public(row), False
        offer = self.store.get_offer(request.offer_id)
        if not offer:
            raise ValueError("offer_not_found")
        if not self.settings.enabled(offer.provider):
            raise ValueError("provider_disabled")
        if not offer.orderable:
            if offer.provider == "aws":
                raise ValueError(
                    "aws_" + offer.details.get("eligibility_status", "offer_not_orderable")
                )
            raise ValueError("offer_not_orderable")
        if offer.price_hourly > request.max_price_hourly:
            raise ValueError("price_exceeds_limit")
        provider = self.providers[offer.provider]
        provider.plan(
            offer, request.launch, "spotbot-preview", max_price_hourly=request.max_price_hourly
        )  # Validate vendor launch options early.
        if not request.dry_run:
            if not self.settings.spotbot_live_orders_enabled:
                raise ValueError("live_orders_disabled")
            if not provider.configured:
                raise ValueError("missing_api_key")
        order, created = self.store.create_order(request, offer, key)
        return order_public(order), created

    async def tick(self):
        async with self.worker_lock:
            self.store.ensure_ownership()
            # One order per provider mutation at a time. Provider itself enforces rate spacing.
            for order in self.store.active_orders():
                try:
                    if order["state"] == "queued":
                        await self._submit(order)
                    elif order["state"] == "releasing":
                        await self._release(order)
                    else:
                        await self._monitor(order)
                except Exception:
                    # An unexpected exception after a POST must preserve its uncertain state.
                    current = self.store.get_order(order["id"])
                    if current["state"] == "submitting":
                        self.store.transition(
                            order["id"], "needs_reconciliation", error="unexpected_create_error"
                        )
                    elif current["state"] == "checking":
                        self.store.transition(order["id"], "queued", error="unexpected_check_error")
                    else:
                        self.store.transition(
                            order["id"], current["state"], error="unexpected_worker_error"
                        )
                    logger.warning("Order processing failed for %s", order["id"])
            await self._deliver_events()

    async def _submit(self, order):
        order_id = order["id"]
        req = OrderRequest.model_validate(order["request"])
        if (
            utcnow() >= datetime.fromisoformat(order["expires_at"])
            or order["attempts"] >= req.max_attempts
        ):
            self.store.transition(
                order_id,
                "expired",
                expected={"queued"},
                error=order["error"] or "wait_or_attempt_limit",
            )
            return
        if not self.settings.spotbot_live_orders_enabled:
            self.store.transition(order_id, "queued", error="live_orders_disabled")
            return
        if not self.settings.enabled(order["offer"]["provider"]):
            self.store.transition(order_id, "queued", error="provider_disabled")
            return
        if not self.store.transition(order_id, "checking", expected={"queued"}):
            return
        provider = self.providers[order["offer"]["provider"]]
        result = (await self.collect(provider.name))[0]
        if result["status"] != "ok":
            self.store.transition(order_id, "queued", error=result["error"])
            return
        fresh = self.store.get_offer(req.offer_id)
        if not fresh:
            self.store.transition(order_id, "queued", error="no_capacity")
            return
        if not fresh.orderable:
            state = "queued" if fresh.provider == "aws" else "failed"
            self.store.transition(
                order_id,
                state,
                error=fresh.details.get("eligibility_status") or "offer_not_orderable",
            )
            return
        assessment = provider.public_offer(fresh, self.settings.spotbot_price_max_age_seconds)
        if not assessment["can_attempt"]:
            error = (
                "stale_price"
                if fresh.public(self.settings.spotbot_price_max_age_seconds)["stale"]
                else "no_capacity"
            )
            if assessment["eligibility_status"] == "quota_rejected_at_launch":
                error = "aws_quota_rejected_at_launch"
            self.store.transition(order_id, "queued", error=error)
            return
        if fresh.price_hourly > req.max_price_hourly:
            self.store.transition(order_id, "queued", error="price_exceeds_limit")
            return
        try:
            plan = provider.plan(
                fresh, req.launch, "spotbot-" + order_id, max_price_hourly=req.max_price_hourly
            )
        except ValueError:
            self.store.transition(order_id, "failed", error="invalid_launch_options")
            return
        # The durable marker is committed BEFORE sending a billable request.
        marked = self.store.transition(
            order_id,
            "submitting",
            expected={"checking"},
            attempts=order["attempts"] + 1,
            offer=fresh.model_dump(mode="json"),
            error=None,
        )
        if not marked:
            return
        try:
            self.store.ensure_ownership()
            instance_id = await provider.create(plan)
        except ProviderError as exc:
            provider.note_failure(fresh, exc)
            state = (
                "needs_reconciliation" if exc.ambiguous else "queued" if exc.retryable else "failed"
            )
            self.store.transition(order_id, state, error=exc.code)
            return
        self.store.transition(order_id, "provisioning", instance_id=instance_id, error=None)

    async def _monitor(self, order):
        provider = self.providers[order["offer"]["provider"]]
        try:
            status = await provider.inspect(order["instance_id"])
        except ProviderError as exc:
            if exc.code == "http_404":
                self.store.transition(order["id"], "lost", error="instance_not_found", handoff=None)
            else:
                self.store.transition(order["id"], order["state"], error=exc.code)
            return
        if status.get("preempted"):
            self.store.transition(
                order["id"], "preempted", error="provider_preempted", handoff=None
            )
        elif status.get("terminated"):
            self.store.transition(order["id"], "lost", error="provider_terminated", handoff=None)
        elif status["ready"]:
            if order["state"] != "ready":
                handoff = self._handoff(order, status)
                self.store.transition(order["id"], "ready", handoff=handoff, error=None)
            elif order["error"]:
                self.store.transition(order["id"], "ready", error=None)
        elif order["state"] == "ready":
            self.store.transition(
                order["id"], "provisioning", handoff=None, error="instance_unavailable"
            )

    def _handoff(self, order, status):
        req = OrderRequest.model_validate(order["request"])
        offer = order["offer"]
        ip = status["ip"]
        hostname = f"[{ip}]" if ":" in ip else ip
        return {
            "order_id": order["id"],
            "provider": offer["provider"],
            "cloud": offer["cloud"],
            "instance_id": order["instance_id"],
            "region": offer["region"],
            "gpu_model": offer["gpu_model"],
            "gpu_count": offer["gpu_count"],
            "market": offer["market"],
            "ssh": {
                "host": ip,
                "port": status["ssh_port"],
                "user": req.launch.ssh_user or status["ssh_user"],
                "key_reference": req.launch.key_name
                or status.get("key_reference")
                or req.launch.ssh_key_id
                or req.launch.ssh_key_names
                or req.launch.sshkey_ids
                or "scheduler-managed",
            },
            "inference": {
                "base_url": f"http://{hostname}:{req.inference_port}{req.inference_path}",
                "status": "unverified",
                "protocol": "http",
            }
            if req.inference_port
            else None,
            "connection_status": "provider_ready",
            "delivered_at": timestamp(),
        }

    def cancel(self, order_id):
        if not self.store.transition(order_id, "cancelled", expected={"queued", "planned"}):
            raise ValueError("order_cannot_be_cancelled_use_release_for_instances")
        return order_public(self.store.get_order(order_id))

    def release(self, order_id):
        order = self.store.get_order(order_id)
        if order["state"] in {"released", "releasing"}:
            return order_public(order)
        if not order["instance_id"] or order["state"] not in {
            "provisioning",
            "ready",
            "lost",
            "preempted",
            "release_failed",
        }:
            raise ValueError("order_has_no_releasable_instance")
        if not self.settings.spotbot_live_orders_enabled:
            raise ValueError("live_orders_disabled")
        self.store.transition(order_id, "releasing", handoff=None, error=None, release_sent=0)
        return order_public(self.store.get_order(order_id))

    async def _release(self, order):
        if not self.settings.spotbot_live_orders_enabled:
            return
        provider = self.providers[order["offer"]["provider"]]
        try:
            if not order["release_sent"]:
                self.store.ensure_ownership()
                await provider.delete(order["instance_id"])
                self.store.transition(order["id"], "releasing", release_sent=1, error=None)
                return
            status = await provider.inspect(order["instance_id"])
            if status.get("deleted") or status.get("status") in {"deleted", "terminated"}:
                self.store.transition(order["id"], "released", error=None)
        except ProviderError as exc:
            if exc.code == "http_404":
                self.store.transition(order["id"], "released", error=None)
            elif exc.retryable or exc.ambiguous:
                self.store.transition(order["id"], "releasing", error=exc.code)
            else:
                self.store.transition(order["id"], "release_failed", error=exc.code)

    async def reconcile(self, order_id, instance_id):
        # Operator identifies the resource by deterministic name after an ambiguous POST.
        async with self.worker_lock:
            order = self.store.get_order(order_id)
            if order["state"] != "needs_reconciliation":
                raise ValueError("order_does_not_need_reconciliation")
            provider = self.providers[order["offer"]["provider"]]
            status = await provider.inspect(instance_id)
            if status.get("name") != "spotbot-" + order_id:
                raise ValueError("instance_name_does_not_match_order")
            self.store.transition(order_id, "provisioning", instance_id=instance_id, error=None)
            return order_public(self.store.get_order(order_id))

    async def _deliver_events(self):
        url = self.settings.spotbot_gateway_webhook_url
        if not url:
            return
        secret = self.settings.spotbot_gateway_webhook_secret.get_secret_value()
        for event in self.store.events(pending=True):
            body = dump(event["payload"]).encode()
            sent_at = str(int(time.time()))
            signature = hmac.new(
                secret.encode(), sent_at.encode() + b"." + body, hashlib.sha256
            ).hexdigest()
            headers = {
                "Content-Type": "application/json",
                "X-SpotBot-Event-ID": event["id"],
                "X-SpotBot-Timestamp": sent_at,
                "X-SpotBot-Signature": "sha256=" + signature,
            }
            try:
                response = await self.client.post(url, content=body, headers=headers)
                delivered = 200 <= response.status_code < 300
            except httpx.HTTPError:
                delivered = False
            self.store.webhook_result(event["id"], delivered, event["attempts"] + 1)

    async def run(self):
        last_collect = 0.0
        while True:
            try:
                if (
                    time.monotonic() - last_collect
                    >= self.settings.spotbot_collect_interval_seconds
                ):
                    await self.collect()
                    last_collect = time.monotonic()
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Background cycle failed; will retry")
            await asyncio.sleep(self.settings.spotbot_worker_interval_seconds)
