import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from spotbot import guest_inference as guest


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
    assert "private-key" not in " ".join(args)
    assert "--ssl-keyfile" in args and "--ssl-certfile" in args
    assert "--disable-log-requests" in args and "--cap-drop=ALL" in args
