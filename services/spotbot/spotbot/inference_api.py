"""Read-only inference admission using the Bot's enrolled account and pinned catalog."""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from spotbot.inference import PRESETS, catalog, requirements, selection, validate_host
from spotbot.rental_models import nominal_gpu_gb


class SelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offer_id: str = Field(min_length=1, max_length=200)
    preset_id: str = Field(min_length=1, max_length=100)


def resolve(service, offer, preset_id):
    if preset_id not in PRESETS:
        raise ValueError("inference_preset_not_enabled")
    if not offer or offer.provider != "aws":
        raise ValueError("inference_offer_unavailable")
    provider = service.providers["aws"]
    if not provider.public_offer(
        offer, service.settings.spotbot_price_max_age_seconds, account_routes=True
    )["can_attempt"]:
        raise ValueError("inference_offer_unavailable")
    name = offer.details.get("aws_account", "default")
    if name != "default":
        provider = provider.fulfillment_providers().get(name)
        if provider is None:
            raise ValueError("aws_account_not_enrolled")
    specs = offer.details.get("gpu_specifications") or []
    if offer.details.get("gpu_count_kind") != "physical":
        raise ValueError("inference_whole_gpu_required")
    if not specs or any(g.get("Manufacturer") != "NVIDIA" for g in specs):
        raise ValueError("inference_gpu_vendor_not_supported")
    validate_host(preset_id, offer.memory_gb, offer.vcpus, offer.details.get("architecture"))
    memory = min((g.get("MemoryInfo", {}).get("SizeInMiB", 0) for g in specs), default=0)
    spec = selection(
        provider.settings,
        preset_id,
        offer.gpu_model,
        offer.gpu_count,
        nominal_gpu_gb(memory),
    )
    images = catalog(provider.settings)[preset_id].initial_image_ids.get(name, {})
    return spec, {offer.region: images[offer.region]} if offer.region in images else {}


def offer_presets(service, offer):
    values = []
    for name, preset in PRESETS.items():
        row = dict(
            id=name,
            label=preset["label"],
            model=preset["repo"],
            precision=preset["precision"],
            diskGiB=preset["disk_gib"],
            estimatedMinutes=preset["estimated_minutes"],
            billingStart="gpu_delivery",
            enabled=False,
            reason=None,
            requirements=requirements(name),
            modelGpuCount=None,
        )
        try:
            spec, _ = resolve(service, offer, name)
            row["enabled"] = True
            row["modelGpuCount"] = spec.tensor_parallel
        except ValueError as exc:
            row["reason"] = (
                str(exc)
                if str(exc).startswith(("inference_", "aws_account_"))
                else "inference_configuration_unavailable"
            )
        values.append(row)
    return {"presets": values}


def install(app, service, auth):
    @app.get("/v1/inference/presets", dependencies=auth)
    def presets(offer_id: str):
        return offer_presets(service, service.store.get_offer(offer_id))

    @app.post("/v1/inference/selection", dependencies=auth)
    def selected(request: SelectionRequest):
        try:
            spec, images = resolve(
                service, service.store.get_offer(request.offer_id), request.preset_id
            )
        except ValueError as exc:
            raise HTTPException(
                409,
                str(exc)
                if str(exc).startswith(("inference_", "aws_account_"))
                else "inference_configuration_unavailable",
            ) from None
        return {"spec": spec.model_dump(), "version": spec.version, "initial_image_ids": images}
