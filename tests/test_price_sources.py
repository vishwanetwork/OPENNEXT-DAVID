"""Read-only source contracts and durable publication, without cloud credentials."""

import base64
import csv
import io
import json
from datetime import timedelta

import httpx
import pytest

from spotbot.models import utcnow
from spotbot.opennext_ops import OperationError
from spotbot.price_sources.collectors import (
    SourceError,
    catalog,
    collect,
    digitalocean,
    quote,
    verda,
)
from spotbot.price_sources.registry import SOURCES
from spotbot.price_sources.service import PriceSources
from spotbot.rental_tasks import Sealer
from spotbot.storage.sqlite import Store
from spotbot.storage.workflows import WorkflowStore


def source_csv(*rows):
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=[
            "InstanceType",
            "AcceleratorName",
            "AcceleratorCount",
            "Region",
            "Price",
            "SpotPrice",
            "GpuInfo",
        ],
    )
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def test_catalog_units_identity_components_and_no_invented_terms():
    text = source_csv(
        dict(
            InstanceType="node",
            AcceleratorName="H100-SXM-80GB",
            AcceleratorCount="8",
            Region="zone-a",
            Price="24",
            SpotPrice="8",
        ),
        dict(
            InstanceType="",
            AcceleratorName="A100",
            AcceleratorCount="1",
            Region="zone-a",
            Price="2",
        ),
        dict(
            InstanceType="",
            AcceleratorName="V100",
            AcceleratorCount="1",
            Region="zone-a",
            Price="1",
        ),
        dict(
            InstanceType="cpu", AcceleratorName="", AcceleratorCount="0", Region="zone-a", Price="1"
        ),
        dict(
            InstanceType="bad",
            AcceleratorName="H100",
            AcceleratorCount="8",
            Region="zone-a",
            Price="NaN",
        ),
    )
    rows = catalog("gcp", text, "a" * 40)
    assert len(rows) == 4
    assert rows[0]["instanceHourly"] == 24 and rows[0]["perGpuHourly"] == 3
    assert rows[0]["gpuMemoryGb"] == 80 and rows[0]["formFactor"] == "SXM"
    assert rows[1]["term"] == "Spot" and rows[1]["perGpuHourly"] == 1
    assert rows[2]["priceBasis"] == "gpu_component_hour" and rows[2]["instanceHourly"] is None
    assert rows[2]["recordId"] != rows[3]["recordId"]
    assert all(
        r["orderable"] is False and r["availability"] is None and r["effectiveAt"] is None
        for r in rows
    )
    assert all(r["sourceRevision"] == "a" * 40 and r["term"] != "Reserved" for r in rows)
    with pytest.raises(SourceError):
        catalog("gcp", "renamed,columns\n1,2\n")


def test_verda_only_supported_usd_nonzero_prices():
    row = dict(
        instance_type="8H100",
        model="H100",
        currency="usd",
        gpu={"number_of_gpus": 8},
        gpu_memory={"size_in_gigabytes": 640},
        price_per_hour="16",
        spot_price="8",
    )
    rows = verda([row, dict(row, currency="eur"), dict(row, price_per_hour="NaN", spot_price="0")])
    assert len(rows) == 2 and rows[0]["perGpuHourly"] == 2 and rows[1]["perGpuHourly"] == 1
    assert rows[0]["region"] == "unspecified" and rows[0]["availability"] is None
    assert rows[0]["gpuMemoryGb"] == 80


def test_digitalocean_explicit_gpu_specs():
    rows = digitalocean(
        [
            dict(
                slug="gpu-h100x8",
                regions=["nyc1", "ams3"],
                price_hourly=24,
                gpu_info=dict(count=8, model="nvidia_h100", vram=dict(amount=80, unit="gib")),
            ),
            dict(slug="cpu"),
        ]
    )
    assert len(rows) == 2 and rows[0]["perGpuHourly"] == 3 and rows[0]["gpuModel"] == "H100"
    assert rows[1]["gpuMemoryGb"] == 80


async def test_credential_never_follows_pagination_to_another_host():
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={"sizes": [], "links": {"pages": {"next": "https://attacker.example/v2/sizes"}}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        with pytest.raises(SourceError, match="unsafe pagination"):
            await collect("digitalocean", client, "private-token")
    assert len(calls) == 1 and calls[0].method == "GET"
    assert calls[0].headers["authorization"] == "Bearer private-token"


async def test_catalog_reads_content_addressed_large_blob():
    text = source_csv(
        dict(
            InstanceType="node", AcceleratorName="H100", AcceleratorCount=1, Region="zone", Price=2
        )
    )
    calls = []

    def upstream(request):
        calls.append(str(request.url))
        return httpx.Response(
            200,
            json=(
                dict(sha="a" * 40, encoding="none")
                if "/contents/" in request.url.path
                else dict(content=base64.b64encode(text.encode()).decode())
            ),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        rows = await collect("azure", client)
    assert len(rows) == 1 and calls[1].endswith("/git/blobs/" + "a" * 40)
    assert rows[0]["sourceRevision"] == "a" * 40


@pytest.fixture
async def sources(tmp_path):
    store = Store(tmp_path / "sources.db")
    db = WorkflowStore(store)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(401))
    ) as client:
        yield PriceSources(db, client, Sealer(base64.b64encode(bytes(32)).decode()))


async def test_credential_encrypted_persistent_but_not_verified(sources):
    with pytest.raises(OperationError):
        await sources.enqueue("digitalocean")
    await sources.credential("digitalocean", "a-private-token")
    raw = json.dumps(sources.db.list("price_source_key"))
    assert (
        "a-private-token" not in raw and await sources.secret("digitalocean") == "a-private-token"
    )
    rows = (await sources.providers(dict(providers=[])))["providers"]
    selected = next(r for r in rows if r["id"] == "digitalocean")
    assert selected["credentialConfigured"] and selected["validationStatus"] == "not_live_verified"
    assert "a-private-token" not in json.dumps(rows)
    assert len(SOURCES) == 11


async def test_atomic_publish_restart_failure_and_single_claim(sources, monkeypatch):
    import asyncio

    import spotbot.price_sources.service as service

    calls = []
    entered, release = asyncio.Event(), asyncio.Event()

    async def fetch(provider, client, credential):
        calls.append(provider)
        entered.set()
        await release.wait()
        return [quote(provider, "sku", "H100", 8, 16, "zone", "On-demand")]

    monkeypatch.setattr(service, "collect", fetch)
    queued = await sources.enqueue("verda")
    assert (await sources.enqueue("verda"))["id"] == queued["id"]
    worker = asyncio.create_task(sources._process("verda"))
    await entered.wait()
    assert await sources.prices("verda") == []
    await sources._process("verda")
    await sources.settings("verda", dict(enabled=True, intervalMinutes=120))
    release.set()
    await worker
    assert calls == ["verda"]
    assert (await sources.config("verda"))["intervalMinutes"] == 120
    restarted = PriceSources(sources.db, sources.client, sources.sealer)
    published = await restarted.prices("verda")
    assert len(published) == 1 and published[0]["perGpuHourly"] == 2

    async def fail(*_):
        raise SourceError("Source unavailable.")

    monkeypatch.setattr(service, "collect", fail)
    await restarted.enqueue("verda")
    await restarted._process("verda")
    assert (await restarted.runs())[0]["status"] == "failed"
    assert await restarted.prices("verda") == published
    assert (await restarted.providers(dict(providers=[])))["providers"][-3]["id"] == "verda"


async def test_stale_worker_recovers_without_purchasing(sources):
    await sources.enqueue("verda")
    config = await sources.config("verda")
    config["runs"][0].update(
        phase="collecting", claimedAt=(utcnow() - timedelta(minutes=6)).isoformat()
    )
    await sources.save(config)
    await sources._process("verda")
    assert (await sources.config("verda"))["active"] is None
    assert (await sources.runs())[0]["status"] == "failed"


async def test_errors_redact_upstream_secrets(sources, monkeypatch):
    async def fail(*_):
        raise RuntimeError("https://example.test?token=private-token")

    monkeypatch.setattr("spotbot.price_sources.service.collect", fail)
    await sources.enqueue("verda")
    await sources._process("verda")
    assert "private-token" not in json.dumps(await sources.runs())


async def test_provider_document_sizes_are_bounded_for_dynamodb(sources, monkeypatch):
    async def collect_rows(*_):
        return [
            dict(
                quote("verda", str(i), "H100", 1, 2, "region", "On-demand"),
                gpuDescription="x" * 4000,
            )
            for i in range(160)
        ]

    monkeypatch.setattr("spotbot.price_sources.service.collect", collect_rows)
    await sources.enqueue("verda")
    await sources._process("verda")
    chunks = sources.db.list("price_source_chunk", "operations")
    assert len(chunks) > 2
    assert all(len(json.dumps(c).encode()) < 400000 for c in chunks)
    assert len(await sources.prices("verda")) == 160


async def test_cannot_enable_credential_source_without_a_token(sources):
    with pytest.raises(OperationError, match="credential"):
        await sources.settings("digitalocean", dict(enabled=True, intervalMinutes=60))


async def test_console_worker_cancellation_cleans_independent_pricing_worker(sources, monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from spotbot.opennext_console import ConsoleBackend

    started, stopped, reconciled = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def pricing():
        started.set()
        try:
            await asyncio.Future()
        finally:
            stopped.set()

    async def tick():
        reconciled.set()

    async def restore():
        return None

    monkeypatch.setattr(sources, "run", pricing)
    ctx = SimpleNamespace(
        sources=sources, bridge=SimpleNamespace(restore=restore), tick=tick, worker_error=None
    )
    task = asyncio.create_task(ConsoleBackend.run(ctx))
    await asyncio.wait_for(started.wait(), 1)
    await asyncio.wait_for(reconciled.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stopped.is_set()


async def test_tensordock_uses_only_read_only_location_quote():
    from tests.conftest import TENSOR_CATALOG

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=TENSOR_CATALOG)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rows = await collect("tensordock", client, "read-only-token")
    assert len(calls) == 1 and calls[0].method == "GET" and calls[0].url.path == "/api/v2/locations"
    assert calls[0].headers["authorization"] == "Bearer read-only-token"
    assert rows[0]["instanceHourly"] == pytest.approx(2.233)
    assert (
        rows[0]["vCpu"] == 4
        and rows[0]["priceKind"] == "estimated"
        and rows[0]["orderable"] is False
    )
