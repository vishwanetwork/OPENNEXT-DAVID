"""Bounded GET-only collectors with explicit provenance and USD instance-hour units."""

import ast
import base64
import csv
import io
import math
import re
import uuid
from urllib.parse import urlsplit

from spotbot.config import Settings
from spotbot.models import timestamp
from spotbot.providers import TensorDockProvider, gpu_model

from .registry import SOURCES

MAX_BYTES = 12 * 1024 * 1024
MAX_RECORDS = 30000


class SourceError(ValueError):
    """Only fixed, credential-free messages may reach an operator."""


async def read(client, url, headers=None, *, accept="application/json"):
    # Callers choose a fixed source URL or a separately verified same-origin next link.
    async with client.stream(
        "GET",
        url,
        headers={"Accept": accept, **(headers or {})},
        timeout=30,
        follow_redirects=False,
    ) as response:
        if response.status_code in {401, 403}:
            raise SourceError(
                "The source denied access. Check read-only credentials and permissions."
            )
        if response.status_code == 429:
            raise SourceError("The source rate limit was reached. Retry later.")
        if response.status_code != 200:
            raise SourceError("The source could not return a price catalog.")
        data = bytearray()
        async for part in response.aiter_bytes():
            data.extend(part)
            if len(data) > MAX_BYTES:
                raise SourceError("The source response exceeds the supported catalog size.")
    return bytes(data)


def number(value):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a price")
    n = float(value)
    if not math.isfinite(n) or n <= 0:
        raise ValueError("Expected a positive finite number")
    return n


def quote(
    provider,
    sku,
    model,
    count,
    hourly,
    region,
    term,
    *,
    memory=None,
    cpu=None,
    kind=None,
    source_revision=None,
):
    count_value = number(count)
    if count_value != int(count_value) or count_value > 1024:
        raise ValueError("Invalid GPU count")
    count = int(count_value)
    price = number(hourly)
    identity = str(
        uuid.uuid5(uuid.NAMESPACE_URL, repr((provider, sku, str(model), count, region, term)))
    )
    source = SOURCES[provider]
    description = str(model) + " " + str(sku)
    form = next(
        (
            label
            for pattern, label in [(r"SXM", "SXM"), (r"PCIE", "PCIe"), (r"NVL72", "NVL72")]
            if re.search(pattern, description, re.I)
        ),
        None,
    )
    if memory is None:
        match = re.search(r"(?:^|[^0-9])(\d{2,3})\s*(?:GB|G)(?:$|[^A-Z])", description, re.I)
        memory = float(match[1]) if match else None
    return dict(
        formFactor=form,
        recordId=identity,
        provider=provider,
        gpuModel=gpu_model(str(model)),
        gpuDescription=str(model),
        gpuMemoryGb=memory,
        region=str(region),
        term=term,
        gpuCount=count,
        instanceType=str(sku),
        instanceHourly=price,
        perGpuHourly=price / count,
        currency="USD",
        observedAt=timestamp(),
        effectiveAt=None,
        sourceUrl=source.url,
        sourceType=source.mode,
        sourceRevision=source_revision,
        upstreamUpdatedAt=None,
        priceKind=kind or ("reference" if source.mode == "catalog_reference" else "quoted"),
        priceBasis="instance_hour",
        availability=None,
        orderable=False,
        vCpu=cpu,
    )


def catalog(provider, text, revision=None):
    reader = csv.DictReader(io.StringIO(text))
    required = {"InstanceType", "AcceleratorName", "AcceleratorCount", "Region", "Price"}
    if not required.issubset(reader.fieldnames or []):
        raise SourceError("The reference catalog schema changed; no prices were replaced.")
    rows = []
    for item in reader:
        if not item.get("AcceleratorName") or item.get("AcceleratorCount") in {"", "0"}:
            continue
        memory = None
        # SkyPilot uses a Python literal in GpuInfo, not consistently JSON.
        try:
            info = ast.literal_eval(item.get("GpuInfo") or "{}")
            memory = float(info["Gpus"][0]["MemoryInfo"]["SizeInMiB"]) / 1024
        except (ValueError, KeyError, IndexError, TypeError, SyntaxError):
            pass
        for term, field in [("On-demand", "Price"), ("Spot", "SpotPrice")]:
            if not item.get(field):
                continue
            try:
                rows.append(
                    quote(
                        provider,
                        item["InstanceType"],
                        item["AcceleratorName"],
                        item["AcceleratorCount"],
                        item[field],
                        item.get("AvailabilityZone") or item["Region"],
                        term,
                        memory=memory,
                        source_revision=revision,
                    )
                )
            except (ValueError, OverflowError):
                continue
            if not item["InstanceType"]:
                rows[-1].update(priceBasis="gpu_component_hour", instanceHourly=None)
            if len(rows) > MAX_RECORDS:
                raise SourceError("The source exceeds the supported record count.")
    return rows


def verda(items):
    if not isinstance(items, list):
        raise SourceError("The source returned an unexpected instance-type schema.")
    rows = []
    for item in items:
        if str(item.get("currency", "")).upper() != "USD":
            continue
        for term, field in [("On-demand", "price_per_hour"), ("Spot", "spot_price")]:
            if item.get(field) is None:
                continue
            try:
                rows.append(
                    quote(
                        "verda",
                        item["instance_type"],
                        item["model"],
                        item["gpu"]["number_of_gpus"],
                        item[field],
                        "unspecified",
                        term,
                        memory=item.get("gpu_memory", {}).get("size_in_gigabytes"),
                        cpu=item.get("cpu", {}).get("number_of_cores"),
                    )
                )
            except (ValueError, KeyError, TypeError):
                continue
    return rows


def digitalocean(items):
    rows = []
    for item in items:
        gpu = item.get("gpu_info")
        if not gpu:
            continue
        try:
            vram = gpu.get("vram", {})
            memory = vram.get("amount") if vram.get("unit", "").lower() in {"gib", "gb"} else None
            for region in item["regions"]:
                rows.append(
                    quote(
                        "digitalocean",
                        item["slug"],
                        gpu["model"].replace("nvidia_", ""),
                        gpu["count"],
                        item["price_hourly"],
                        region,
                        "On-demand",
                        memory=memory,
                        cpu=item.get("vcpus"),
                    )
                )
        except (ValueError, KeyError, TypeError):
            continue
    return rows


async def collect(provider, client, credential=""):
    import json

    source = SOURCES[provider]
    if source.mode == "catalog_reference":
        # GitHub's contents API returns a content-addressed blob SHA and avoids redirects.
        path = source.url.split("/master/", 1)[1]
        api_url = "https://api.github.com/repos/skypilot-org/skypilot-catalog/contents/" + path
        data = json.loads(await read(client, api_url))
        revision = data.get("sha", "")
        if not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise SourceError("The reference catalog did not include a valid content revision.")
        if data.get("encoding") == "base64" and data.get("content"):
            raw = base64.b64decode(data["content"], validate=False)
        else:
            # Large catalogs omit inline content. Read the immutable blob, never an arbitrary URL.
            blob = json.loads(
                await read(
                    client,
                    "https://api.github.com/repos/skypilot-org/skypilot-catalog/git/blobs/"
                    + revision,
                )
            )
            raw = base64.b64decode(blob["content"], validate=False)
        if len(raw) > MAX_BYTES:
            raise SourceError("The reference catalog exceeds the supported size.")
        return catalog(provider, raw.decode("utf-8-sig"), revision)
    if provider == "verda":
        return verda(json.loads(await read(client, source.url)))
    if provider == "digitalocean":
        url, rows = source.url, []
        visited = set()
        for _ in range(20):
            if url in visited:
                raise SourceError("The source repeated a pagination cursor.")
            visited.add(url)
            data = json.loads(await read(client, url, {"Authorization": "Bearer " + credential}))
            rows.extend(digitalocean(data["sizes"]))
            url = data.get("links", {}).get("pages", {}).get("next")
            if not url:
                return rows
            parsed = urlsplit(url)
            if (
                parsed.scheme != "https"
                or parsed.netloc != "api.digitalocean.com"
                or parsed.path != "/v2/sizes"
                or parsed.fragment
            ):
                raise SourceError("The source returned an unsafe pagination URL.")
        raise SourceError("The source exceeds the supported page count.")
    if provider == "tensordock":
        # Reuse only the existing read-only pricing operation, never provisioning methods.
        adapter = TensorDockProvider(
            Settings(_env_file=None, tensordock_api_key=credential), client
        )
        offers = await adapter.collect()
        return [
            quote(
                provider,
                o.sku,
                o.gpu_description,
                o.gpu_count,
                o.price_hourly,
                o.region,
                "On-demand",
                cpu=o.vcpus,
                kind="estimated",
            )
            for o in offers
        ]
    raise SourceError("This price collector is not implemented.")
