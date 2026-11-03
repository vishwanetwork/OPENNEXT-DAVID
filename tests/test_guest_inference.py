import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from spotbot import guest_inference as guest


def test_real_gpu_probe_rejects_wrong_memory_count_and_compute_capability(monkeypatch):
    import sys

    import pytest

    cuda = SimpleNamespace(
        is_available=lambda: True,
        device_count=lambda: 1,
        get_device_properties=lambda i: SimpleNamespace(total_memory=24 * 10**9),
        get_device_capability=lambda i: (8, 9),
    )
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=cuda))
    cfg = dict(preset_id="deepseek-r1-distill-7b", tensor_parallel=1)
    exec(guest.runtime_probe(cfg), {})
    for update, message in [
        (dict(device_count=lambda: 2), "GPU count mismatch"),
        (
            dict(get_device_properties=lambda i: SimpleNamespace(total_memory=16 * 10**9)),
            "Insufficient GPU memory",
        ),
        (dict(get_device_capability=lambda i: (7, 0)), "Unsupported GPU compute capability"),
    ]:
        with monkeypatch.context() as patch:
            for key, value in update.items():
                patch.setattr(cuda, key, value)
            with pytest.raises(AssertionError, match=message):
                exec(guest.runtime_probe(cfg), {})
    monkeypatch.setattr(cuda, "device_count", lambda: 2)
    monkeypatch.setattr(
        cuda,
        "get_device_properties",
        lambda i: SimpleNamespace(total_memory=(8 if i == 0 else 40) * 10**9),
    )
    with pytest.raises(AssertionError, match="Insufficient GPU memory"):
        exec(guest.runtime_probe(dict(cfg, tensor_parallel=2)), {})


def test_paid_extension_updates_expiry_watcher_and_runtime_without_restarting(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(guest, "ROOT", tmp_path)
    monkeypatch.setattr(guest, "MODELS", tmp_path / "models")
    monkeypatch.setattr(guest.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=b"active"))
    calls = []
    monkeypatch.setattr(guest, "call", lambda args, **kw: calls.append(args))
    expiry = datetime.now(UTC) + timedelta(hours=2)
    spec = dict(
        version=2,
        generation=1,
        run=True,
        expires_at=expiry.isoformat(),
        spec=dict(preset_id="deepseek-r1-distill-70b", revision="a" * 40),
    )
    name = guest.unit(spec)
    guest.write(
        tmp_path / "active.json",
        dict(
            unit=name,
            started_at=expiry.timestamp() - 7200,
            expires_at=(expiry - timedelta(hours=1)).isoformat(),
        ),
    )
    guest.write(tmp_path / name / "state.json", dict(version=2, state="ready"))
    assert guest.step(spec)["state"] == "ready"
    assert calls == [["systemctl", "set-property", name, "RuntimeMaxSec=7200"]]
    assert (
        json.loads((tmp_path / name / "config.json").read_text())["expires_at"]
        == spec["expires_at"]
    )


def test_expiry_watcher_rereads_extended_lease(tmp_path, monkeypatch):
    now = datetime.now(UTC)
    spec = dict(version=1, generation=1, expires_at=(now + timedelta(seconds=2)).isoformat())
    guest.write(tmp_path / "config.json", spec)
    clocks = iter([now.timestamp(), now.timestamp() + 3, now.timestamp() + 10])
    monkeypatch.setattr(guest.time, "time", lambda: next(clocks))
    sleeps = []

    def sleep(_):
        sleeps.append(True)
        guest.write(
            tmp_path / "config.json",
            dict(spec, expires_at=(now + timedelta(seconds=9)).isoformat()),
        )

    monkeypatch.setattr(guest.time, "sleep", sleep)
    calls = []
    monkeypatch.setattr(guest, "cleanup", calls.append)
    guest.expire(tmp_path)
    assert len(sleeps) == 2 and calls == [guest.unit(spec)]


def test_service_failure_does_not_break_guest_heartbeats(monkeypatch):
    def fail(_):
        raise OSError("service unavailable")

    monkeypatch.setattr(guest, "reconcile", fail)
    assert guest.step(dict(version=3)) == dict(
        version=3, state="failed", error="runtime_unavailable"
    )


def test_backend_key_not_in_container_command_and_tls_required(tmp_path):
    spec = dict(
        spec=dict(
            preset_id="deepseek-r1-distill-70b",
            image="pinned-image",
            tensor_parallel=2,
            max_model_len=8192,
            max_num_seqs=1,
        ),
        backend_token="private-key",
    )
    args = guest.engine_args(spec, tmp_path, tmp_path / "models", "test")
    assert args[args.index("--gpus") + 1] == "2"
    assert "private-key" not in " ".join(args)
    assert "--ssl-keyfile" in args and "--ssl-certfile" in args
    assert "--disable-log-requests" in args and "--cap-drop=ALL" in args
