"""Native vendor adapters. Mutating requests are never automatically replayed."""

import asyncio
import base64
import json
import time
from decimal import Decimal
from urllib.parse import quote, urlparse

import httpx

from spotbot.config import Settings
from spotbot.models import LaunchOptions, Offer, gpu_model


class ProviderError(Exception):
    def __init__(self, code: str, *, retryable: bool = False, ambiguous: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.ambiguous = ambiguous


def dec(value) -> Decimal:
    return Decimal(str(value))


def path_id(value: str) -> str:
    return quote(value, safe="")


def validate_launch(launch: LaunchOptions, supported: set[str]):
    supplied = {k for k, value in launch.model_dump().items() if value not in (None, [], {})}
    unsupported = supplied - supported - {"ssh_user"}
    if unsupported:
        raise ValueError(
            "Unsupported launch options for this provider: " + ", ".join(sorted(unsupported))
        )


class Provider:
    name: str
    base_url: str
    read_interval = 1.0
    create_interval = 1.0

    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings, self.client = settings, client
        self._lock = asyncio.Lock()
        self._last_request = 0.0
        self._last_create = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.settings.key(self.name))

    def headers(self) -> dict:
        key = self.settings.key(self.name)
        if self.name == "shadeform":
            return {"X-API-KEY": key} if key else {}
        return {"Authorization": f"Bearer {key}"} if key else {}

    async def request(self, method: str, path: str, *, payload=None, params=None):
        mutation = method != "GET"
        if (mutation or self.name != "vultr") and not self.configured:
            raise ProviderError("missing_api_key")
        # Serialize per provider to honor vendor rate limits, including concurrent collection.
        async with self._lock:
            delay = self.read_interval - (time.monotonic() - self._last_request)
            if method == "POST":
                delay = max(delay, self.create_interval - (time.monotonic() - self._last_create))
            if delay > 0:
                await asyncio.sleep(delay)
            self._last_request = time.monotonic()
            if method == "POST":
                self._last_create = self._last_request
            try:
                response = await self.client.request(
                    method,
                    self.base_url + path,
                    headers=self.headers(),
                    json=payload,
                    params=params,
                )
            except httpx.HTTPError as exc:
                raise ProviderError(
                    "transport_error", retryable=not mutation, ambiguous=mutation
                ) from exc
        if response.status_code >= 400:
            code = f"http_{response.status_code}"
            # Only vendor machine-readable capacity errors are safe to retry after POST.
            try:
                body = response.json()
                vendor_code = (
                    body.get("error", {}).get("code", "")
                    if isinstance(body.get("error"), dict)
                    else ""
                )
            except (ValueError, AttributeError):
                vendor_code = ""
            capacity = vendor_code in {
                "instance-operations/launch/insufficient-capacity",
                "insufficient-capacity",
            }
            if capacity:
                code = "insufficient_capacity"
            raise ProviderError(
                code,
                retryable=capacity
                or response.status_code == 429
                or (not mutation and response.status_code >= 500),
                ambiguous=mutation and (response.status_code >= 500 or response.status_code == 408),
            )
        if response.status_code == 204 or not response.content:
            return {}
        try:
            return json.loads(response.text, parse_float=Decimal)
        except ValueError as exc:
            raise ProviderError("invalid_json", ambiguous=mutation) from exc

    async def collect(self) -> list[Offer]:
        raise NotImplementedError

    def plan(self, offer: Offer, launch: LaunchOptions, name: str, *, max_price_hourly=None) -> dict:
        raise NotImplementedError

    async def create(self, plan: dict) -> str:
        raise NotImplementedError

    async def inspect(self, instance_id: str) -> dict:
        raise NotImplementedError

    async def delete(self, instance_id: str):
        raise NotImplementedError


class LambdaProvider(Provider):
    name = "lambda"
    base_url = "https://cloud.lambda.ai/api/v1"
    create_interval = 12.1

    async def collect(self):
        result = await self.request("GET", "/instance-types")
        offers = []
        for item in result["data"].values():
            t = item["instance_type"]
            spec = t["specs"]
            # The live catalog includes CPU-only types; this service indexes GPU capacity.
            if spec["gpus"] == 0:
                continue
            regions = item["regions_with_capacity_available"]
            for region in regions or [{"name": "unavailable"}]:
                offers.append(
                    Offer(
                        provider=self.name,
                        cloud=self.name,
                        sku=t["name"],
                        region=region["name"],
                        market="on_demand",
                        gpu_model=gpu_model(t["gpu_description"]),
                        gpu_description=t["gpu_description"],
                        gpu_count=spec["gpus"],
                        vcpus=spec["vcpus"],
                        memory_gb=spec["memory_gib"],
                        storage_gb=spec["storage_gib"],
                        memory_unit="GiB",
                        storage_unit="GiB",
                        price_hourly=dec(t["price_cents_per_hour"]) / 100,
                        available=bool(regions),
                        source_url=self.base_url + "/instance-types",
                        details={"memory_unit_source": "GiB", "storage_unit_source": "GiB"},
                    )
                )
        return offers

    def plan(self, offer, launch, name, *, max_price_hourly=None):
        validate_launch(launch, {"ssh_key_names", "cloud_init"})
        if offer.market != "on_demand":
            raise ValueError("Lambda public API exposes on-demand instances only")
        if len(launch.ssh_key_names) != 1:
            raise ValueError(
                "Lambda requires exactly one launch.ssh_key_names entry registered in your account"
            )
        payload = {
            "region_name": offer.region,
            "instance_type_name": offer.sku,
            "ssh_key_names": launch.ssh_key_names,
            "name": name,
        }
        if launch.cloud_init:
            payload["user_data"] = launch.cloud_init
        return {"method": "POST", "path": "/instance-operations/launch", "payload": payload}

    async def create(self, plan):
        result = await self.request(plan["method"], plan["path"], payload=plan["payload"])
        try:
            ids = result["data"]["instance_ids"]
            if len(ids) != 1:
                raise ValueError
            return ids[0]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("invalid_create_response", ambiguous=True) from exc

    async def inspect(self, instance_id):
        d = (await self.request("GET", f"/instances/{path_id(instance_id)}"))["data"]
        return {
            "status": d["status"],
            "ready": d["status"] == "active" and bool(d.get("ip")),
            "terminated": d["status"] in {"terminated", "terminating"},
            "name": d.get("name"),
            "preempted": d["status"] == "preempted",
            "ip": d.get("ip"),
            "ssh_port": 22,
            "ssh_user": "ubuntu",
        }

    async def delete(self, instance_id):
        await self.request(
            "POST", "/instance-operations/terminate", payload={"instance_ids": [instance_id]}
        )


class ShadeformProvider(Provider):
    name = "shadeform"
    base_url = "https://api.shadeform.ai/v1"

    async def collect(self):
        result = await self.request("GET", "/instances/types")
        offers = []
        for t in result["instance_types"]:
            c = t["configuration"]
            if c["num_gpus"] == 0:
                continue
            for a in t["availability"]:
                market = a.get("rental_type", "on_demand")
                if market not in {"on_demand", "spot"}:
                    continue
                # Top level = CENTS; spot availability.hourly_price = DOLLARS.
                price = dec(a["hourly_price"]) if market == "spot" else dec(t["hourly_price"]) / 100
                offers.append(
                    Offer(
                        provider=self.name,
                        cloud=t["cloud"],
                        sku=t["shade_instance_type"],
                        region=a["region"],
                        market=market,
                        gpu_model=gpu_model(c["gpu_type"]),
                        gpu_description=c["gpu_type"],
                        gpu_count=c["num_gpus"],
                        vcpus=c["vcpus"],
                        memory_gb=c["memory_in_gb"],
                        storage_gb=c["storage_in_gb"],
                        price_hourly=price,
                        available=a["available"],
                        source_url=self.base_url + "/instances/types",
                        details={
                            "cloud_instance_type": t["cloud_instance_type"],
                            "vram_per_gpu_gb": c.get("vram_per_gpu_in_gb"),
                            "os_options": c.get("os_options", []),
                            "interconnect": c.get("interconnect"),
                        },
                    )
                )
        return offers

    def plan(self, offer, launch, name, *, max_price_hourly=None):
        validate_launch(launch, {"ssh_key_id", "os", "cloud_init"})
        if not launch.ssh_key_id:
            raise ValueError("Shadeform requires launch.ssh_key_id")
        payload = {
            "cloud": offer.cloud,
            "region": offer.region,
            "shade_instance_type": offer.sku,
            "shade_cloud": True,
            "name": name,
            "rental_type": offer.market,
            "ssh_key_id": launch.ssh_key_id,
        }
        if launch.os:
            options = offer.details.get("os_options", [])
            if options and launch.os not in options:
                raise ValueError("OS is not offered for this Shadeform instance type")
            payload["os"] = launch.os
        if launch.cloud_init:
            payload["launch_configuration"] = {
                "type": "script",
                "script_configuration": {
                    "base64_script": base64.b64encode(launch.cloud_init.encode()).decode()
                },
            }
        return {"method": "POST", "path": "/instances/create", "payload": payload}

    async def create(self, plan):
        result = await self.request(plan["method"], plan["path"], payload=plan["payload"])
        if not isinstance(result.get("id"), str) or not result["id"]:
            raise ProviderError("invalid_create_response", ambiguous=True)
        return result["id"]

    async def inspect(self, instance_id):
        d = await self.request("GET", f"/instances/{path_id(instance_id)}/info")
        return {
            "status": d["status"],
            "ready": d["status"] == "active" and bool(d.get("ip")),
            "terminated": d["status"] in {"deleted", "deleting"},
            "preempted": d.get("status_details") == "preempted",
            "name": d.get("name"),
            "ip": d.get("ip"),
            "ssh_port": d.get("ssh_port", 22),
            "ssh_user": d.get("ssh_user", "shadeform"),
        }

    async def delete(self, instance_id):
        await self.request("POST", f"/instances/{path_id(instance_id)}/delete")


class TensorDockProvider(Provider):
    name = "tensordock"
    base_url = "https://dashboard.tensordock.com/api/v2"

    async def collect(self):
        result = await self.request("GET", "/locations")
        offers = []
        cpu = self.settings.spotbot_tensordock_vcpus
        ram = self.settings.spotbot_tensordock_ram_gb
        disk = self.settings.spotbot_tensordock_storage_gb
        for loc in result["data"]["locations"]:
            for g in loc["gpus"]:
                p, r = g["pricing"], g["resources"]
                price = (
                    dec(g["price_per_hr"])
                    + cpu * dec(p["per_vcpu_hr"])
                    + ram * dec(p["per_gb_ram_hr"])
                    + disk * dec(p["per_gb_storage_hr"])
                )
                has_ip = g["network_features"]["dedicated_ip_available"]
                available = (
                    g["max_count"] >= 1
                    and r["max_vcpus"] >= cpu
                    and r["max_ram_gb"] >= ram
                    and r["max_storage_gb"] >= disk
                )
                offers.append(
                    Offer(
                        provider=self.name,
                        cloud=self.name,
                        sku=g["v0Name"],
                        region=loc["id"],
                        market="on_demand",
                        gpu_model=gpu_model(g["displayName"]),
                        gpu_description=g["displayName"],
                        gpu_count=1,
                        vcpus=cpu,
                        memory_gb=ram,
                        storage_gb=disk,
                        price_hourly=price,
                        price_kind="estimated",
                        available=available,
                        orderable=has_ip,
                        source_url=self.base_url + "/locations",
                        details={
                            "location": {k: loc.get(k) for k in ["city", "country", "tier"]},
                            "gpu_price_hourly": str(g["price_per_hr"]),
                            "component_pricing": p,
                            "dedicated_ip_available": has_ip,
                            "note": "v2 location quote; spot bidding and port-forward-only hosts require separate integration",
                        },
                    )
                )
        return offers

    def plan(self, offer, launch, name, *, max_price_hourly=None):
        validate_launch(launch, {"ssh_public_key", "os", "tensordock_cloud_init"})
        if offer.market != "on_demand":
            raise ValueError(
                "TensorDock v2 spot create schema is not verified; no on-demand fallback"
            )
        if not offer.orderable:
            raise ValueError("TensorDock v2 adapter currently requires a dedicated IP")
        if not launch.ssh_public_key or not launch.ssh_public_key.startswith(("ssh-", "ecdsa-")):
            raise ValueError("TensorDock requires launch.ssh_public_key")
        attrs = {
            "name": name,
            "type": "virtualmachine",
            "image": launch.os or "ubuntu2404",
            "resources": {
                "vcpu_count": offer.vcpus,
                "ram_gb": int(offer.memory_gb),
                "storage_gb": int(offer.storage_gb),
                "gpus": {offer.sku: {"count": offer.gpu_count}},
            },
            "location_id": offer.region,
            "useDedicatedIp": True,
            "ssh_key": launch.ssh_public_key,
        }
        if launch.tensordock_cloud_init:
            attrs["cloud_init"] = launch.tensordock_cloud_init
        return {
            "method": "POST",
            "path": "/instances",
            "payload": {"data": {"type": "virtualmachine", "attributes": attrs}},
        }

    async def create(self, plan):
        result = await self.request(plan["method"], plan["path"], payload=plan["payload"])
        instance_id = result.get("data", {}).get("id")
        if not isinstance(instance_id, str) or not instance_id:
            raise ProviderError("invalid_create_response", ambiguous=True)
        return instance_id

    async def inspect(self, instance_id):
        d = await self.request("GET", f"/instances/{path_id(instance_id)}")
        d = d.get("data", d)
        d = d.get("attributes", d)
        status = d["status"].lower()
        port = next(
            (
                p["external_port"]
                for p in d.get("portForwards", [])
                if int(p["internal_port"]) == 22
            ),
            22,
        )
        return {
            "status": status,
            "ready": status == "running" and bool(d.get("ipAddress")),
            "terminated": status in {"deleted", "terminated"},
            "name": d.get("name"),
            "ip": d.get("ipAddress"),
            "ssh_port": port,
            "ssh_user": "user",
        }

    async def delete(self, instance_id):
        await self.request("DELETE", f"/instances/{path_id(instance_id)}")


class VultrProvider(Provider):
    name = "vultr"
    base_url = "https://api.vultr.com/v2"

    async def collect(self):
        plans, cursor, seen = [], None, set()
        while True:
            params = {"type": "vcg", "per_page": 500}
            if cursor:
                params["cursor"] = cursor
            result = await self.request("GET", "/plans", params=params)
            plans.extend(result["plans"])
            cursor = result.get("meta", {}).get("links", {}).get("next")
            if not cursor:
                break
            # Vendor documentation uses cursors; accept same-origin next URLs too.
            if cursor.startswith("https://"):
                from urllib.parse import parse_qs

                u = urlparse(cursor)
                if u.netloc != "api.vultr.com":
                    raise ProviderError("invalid_pagination")
                cursor = parse_qs(u.query).get("cursor", [None])[0]
            if not cursor or cursor in seen or len(seen) >= 100:
                raise ProviderError("invalid_pagination")
            seen.add(cursor)
        offers = []
        for p in plans:
            description = p["gpu_type"]
            for region in p["locations"] or ["unavailable"]:
                local = p.get("location_cost", {}).get(region, {})
                if not isinstance(local, dict):
                    raise ProviderError("unrecognized_location_cost")
                for market, flag, price_key in [
                    ("on_demand", "deploy_ondemand", "hourly_cost"),
                    ("spot", "deploy_preemptible", "hourly_cost_preemptible"),
                ]:
                    if not p.get(flag, market == "on_demand"):
                        continue
                    price = local.get(price_key, p.get(price_key))
                    if price is None:
                        raise ProviderError("missing_hourly_price")
                    offers.append(
                        Offer(
                            provider=self.name,
                            cloud=self.name,
                            sku=p["id"],
                            region=region,
                            market=market,
                            gpu_model=gpu_model(description),
                            gpu_description=description,
                            gpu_count=p["gpu_count"],
                            vcpus=p["vcpu_count"],
                            memory_gb=dec(p["ram"]) / 1024,
                            memory_unit="GiB",
                            storage_gb=p["disk"],
                            price_hourly=price,
                            available=bool(p["locations"]),
                            # Spot catalog is supported; mutating schema needs account verification.
                            orderable=market == "on_demand",
                            source_url=self.base_url + "/plans?type=vcg",
                            details={
                                "vram_total_gb": p.get("gpu_vram_gb"),
                                "pricing_scope": "regional" if local else "base",
                                "note": "preemptible create schema not verified"
                                if market == "spot"
                                else "",
                            },
                        )
                    )
        return offers

    def plan(self, offer, launch, name, *, max_price_hourly=None):
        validate_launch(launch, {"sshkey_ids", "os_id", "cloud_init"})
        if offer.market == "spot":
            raise ValueError(
                "Vultr preemptible create schema is not verified; no on-demand fallback"
            )
        if not launch.os_id or not launch.sshkey_ids:
            raise ValueError("Vultr requires launch.os_id and launch.sshkey_ids")
        payload = {
            "region": offer.region,
            "plan": offer.sku,
            "label": name,
            "os_id": launch.os_id,
            "sshkey_id": launch.sshkey_ids,
            "block_devices": [],
            "backups": "disabled",
            "activation_email": False,
        }
        if launch.cloud_init:
            payload["user_data"] = base64.b64encode(launch.cloud_init.encode()).decode()
        return {"method": "POST", "path": "/instances", "payload": payload}

    async def create(self, plan):
        result = await self.request(plan["method"], plan["path"], payload=plan["payload"])
        instance_id = result.get("instance", {}).get("id")
        if not isinstance(instance_id, str) or not instance_id:
            raise ProviderError("invalid_create_response", ambiguous=True)
        return instance_id

    async def inspect(self, instance_id):
        d = (await self.request("GET", f"/instances/{path_id(instance_id)}"))["instance"]
        ip = d.get("main_ip")
        ready = (
            d["status"] == "active"
            and d.get("server_status") == "ok"
            and d.get("power_status") == "running"
        )
        return {
            "status": d["status"],
            "ready": ready and ip not in {None, "", "0.0.0.0"},
            "terminated": d["status"] in {"terminated", "deleted"},
            "name": d.get("label"),
            "ip": ip,
            "ssh_port": 22,
            "ssh_user": "root",
        }

    async def delete(self, instance_id):
        await self.request("DELETE", f"/instances/{path_id(instance_id)}")


def providers(settings: Settings, client: httpx.AsyncClient) -> dict[str, Provider]:
    from spotbot.aws_provider import AWSProvider

    return {
        p.name: p
        for p in [
            LambdaProvider(settings, client),
            TensorDockProvider(settings, client),
            VultrProvider(settings, client),
            ShadeformProvider(settings, client),
            AWSProvider(settings, client),
        ]
    }
