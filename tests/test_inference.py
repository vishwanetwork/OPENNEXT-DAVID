import base64
import json
from decimal import Decimal

import pytest
from pydantic import SecretStr, ValidationError

from spotbot import inference
from spotbot.config import Settings
from spotbot.inference import PRESETS, InferenceReport, selection
from spotbot.rental_models import DiskRule
from spotbot.rental_tasks import public
from tests.test_rentals import deliver
from tests.test_rentals import rental_env as rental_env

NAME = "deepseek-r1-distill-70b"
PINS = dict(
    enabled=True,
    revision="a" * 40,
    image="vllm/vllm-openai@sha256:" + "b" * 64,
    validated_gpu_models=["B300", "H100"],
)


def configured(**values):
    return Settings(
        _env_file=None,
        spotbot_rental_task_key=base64.b64encode(b"k" * 32).decode(),
        spotbot_gateway_webhook_url="https://gateway.example/events",
        spotbot_gateway_webhook_secret="w" * 32,
        spotbot_inference_presets=json.dumps({NAME: PINS}),
        **values,
    )


def test_preset_pins_and_memory_are_required_before_admission():
    s = configured()
    spec = selection(s, NAME, "B300", 1, 288)
    assert spec.disk_gib == 250 and spec.tensor_parallel == 1
    assert selection(s, NAME, "H100", 4, 80).tensor_parallel == 4
    with pytest.raises(ValueError, match="insufficient_vram"):
        selection(s, NAME, "H100", 2, 80)
    with pytest.raises(ValueError, match="insufficient_vram"):
        selection(s, NAME, "H100", 1, 80)
    with pytest.raises(ValueError, match="gpu_not_validated"):
        selection(s, NAME, "T4", 16, 16)
    with pytest.raises(ValueError, match="not_enabled"):
        selection(Settings(_env_file=None), NAME, "B300", 1, 288)
    for pins in [dict(PINS, image="vllm/vllm-openai:latest"), dict(PINS, revision="main")]:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, spotbot_inference_presets=json.dumps({NAME: pins}))
    s.spotbot_rental_task_key = SecretStr("not-a-key")
    with pytest.raises(ValueError, match="secrets_unavailable"):
        selection(s, NAME, "B300", 1, 288)


def test_full_moe_model_is_not_admitted_by_activated_parameter_count():
    s = configured()
    s.spotbot_inference_presets = json.dumps({"deepseek-r1-671b": PINS})
    with pytest.raises(ValueError, match="insufficient_vram"):
        selection(s, "deepseek-r1-671b", "H100", 8, 80)
    assert selection(s, "deepseek-r1-671b", "B300", 8, 288).disk_gib == 1024


def test_small_test_model_is_available_only_on_validated_hardware_with_headroom():
    s = configured()
    s.spotbot_inference_presets = json.dumps(
        {"deepseek-r1-distill-7b": dict(PINS, validated_gpu_models=["L4", "T4"])}
    )
    assert selection(s, "deepseek-r1-distill-7b", "L4", 1, 24).disk_gib == 100
    with pytest.raises(ValueError, match="insufficient_vram"):
        selection(s, "deepseek-r1-distill-7b", "T4", 1, 16)
    with pytest.raises(ValueError, match="unsupported_gpu_layout"):
        selection(s, "deepseek-r1-distill-7b", "L4", 8, 24)


@pytest.mark.parametrize(
    "model,mib,ram,cpu,arch,kind,reason",
    [
        ("L4", 22888, 16, 4, "x86_64", "physical", None),
        ("T4", 16384, 16, 4, "x86_64", "physical", "inference_insufficient_vram"),
        ("L4", 22888, 8, 4, "x86_64", "physical", "inference_insufficient_host_memory"),
        ("L4", 22888, 16, 2, "x86_64", "physical", "inference_insufficient_vcpus"),
        ("L4", 22888, 16, 4, "arm64", "physical", "inference_architecture_not_supported"),
        ("L4", 22888, 16, 4, "x86_64", "logical", "inference_whole_gpu_required"),
    ],
)
def test_live_aws_memory_metadata_matches_the_checkout_model_catalog(
    model, mib, ram, cpu, arch, kind, reason
):
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from spotbot.inference_api import install

    name = "deepseek-r1-distill-7b"
    settings = configured()
    settings.spotbot_inference_presets = json.dumps(
        {name: dict(PINS, validated_gpu_models=["L4", "T4"])}
    )
    offer = SimpleNamespace(
        provider="aws",
        memory_gb=ram,
        vcpus=cpu,
        region="us-west-2",
        gpu_model=model,
        gpu_count=1,
        details={
            "gpu_specifications": [{"Manufacturer": "NVIDIA", "MemoryInfo": {"SizeInMiB": mib}}],
            "gpu_count_kind": kind,
            "architecture": arch,
        },
    )
    provider = SimpleNamespace(
        settings=settings, public_offer=lambda *args, **kwargs: {"can_attempt": True}
    )
    service = SimpleNamespace(
        store=SimpleNamespace(get_offer=lambda offer_id: offer),
        providers={"aws": provider},
        settings=settings,
    )
    app = FastAPI()
    install(app, service, [])
    with TestClient(app) as client:
        values = client.get("/v1/inference/presets", params={"offer_id": "offer"}).json()["presets"]
        preset = next(v for v in values if v["id"] == name)
        assert preset["enabled"] is (reason is None)
        assert preset["reason"] == reason
        assert preset["requirements"]["minimumHostMemoryGiB"] == 16
        result = client.post(
            "/v1/inference/selection", json={"offer_id": "offer", "preset_id": name}
        )
        assert result.status_code == (200 if reason is None else 409)
        if reason:
            assert result.json()["detail"] == reason


def test_large_model_admission_reserves_runtime_headroom_and_keeps_precision_separate():
    s = configured()
    s.spotbot_inference_presets = json.dumps(
        {
            "deepseek-r1-distill-70b": dict(PINS, validated_gpu_models=["H100", "H200", "B300"]),
            "deepseek-r1-671b": dict(PINS, validated_gpu_models=["H100", "H200", "B300"]),
        }
    )
    assert selection(s, NAME, "H200", 2, 141).tensor_parallel == 2
    assert selection(s, NAME, "B300", 1, 288).tensor_parallel == 1
    with pytest.raises(ValueError, match="insufficient_vram"):
        selection(s, NAME, "H100", 2, 80)
    assert selection(s, "deepseek-r1-671b", "H200", 8, 141).tensor_parallel == 8
    with pytest.raises(ValueError, match="insufficient_vram"):
        selection(s, "deepseek-r1-671b", "H100", 8, 80)
    with pytest.raises(ValueError, match="unsupported_gpu_layout"):
        selection(s, "deepseek-r1-671b", "B300", 16, 288)


def test_storage_quote_does_not_increase_the_native_gpu_bid():

    from spotbot.opennext_market import Offer
    from tests.test_opennext_market import aws

    raw = aws("p6.test", "us-west-2", "73.1967", model="B300", count=8, mib=275040)
    original = Offer(raw)
    spec = selection(configured(), NAME, "B300", 8, 288)
    priced = inference.priced(original, spec, Decimal("0.15"))
    assert priced.cents > original.cents and priced.source_cents == original.source_cents
    assert priced.pricing["serviceFeeBps"] == 0
    assert priced.pricing["inferenceVersion"] == spec.version


def test_warm_images_are_scoped_and_must_match_immutable_model_and_runtime():
    from spotbot.inference import Pins, cache_matches

    pins = Pins.model_validate(
        dict(PINS, initial_image_ids={"default": {"us-west-2": "ami-1234567890abcdef0"}})
    )
    assert pins.initial_image_ids.get("b300", {}) == {}
    spec = selection(configured(), NAME, "B300", 1, 288)
    image = dict(
        Public=False,
        Tags=[
            dict(Key=k, Value=v)
            for k, v in {
                "spotbot-inference-preset": NAME,
                "spotbot-model-revision": spec.revision,
                "spotbot-runtime-digest": spec.image.split("@")[1],
            }.items()
        ],
    )
    assert cache_matches(image, spec)
    assert not cache_matches(dict(image, Public=True), spec)
    assert not cache_matches(image, spec.model_copy(update={"revision": "c" * 40}))
    with pytest.raises(ValidationError):
        Pins.model_validate(dict(PINS, initial_image_ids={"default": {"us-west-2": "not-an-ami"}}))


@pytest.fixture
def model_env(rental_env, monkeypatch):
    env = rental_env
    monkeypatch.setitem(PRESETS[NAME], "minimum_vram_gb", 80)
    s = env.service.settings
    s.spotbot_rental_task_key = configured().spotbot_rental_task_key
    s.spotbot_gateway_webhook_url = "https://gateway.example/events"
    s.spotbot_inference_presets = json.dumps({NAME: PINS})
    from spotbot.rental_tasks import Sealer

    env.engine.sealer = Sealer(s.spotbot_rental_task_key.get_secret_value())
    env.request = env.request.model_copy(deep=True)
    env.request.rfq.inference = selection(s, NAME, "H100", 1, 80)
    env.request.rfq.min_memory_gib = 64
    env.request.rfq.min_vcpus = 8
    env.request.rfq.root_volume_gib = 100
    env.request.rfq.http_port = 8000
    env.request.rfq.data_disks = [DiskRule(device="/dev/sdf", size_gib=250)]
    return env


@pytest.mark.parametrize(
    "field,value,reason",
    [
        ("min_memory_gib", 16, "insufficient_host_memory"),
        ("min_vcpus", 4, "insufficient_vcpus"),
        ("root_volume_gib", 50, "root_volume_too_small"),
        ("architecture", "arm64", "architecture_not_supported"),
    ],
)
def test_direct_rfq_cannot_bypass_model_host_requirements(model_env, field, value, reason):
    env = model_env
    setattr(env.request.rfq, field, value)
    with pytest.raises(ValueError, match=reason):
        env.engine.create(env.request, "tenant-a", "invalid-model-machine")
    assert not env.cloud.creates


async def test_machine_delivery_and_customer_task_do_not_wait_for_model(model_env):
    env = model_env
    row, _ = env.engine.create(env.request, "tenant-a", "inference-purchase")
    assert inference.summary(row)["state"] == "queued"
    assert "inference_secret" not in public(row)
    assert inference.instruction(row, {"generation": 1}, env.engine.sealer)["run"] is False
    row = await deliver(env, row["id"])
    assert row["state"] == "ACTIVE"
    gen = env.engine.current(row)
    spec = inference.instruction(row, gen, env.engine.sealer)
    assert spec["run"] is True and len(spec["backend_token"]) >= 32
    assert spec["backend_token"] not in json.dumps(public(row))
    assert public(row)["task"] is None
    # A stale or merely listening service cannot turn inference ready.
    inference.record(
        row,
        gen,
        InferenceReport(
            version=2,
            state="ready",
            smoke_tokens=1,
            certificate="-----BEGIN CERTIFICATE-----\npublic",
        ),
    )
    assert inference.summary(row)["state"] == "queued"
    inference.record(row, gen, InferenceReport(version=1, state="ready"))
    assert inference.summary(row)["state"] == "failed"
    env.engine.save(row)
    state = await env.engine.inference_action(row["id"], "tenant-a", "retry", 1)
    assert state["version"] == 2 and state["state"] == "queued"
    with pytest.raises(LookupError):
        await env.engine.inference_action(row["id"], "tenant-b", "stop", 2)
    await env.engine.inference_action(row["id"], "tenant-a", "stop", 2)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTIVE" and inference.summary(row)["state"] == "stopped"
    assert inference.instruction(row, gen, env.engine.sealer)["run"] is False


def test_snapshot_must_match_approved_pins_and_reserve_model_disk(model_env):
    env = model_env
    changed = env.request.model_copy(deep=True)
    changed.rfq.inference.revision = "c" * 40
    with pytest.raises(ValueError, match="preset_changed"):
        env.engine.create(changed, "tenant-a", "wrong-pins")
    changed = env.request.model_copy(deep=True)
    changed.rfq.data_disks = []
    with pytest.raises(ValueError, match="volume_missing"):
        env.engine.create(changed, "tenant-a", "wrong-disk")
