"""OpenNEXT Spot market backed by the SpotOrderBot API.

- Offers: orderable AWS Spot offers in rental Regions, one row per Region and instance type
  (the cheapest zone), shaped as OpenNEXT public supply rows.
- Purchases: a Spot purchase becomes a protected rental for the customer's public key. The
  paid hours start at delivery (`service_seconds`), and the price ceiling is the listed price
  plus 20%.
- Instances: a customer's rentals as OpenNEXT workspace instances.

Prices follow the web app's arithmetic exactly (JavaScript `Math.round` on IEEE doubles), so
the server reproduces the totals the customer confirmed.
"""

import asyncio
import math
import time
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

import httpx
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from spotbot.opennext_autopilot import summary_view
from spotbot.opennext_pricing import snapshot
from spotbot.rental_models import gpu_memory_sufficient, nominal_gpu_gb, valid_public_key
from spotbot.rentals import at, dump

CACHE_SECONDS = 60
PAGE = 1000
PRICE_CAP = Decimal("1.2")  # Spot price ceiling: the listed instance price plus 20%.
ACQUISITION = timedelta(minutes=60)
MAX_HOURS = 720
MIN_HOURS = 1  # Usage is billed per minute with a one-hour minimum, so shorter orders are refused.
ROOT_GIB = 100
FINAL_RETENTION_SECONDS = 604800  # The RFQ default backup retention after the rental ends.
BOT_TIMEOUT = 15  # Seconds; page loads must not wait on a slow bot API for long.
PENDING = {"QUEUED", "WAITING_CAPACITY", "PROVISIONING", "VERIFYING", "DELIVERING"}


def js_int(value):
    """JavaScript `Math.round` for the non-negative values prices use."""
    return math.floor(value + 0.5)


def js_round(value):
    """The web app's `round`: `Math.round(value * 100) / 100`."""
    return js_int(value * 100) / 100


def checkout_totals(instance_hourly, hours, service_fee_bps=0):
    """Retail duration subtotal in cents; an explicit frozen fee preserves old agreements."""
    hourly = js_int(instance_hourly * 100)
    base = js_int(hourly * js_int(hours * 100) / 100)
    fee = js_int(base * service_fee_bps / 10000)
    return {
        "currency": "USD",
        "durationHours": hours,
        "hourlyCents": hourly,
        "baseCents": base,
        "feeCents": fee,
        "totalCents": base + fee,
    }


def nominal_gb(mib):
    """Marketed per-GPU memory: 16384 MiB is a 16 GB T4, 22888 MiB a 24 GB L4."""
    return nominal_gpu_gb(mib)


def offer_id(region, sku):
    return f"spotbot-{region}-{sku}"


def eligible(offer, regions):
    d = offer.get("details") or {}
    memory = [g.get("MemoryInfo", {}).get("SizeInMiB", 0) for g in d.get("gpu_specifications", [])]
    return (
        offer.get("provider") == "aws"
        and offer.get("market") == "spot"
        and offer.get("can_attempt") is True
        and offer.get("region") in regions
        # Fractional (logical) GPUs are not whole servers.
        and d.get("gpu_count_kind") == "physical"
        # Rentals start from the Region's enrolled x86_64 base image; Arm servers cannot use it.
        and d.get("architecture") == "x86_64"
        and isinstance(offer.get("gpu_count"), int)
        and offer["gpu_count"] >= 1
        and bool(memory)
        and min(memory) > 0
        and Decimal(str(offer.get("price_hourly"))) > 0
    )


class Offer:
    """One public Spot row and the private launch requirements behind it."""

    def __init__(self, offer, policy=None, *, frozen=None):
        self.raw = offer  # Kept with Direct Pay orders, which provision after the offer may leave.
        d = offer["details"]
        mib = min(g["MemoryInfo"]["SizeInMiB"] for g in d["gpu_specifications"])
        self.region, self.sku = offer["region"], offer["sku"]
        self.gpu_model, self.gpu_count = offer["gpu_model"], offer["gpu_count"]
        self.vcpus, self.architecture = offer["vcpus"], d["architecture"]
        self.memory_gib = int(Decimal(str(offer["memory_gb"])))
        self.gpu_memory = nominal_gb(mib)
        if not gpu_memory_sufficient(mib, self.gpu_memory):
            raise ValueError("gpu_memory_unmatched")
        # The wholesale launch ceiling and customer retail price use independent values.
        self.pricing = frozen or snapshot(
            offer, policy or {"version": 0, "defaultMarkupBps": 0, "rules": []}
        )
        self.source_cents = self.pricing["sourceCents"]
        self.cents = self.pricing["retailCents"]
        self.id = offer_id(self.region, self.sku)
        per_gpu = self.cents / 100 / self.gpu_count
        self.instance_hourly = js_round(per_gpu * self.gpu_count)
        if js_int(self.instance_hourly * 100) != self.cents:
            raise ValueError("price_not_representable")
        self.row = {
            "id": self.id,
            "kind": "rental",
            "side": "supply",
            "term": "Spot",
            "model": self.gpu_model,
            "title": f"{self.gpu_count} × {self.gpu_model}",
            "region": self.region,
            "gpuCount": self.gpu_count,
            "vcpu": self.vcpus,
            "memory": self.gpu_memory,
            "perGpuHourly": per_gpu,
            "listedAt": offer["observed_at"],
            "status": "Published",
            "serverRecord": True,
            "agentStatus": "Succeeded",
            "sourceType": "spotbot",
        }


def build_offers(offers, regions, policy=None, accounts=None):
    cheapest = {}
    for offer in offers:
        if (
            accounts is not None
            and (offer.get("details") or {}).get("aws_account", "default") not in accounts
        ):
            continue
        if not eligible(offer, regions):
            continue
        key = (offer["region"], offer["sku"])
        if key not in cheapest or Decimal(str(offer["price_hourly"])) < Decimal(
            str(cheapest[key]["price_hourly"])
        ):
            cheapest[key] = offer
    result = {}
    for key in sorted(cheapest):
        try:
            item = Offer(cheapest[key], policy)
        except (KeyError, TypeError, ValueError, ArithmeticError):
            continue
        result[item.id] = item
    return result


class ExpectedPricing(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    currency: Literal["USD"]
    durationHours: float
    hourlyCents: StrictInt
    baseCents: StrictInt
    feeCents: StrictInt
    totalCents: StrictInt


class PurchaseRequest(BaseModel):
    """`POST /api/marketplace/spot-purchases` body, as the web app's checkout sends it."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    pricingVersion: Literal["duration-v1"]
    offerId: str = Field(min_length=1, max_length=200)
    durationHours: float = Field(ge=MIN_HOURS, le=MAX_HOURS)
    expectedPricing: ExpectedPricing
    # Optional: keys can be set later from the instance (`PUT .../ssh-keys`).
    sshPublicKey: str | None = Field(None, max_length=4096)
    idempotencyKey: str = Field(min_length=1, max_length=100)
    inferencePresetId: str | None = Field(None, max_length=100)
    inferenceBillingAcknowledged: bool = False

    @field_validator("idempotencyKey")
    @classmethod
    def customer_key(cls, value):
        if value.startswith("direct-pay:"):
            raise ValueError("reserved_payment_reference")
        return value

    @field_validator("durationHours")
    @classmethod
    def hundredths(cls, value):
        if abs(value * 100 - js_int(value * 100)) > 1e-6:
            raise ValueError("duration_has_more_than_two_decimals")
        return value

    @field_validator("sshPublicKey")
    @classmethod
    def public_key(cls, value):
        if value is None or not value.strip():
            return None
        if not valid_public_key(value):
            raise ValueError("invalid_ssh_public_key")
        return value.strip()


def customer_ref(user_id):
    return "opennext:" + user_id


def order_reference(user_id, key):
    """Stable bot RFQ and idempotency reference for one customer purchase attempt."""
    return "opennext-" + str(uuid5(NAMESPACE_URL, dump(["opennext-spot", user_id, key])))


def rfq_for(offer, purchase, user_id, now, storage_rate):
    reference = order_reference(user_id, purchase.idempotencyKey)
    hours = Decimal(str(purchase.durationHours))
    cap = Decimal(offer.source_cents) * PRICE_CAP / 100
    deadline = now + ACQUISITION
    # Safety bound for the bot, not a charge: the ceiling for the whole duration plus storage
    # (root disk during the rental and its final backup retention), with margin.
    seconds = hours * 3600 + Decimal(int(ACQUISITION.total_seconds()) + FINAL_RETENTION_SECONDS)
    model = offer.pricing.get("inference")
    storage = (
        Decimal(ROOT_GIB + (model["disk_gib"] if model else 0))
        * storage_rate
        * seconds
        / Decimal(2592000)
    )
    budget = (cap * hours * Decimal("1.1") + storage * 2 + 1).quantize(
        Decimal("0.01"), ROUND_CEILING
    )
    result = {
        "rfq_id": reference,
        "procurement_account": offer.raw["details"].get("aws_account", "default"),
        "rfq_version": 1,
        "upstream_order_id": reference,
        "regions": [offer.region],
        "instance_types": [offer.sku],
        "gpu_model": offer.gpu_model,
        "gpu_count": offer.gpu_count,
        "min_gpu_memory_gib": offer.gpu_memory,
        "min_vcpus": offer.vcpus,
        "min_memory_gib": max(1, offer.memory_gib),
        "architecture": offer.architecture,
        "root_volume_gib": ROOT_GIB,
        "price_unit": "instance_hour",
        "max_price_hourly": str(cap),
        "budget_usd": str(budget),
        "acquisition_deadline": deadline.isoformat(),
        "expires_at": (deadline + timedelta(seconds=int(hours * 3600))).isoformat(),
        "service_seconds": int(hours * 3600),
        "ssh_public_key": purchase.sshPublicKey,
        "ssh_user": "ubuntu",
        "customer_ref": customer_ref(user_id),
    }
    if model:
        result.update(
            inference=model,
            retail_hourly_cents=offer.cents,
            http_port=8000,
            http_health_path="/health",
            data_disks=[dict(device="/dev/sdf", size_gib=model["disk_gib"])],
        )
        if offer.pricing.get("initialImageIds"):
            result["initial_image_ids"] = dict(offer.pricing["initialImageIds"])
    return result


def purchased(rental):
    """Listed instance price, hours and offer of a rental created from a purchase."""
    rfq = rental["rfq"]
    cents = rfq.get("retail_hourly_cents") or int(
        Decimal(rfq["max_price_hourly"]) / PRICE_CAP * 100
    )
    # Earlier purchases have no `service_seconds`; their window ran from the acquisition deadline.
    seconds = (
        (rfq.get("funding") or {}).get("purchased_seconds") or rfq.get("service_seconds")
        or (at(rfq["expires_at"]) - at(rfq["acquisition_deadline"])).total_seconds()
    )
    return {
        "cents": cents,
        "hours": round(seconds / 36) / 100,
        "offerId": offer_id(rfq["regions"][0], (rfq.get("instance_types") or [""])[0]),
    }


def instance_status(row):
    state = row["state"]
    if state == "ACTIVE":
        return "active"
    if state in {"ENDING", "CLOSED"}:
        return "ended"
    # A replacement after an interruption reconnects; a first acquisition is pending. The
    # generation counts launch attempts, so only the bot's recovery marker tells them apart.
    if state == "RECOVERING" or (state in PENDING and row.get("recovery_started_at")):
        return "recovering"
    return "pending" if state in PENDING else state.lower()


def interruptions(row):
    """Service breaks the customer did not ask for, oldest first.

    Each is `{interruptedAt, reconnectedAt}`; `reconnectedAt` is None while a replacement is
    still being prepared or when the order ended before one was ready.
    """
    periods = row.get("service_intervals") or []
    ended = row["state"] in {"ENDING", "CLOSED"} or row.get("end_requested")
    result = []
    for n, period in enumerate(periods):
        if not period["end"]:
            continue
        last = n == len(periods) - 1
        reason = period.get("end_reason")
        # Periods recorded before end reasons existed: only the final one can be an end.
        if reason == "ended" or (reason is None and last and ended):
            continue
        result.append(
            {
                "interruptedAt": period["end"],
                "reconnectedAt": None if last else periods[n + 1]["start"],
            }
        )
    return result


def instance_view(row, ssh=None, billing=None):
    """A customer's rental as an OpenNEXT workspace instance, without server addresses.

    `usage` lists the periods the customer had a running server (for the usage chart),
    `history` the interruptions they did not ask for, and `billing` what the order costs.
    """
    rfq, bought = row["rfq"], purchased(row)
    periods = row.get("service_intervals") or []
    if not periods and row.get("delivering_at"):
        # Delivered before service periods were recorded: one period from the handoff.
        periods = [{"start": row["delivering_at"], "end": row.get("closed_at")}]
    status = instance_status(row)
    connection = row.get("connection") or {}
    ready = status == "active" and bool(ssh)
    result = {
        "id": row["id"],
        "name": f"{rfq['gpu_count']} × {rfq['gpu_model']}",
        "model": rfq["gpu_model"],
        "region": connection.get("region") or rfq["regions"][0],
        "term": "Spot",
        "count": rfq["gpu_count"],
        "rate": round(
            ((billing or {}).get("hourlyCents") or bought["cents"]) / 100 / rfq["gpu_count"], 4
        ),
        "status": status,
        "connectionStatus": "connected" if ready else None,
        "orderId": row["id"],
        "durationHours": bought["hours"],
        "serviceStart": periods[0]["start"] if periods else None,
        "serviceEnd": rfq["expires_at"],
        "endedAt": row.get("closed_at"),
        "createdAt": row["created_at"],
        "sshHost": ssh["host"] if ready else None,
        "sshUser": ssh.get("user") if ready else None,
        "sshPort": ssh.get("port") if ready else None,
        "resaleAllowed": False,
        "usage": [{"start": p["start"], "end": p["end"]} for p in periods],
        "history": interruptions(row),
        "billing": billing,
        "autopilot": summary_view(row.get("task")),
        "endedBy": "autopilot" if str(row.get("end_cause", "")).startswith("task_") else None,
    }
    if row.get("inference"):
        result["inference"] = row["inference"]
    if rfq.get("funding"):
        result.update(pricingVersion="spot-hourly-v1", serviceEnd=None,
                      orderId=rfq["upstream_order_id"].removeprefix("opennext-"))
    return result


class SpotMarket:
    """Bot API access for OpenNEXT: catalog (cached), rentals and gateway connections."""

    def __init__(
        self,
        client,
        *,
        bot_url,
        token,
        tenant,
        regions,
        gateway_url="",
        gateway_token="",
        storage_rate=Decimal("0.15"),
        accounts=None,
    ):
        self.client, self.bot_url, self.token, self.tenant = (
            client,
            bot_url.rstrip("/"),
            token,
            tenant,
        )
        self.regions = set(regions)
        self.accounts = accounts
        self.gateway_url, self.gateway_token = gateway_url.rstrip("/"), gateway_token
        self.storage_rate = storage_rate
        self.pricing_policy = None
        self._offers, self._loaded, self._lock = {}, None, asyncio.Lock()
        self._model_offers = {}

    @classmethod
    def from_settings(cls, settings, client):
        if not settings or not settings.spotbot_opennext_bot_url:
            return None
        return cls(
            client,
            bot_url=settings.spotbot_opennext_bot_url,
            token=settings.spotbot_api_key.get_secret_value(),
            tenant=settings.spotbot_opennext_tenant,
            regions=settings.rental_regions,
            gateway_url=settings.spotbot_opennext_gateway_url,
            gateway_token=settings.spotbot_opennext_gateway_token.get_secret_value(),
            storage_rate=settings.spotbot_rental_storage_reserve_usd_gib_month,
            accounts=settings.opennext_aws_accounts,
        )

    async def bot(self, method, path, **kwargs):
        headers = {
            "Authorization": "Bearer " + self.token,
            "X-SpotBot-Tenant": self.tenant,
            **kwargs.pop("headers", {}),
        }
        kwargs.setdefault("timeout", BOT_TIMEOUT)
        return await self.client.request(method, self.bot_url + path, headers=headers, **kwargs)

    async def _catalog(self, refresh_prices):
        # Instance hardware is stable. Model reads can reuse its last snapshot even
        # while a separate public-price refresh is in flight.
        if not refresh_prices and self._loaded is not None:
            return [o.raw for o in self._offers.values()]
        async with self._lock:
            if self._loaded is None or (
                refresh_prices and time.monotonic() - self._loaded > CACHE_SECONDS
            ):
                values, offset = [], 0
                while True:
                    response = await self.bot(
                        "GET",
                        "/v1/prices/latest",
                        params=dict(
                            provider="aws",
                            market="spot",
                            can_attempt_only="true",
                            account_routes="true",
                            limit=PAGE,
                            offset=offset,
                        ),
                    )
                    response.raise_for_status()
                    body = response.json()
                    page = [o for g in body["groups"] for o in g["offers"]]
                    values += page
                    offset += PAGE
                    if not page or offset >= body["total"]:
                        break
                self._offers, self._loaded = (
                    build_offers(values, self.regions, accounts=self.accounts),
                    time.monotonic(),
                )
            return [o.raw for o in self._offers.values()]

    async def offers(self, *, with_quota=True, refresh_prices=True):
        values = await self._catalog(refresh_prices)
        # Model compatibility uses the cached hardware catalog, not live account quota.
        # Release the catalog lock before slow quota reads so they cannot block it.
        policy = await self.pricing_policy.get() if self.pricing_policy else None
        result = build_offers(values, self.regions, policy, self.accounts)
        ids = [o.raw["offer_id"] for o in result.values() if o.raw.get("offer_id")]
        quotas = {}
        if with_quota and ids:
            try:
                response = await self.bot("POST", "/v1/capacity/availability", json=ids)
                response.raise_for_status()
                quotas = response.json()["offers"]
            except (httpx.HTTPError, KeyError, ValueError):
                pass
        for item in result.values():
            item.row["quota"] = quotas.get(item.raw.get("offer_id")) or dict(
                maxInstances=None,
                maxGpus=None,
                usageKnown=False,
                capacityGuaranteed=False,
                capacityStatus="unknown",
                basis="quota_estimate",
            )
        return result

    async def preflight(self, doc):
        """Check the original server specification against live provider quota and price."""
        from types import SimpleNamespace

        from spotbot.models import utcnow

        purchase = SimpleNamespace(
            durationHours=doc["duration_hours"],
            idempotencyKey="preflight",
            sshPublicKey=doc.get("ssh_public_key"),
        )
        rules = rfq_for(
            Offer(doc["offer"], frozen=doc.get("pricing_snapshot")),
            purchase,
            doc["account"],
            utcnow(),
            self.storage_rate,
        )
        response = await self.bot("POST", "/v1/rentals/preflight", json={"rfq": rules}, timeout=60)
        response.raise_for_status()
        result = response.json()
        if result.get("confirmed") is not True or type(result.get("eligible")) is not bool:
            raise ValueError("invalid_provider_preflight")
        return result

    async def rentals(self, customer=None):
        """The tenant's rentals; with `customer`, only that customer's."""
        values, offset = [], 0
        while True:
            params = dict(limit=PAGE, offset=offset)
            if customer is not None:
                params["customer_ref"] = customer
            response = await self.bot("GET", "/v1/rentals", params=params)
            response.raise_for_status()
            body = response.json()
            values += body["items"]
            offset += PAGE
            if not body["items"] or offset >= body["total"]:
                break
        if customer is None:
            return values
        return [r for r in values if r.get("rfq", {}).get("customer_ref") == customer]

    async def find(self, user_id, reference):
        response = await self.bot(
            "GET",
            "/v1/rentals",
            params=dict(
                customer_ref=customer_ref(user_id),
                upstream_order_id=reference,
                limit=1,
            ),
        )
        response.raise_for_status()
        body = response.json()
        # A rolling upgrade can still reach an older bot that ignores query parameters.
        # Do not mistake its first tenant rental for a missing idempotent purchase.
        rows = (
            body["items"]
            if body.get("query_version") == 1
            else await self.rentals(customer_ref(user_id))
        )
        for rental in rows:
            if rental.get("rfq", {}).get("customer_ref") != customer_ref(user_id):
                continue
            if rental["rfq"].get("upstream_order_id") == reference:
                return rental
        return None

    async def owned(self, user_id, rental_id):
        from uuid import UUID

        try:
            rental_id = str(UUID(rental_id))
        except ValueError:
            return None
        response = await self.bot("GET", f"/v1/rentals/{rental_id}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        row = response.json()
        return row if row.get("rfq", {}).get("customer_ref") == customer_ref(user_id) else None

    async def keys(self, rental_id, keys=None):
        """The rental's customer key set; with `keys`, replace it first."""
        response = await (
            self.bot("GET", f"/v1/rentals/{rental_id}/ssh-keys")
            if keys is None
            else self.bot("PUT", f"/v1/rentals/{rental_id}/ssh-keys", json={"keys": keys})
        )
        if response.status_code == 409:
            raise ValueError(response.json().get("detail", "rental_ended"))
        response.raise_for_status()
        return response.json()

    async def release(self, rental_id):
        response = await self.bot("POST", f"/v1/rentals/{rental_id}/release")
        response.raise_for_status()
        return response.json()

    async def create(self, rfq):
        return await self.bot(
            "POST",
            "/v1/rentals",
            json={"rfq": rfq},
            headers={"Idempotency-Key": rfq["rfq_id"], "X-SpotBot-Quota-Admission": "true"},
        )

    async def prepare_offer(self, offer, preset_id):
        if not preset_id:
            return offer
        from spotbot.inference import InferenceSpec, priced

        response = await self.bot(
            "POST",
            "/v1/inference/selection",
            json=dict(offer_id=offer.raw["offer_id"], preset_id=preset_id),
        )
        response.raise_for_status()
        value = response.json()
        spec = InferenceSpec.model_validate(value["spec"])
        if spec.version != value["version"] or spec.preset_id != preset_id:
            raise ValueError("inference_selection_changed")
        return priced(offer, spec, self.storage_rate, initial_images=value.get("initial_image_ids"))

    async def inference_presets(self, offer):
        response = await self.bot(
            "GET", "/v1/inference/presets", params=dict(offer_id=offer.raw["offer_id"]), timeout=6
        )
        response.raise_for_status()
        return response.json()

    async def model_offer(self, reference):
        """Resolve one hardware row without fetching the complete price catalog."""
        cached = self._offers.get(reference) or self._model_offers.get(reference)
        if cached:
            return cached
        region = next((r for r in self.regions if reference.startswith(f"spotbot-{r}-")), None)
        if region is None:
            return None
        sku = reference.removeprefix(f"spotbot-{region}-")
        if not sku or len(sku) > 128:
            return None
        values, offset = [], 0
        while True:
            response = await self.bot("GET", "/v1/prices/latest", params=dict(
                provider="aws", market="spot", region=region, sku=sku,
                can_attempt_only="true", account_routes="true", limit=PAGE, offset=offset,
            ), timeout=6)
            response.raise_for_status()
            body = response.json()
            page = [row for group in body["groups"] for row in group["offers"]]
            values.extend(page)
            offset += PAGE
            if not page or offset >= body["total"]:
                break
        offer = build_offers(values, self.regions, accounts=self.accounts).get(reference)
        if offer:
            self._model_offers[reference] = offer
        return offer

    async def connection(self, rental_id):
        """The gateway's customer SSH entry point, once the gateway serves the rental."""
        if not self.gateway_url:
            return None
        try:
            response = await self.client.get(
                f"{self.gateway_url}/v1/gateway/rentals/{rental_id}/connection",
                headers={
                    "Authorization": "Bearer " + self.gateway_token,
                    "X-SpotBot-Tenant": self.tenant,
                },
                timeout=5,
            )
            body = response.json() if response.status_code == 200 else {}
        except (httpx.HTTPError, ValueError):
            return None
        ssh = body.get("ssh") or {}
        return ssh if body.get("ready") is True and ssh.get("host") and ssh.get("port") else None

    async def instances(self, user_id, rows=None, billing=None):
        """Instance views; `billing` maps a rental id to its Billing view."""
        rows = await self.rentals(customer_ref(user_id)) if rows is None else rows
        billing = billing or {}
        active = [r for r in rows if r["state"] == "ACTIVE"]
        ssh = dict(
            zip(
                [r["id"] for r in active],
                await asyncio.gather(*(self.connection(r["id"]) for r in active)),
                strict=True,
            )
        )
        return [instance_view(r, ssh.get(r["id"]), billing.get(r["id"])) for r in rows]
