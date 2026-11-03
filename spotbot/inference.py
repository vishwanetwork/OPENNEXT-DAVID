"""Pinned optional inference presets and a separate, encrypted rental service state."""

import hashlib
import json
import re
import secrets
from decimal import ROUND_CEILING, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from spotbot.guest_inference import HARDWARE
from spotbot.models import gpu_model, timestamp

PRESETS = {
    "deepseek-r1-distill-7b": dict(
        label="DeepSeek R1 Distill 7B (test)",
        repo="deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        precision="float16",
        disk_gib=100,
        minimum_vram_gb=24,
        minimum_gpus=1,
        estimated_minutes=30,
    ),
    "deepseek-r1-distill-70b": dict(
        label="DeepSeek R1 Distill 70B",
        repo="deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
        precision="bfloat16",
        disk_gib=250,
        minimum_vram_gb=192,
        minimum_gpus=1,
        estimated_minutes=60,
    ),
    "deepseek-r1-671b": dict(
        label="DeepSeek R1 671B",
        repo="deepseek-ai/DeepSeek-R1",
        precision="fp8",
        disk_gib=1024,
        minimum_vram_gb=1120,
        minimum_gpus=8,
        estimated_minutes=180,
    ),
}
STATES = Literal[
    "queued", "preparing_runtime", "downloading", "loading", "ready", "failed", "stopped"
]


class Pins(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    image: str = Field(pattern=r"^(?:docker\.io/)?vllm/vllm-openai@sha256:[a-f0-9]{64}$")
    validated_gpu_models: list[str] = Field(min_length=1, max_length=20)
    # Account alias -> Region -> clean, prepared AMI. Never a customer's rental backup.
    initial_image_ids: dict[str, dict[str, str]] = Field(default_factory=dict, max_length=32)

    @model_validator(mode="after")
    def valid_images(self):
        for account, regions in self.initial_image_ids.items():
            if not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", account) or len(regions) > 32:
                raise ValueError("invalid_inference_image_scope")
            if any(
                not re.fullmatch(r"[a-z0-9-]{3,32}", region)
                or not re.fullmatch(r"ami-(?:[a-f0-9]{8}|[a-f0-9]{17})", image)
                for region, image in regions.items()
            ):
                raise ValueError("invalid_inference_image_id")
        return self


class InferenceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset_id: Literal["deepseek-r1-distill-7b", "deepseek-r1-distill-70b", "deepseek-r1-671b"]
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    image: str = Field(pattern=r"^(?:docker\.io/)?vllm/vllm-openai@sha256:[a-f0-9]{64}$")
    tensor_parallel: int = Field(ge=1, le=64)
    max_model_len: int = Field(8192, ge=1024, le=32768)
    max_num_seqs: int = Field(1, ge=1, le=16)
    disk_gib: int = Field(ge=100, le=4096)
    preparation_seconds: int = Field(ge=900, le=14400)

    @model_validator(mode="after")
    def supported_layout(self):
        preset = PRESETS[self.preset_id]
        if self.tensor_parallel not in HARDWARE[self.preset_id]["tp"]:
            raise ValueError("unsupported_inference_parallelism")
        if self.disk_gib < preset["disk_gib"]:
            raise ValueError("inference_disk_too_small")
        return self

    @property
    def version(self):
        return hashlib.sha256(json.dumps(self.model_dump(), sort_keys=True).encode()).hexdigest()


class InferenceReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)
    state: STATES
    downloaded_bytes: int = Field(0, ge=0)
    total_bytes: int = Field(0, ge=0)
    # Public self-signed leaf certificate, never its private key.
    certificate: str = Field("", max_length=6000)
    smoke_tokens: int = Field(0, ge=0, le=4096)
    error: (
        Literal[
            "runtime_unavailable",
            "hardware_incompatible",
            "download_failed",
            "model_start_failed",
            "preparation_timeout",
            "lease_expired",
            "inference_stopped",
        ]
        | None
    ) = None


def catalog(settings):
    raw = json.loads(settings.spotbot_inference_presets)
    if not isinstance(raw, dict) or set(raw) - set(PRESETS):
        raise ValueError("invalid_inference_presets")
    return {name: Pins.model_validate(pins) for name, pins in raw.items()}


def selection(settings, preset_id, model, count, memory_gb):
    pins = catalog(settings).get(preset_id)
    preset = PRESETS.get(preset_id)
    if not preset or not pins or not pins.enabled:
        raise ValueError("inference_preset_not_enabled")
    from spotbot.rental_tasks import Sealer

    try:
        usable_key = Sealer(settings.spotbot_rental_task_key.get_secret_value()).aead is not None
    except (ValueError, TypeError):
        usable_key = False
    if not usable_key:
        raise ValueError("inference_secrets_unavailable")
    if not settings.spotbot_gateway_webhook_url:
        raise ValueError("inference_gateway_not_configured")
    if gpu_model(model) not in {gpu_model(v) for v in pins.validated_gpu_models}:
        raise ValueError("inference_gpu_not_validated")
    if (
        count < preset["minimum_gpus"]
        or Decimal(str(memory_gb)) * count < preset["minimum_vram_gb"]
    ):
        raise ValueError("inference_insufficient_vram")
    parallel = next(
        (
            n
            for n in HARDWARE[preset_id]["tp"]
            if n <= count and Decimal(str(memory_gb)) * n >= preset["minimum_vram_gb"]
        ),
        None,
    )
    if parallel is None:
        raise ValueError("inference_unsupported_gpu_layout")
    return InferenceSpec(
        preset_id=preset_id,
        revision=pins.revision,
        image=pins.image,
        tensor_parallel=parallel,
        disk_gib=preset["disk_gib"],
        preparation_seconds=preset["estimated_minutes"] * 60,
    )


def validate_rfq(settings, rules):
    spec = rules.inference
    if not spec:
        return
    expected = selection(
        settings, spec.preset_id, rules.gpu_model, rules.gpu_count, rules.min_gpu_memory_gib
    )
    if (
        spec.tensor_parallel > rules.gpu_count
        or rules.min_gpu_memory_gib * spec.tensor_parallel
        < PRESETS[spec.preset_id]["minimum_vram_gb"]
        or spec != expected.model_copy(update={"tensor_parallel": spec.tensor_parallel})
    ):
        raise ValueError("inference_preset_changed")
    validate_host(spec.preset_id, rules.min_memory_gib, rules.min_vcpus, rules.architecture)
    if rules.root_volume_gib < 100:
        raise ValueError("inference_root_volume_too_small")
    if rules.http_port != 8000 or rules.http_health_path != "/health":
        raise ValueError("inference_requires_managed_http")
    if not any(d.device == "/dev/sdf" and d.size_gib >= spec.disk_gib for d in rules.data_disks):
        raise ValueError("inference_model_volume_missing")


def requirements(preset_id):
    policy = HARDWARE[preset_id]
    return dict(
        minimumTotalVramGB=PRESETS[preset_id]["minimum_vram_gb"],
        minimumHostMemoryGiB=policy["host_gib"],
        minimumVcpus=policy["vcpus"],
        modelDiskGiB=PRESETS[preset_id]["disk_gib"],
        rootDiskGiB=100,
        tensorParallelSizes=policy["tp"],
        minimumComputeCapability=".".join(map(str, policy["cc"])),
        architecture="x86_64",
        maxModelLen=8192,
        maxNumSeqs=1,
    )


def validate_host(preset_id, memory_gib, vcpus, architecture):
    policy = HARDWARE[preset_id]
    if architecture != "x86_64":
        raise ValueError("inference_architecture_not_supported")
    if memory_gib < policy["host_gib"]:
        raise ValueError("inference_insufficient_host_memory")
    if vcpus < policy["vcpus"]:
        raise ValueError("inference_insufficient_vcpus")


def priced(offer, spec, storage_rate, *, initial_images=None):
    from spotbot.opennext_market import Offer

    # The storage add-on is included in the hourly total; the native GPU bid cap stays separate.
    monthly = storage_rate
    storage = Decimal(spec.disk_gib) * monthly / Decimal(720)
    bps = offer.pricing.get("markupBps", 0)
    cents = int((storage * 100 * (10000 + bps) / 10000).to_integral_value(ROUND_CEILING))
    pricing = dict(
        offer.pricing,
        inference=spec.model_dump(),
        inferenceVersion=spec.version,
        modelStorageHourlyCents=cents,
        retailCents=offer.cents + cents,
    )
    if initial_images:
        pricing["initialImageIds"] = dict(initial_images)
    return Offer(offer.raw, frozen=pricing)


def cache_matches(image, spec):
    tags = {t["Key"]: t["Value"] for t in image.get("Tags", [])}
    return (
        image.get("Public") is False
        and tags.get("spotbot-inference-preset") == spec.preset_id
        and tags.get("spotbot-model-revision") == spec.revision
        and tags.get("spotbot-runtime-digest") == spec.image.split("@", 1)[1]
    )


def initialize(row, sealer):
    if row["rfq"].get("inference"):
        row["inference_seq"] = 1
        row["inference_state"] = dict(
            version=1, state="queued", generation=0, downloaded_bytes=0, total_bytes=0, error=None
        )
        row["inference_secret"] = sealer.seal(
            {"backend_token": secrets.token_urlsafe(32)}, "spotbot-inference:" + row["id"]
        )


def summary(row):
    if not row["rfq"].get("inference"):
        return None
    value = dict(row.get("inference_state") or dict(state="queued"))
    if row.get("end_requested") or row.get("inference_stop") or row["state"] == "CLOSED":
        value.update(state="stopped", error=None)
    elif value.get("generation") != row["generation"]:
        value.update(state="queued", downloaded_bytes=0, total_bytes=0, error=None)
    value.update(
        preset_id=row["rfq"]["inference"]["preset_id"],
        billing_start="gpu_delivery",
        estimated_minutes=row["rfq"]["inference"]["preparation_seconds"] // 60,
        model_gpu_count=row["rfq"]["inference"]["tensor_parallel"],
    )
    return value


def record(row, gen, report):
    if (
        not row["rfq"].get("inference")
        or report is None
        or report.version != row.get("inference_seq", 1)
    ):
        return
    value = report.model_dump(exclude={"certificate"})
    if report.state == "ready" and (
        report.smoke_tokens < 1 or not report.certificate.startswith("-----BEGIN CERTIFICATE-----")
    ):
        value.update(state="failed", error="model_start_failed")
    if value["state"] == "ready":
        gen["inference_certificate"] = report.certificate
    value.update(generation=gen["generation"], updated_at=timestamp())
    row["inference_state"] = value


def instruction(row, gen, sealer):
    if not row["rfq"].get("inference"):
        return None
    running = (
        row["state"] == "ACTIVE"
        and not row["end_requested"]
        and not row.get("inference_stop")
        and bool(gen.get("verified_at"))
    )
    value = dict(
        version=row.get("inference_seq", 1),
        generation=gen["generation"],
        run=running,
        expires_at=row["rfq"]["expires_at"],
    )
    if running:
        value.update(
            spec=row["rfq"]["inference"],
            server_ip=row["connection"]["ssh"]["host"],
            **sealer.open(row["inference_secret"], "spotbot-inference:" + row["id"]),
        )
    return value


def gateway_view(row, gen, sealer):
    state = summary(row)
    if not state:
        return None
    value = dict(state=state["state"], model=row["rfq"]["inference"]["preset_id"])
    if state["state"] == "ready" and gen and gen.get("inference_certificate"):
        value.update(
            certificate=gen["inference_certificate"],
            **sealer.open(row["inference_secret"], "spotbot-inference:" + row["id"]),
        )
    return value
