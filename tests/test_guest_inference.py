import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

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
    assert "--no-enable-log-requests" in args and "--no-enable-log-outputs" in args
    assert "--disable-log-requests" not in args and "--disable-log-outputs" not in args
    assert "--cap-drop=ALL" in args


def test_failure_journal_does_not_expose_exception_arguments(capsys):
    import subprocess

    error = subprocess.CalledProcessError(2, ["docker", "secret-key"], stderr="secret-key")
    guest.failure("model_start_failed", error)
    text = capsys.readouterr().out
    assert "secret-key" not in text
    assert json.loads(text)["exit_code"] == 2


def test_failed_engine_logs_are_private_bounded_and_redacted(tmp_path, monkeypatch):
    import stat

    monkeypatch.setattr(guest.subprocess, "run", lambda *a, **k: SimpleNamespace(
        stdout=b"x" * 10000 + b"private-backend-key", stderr=b"engine argument error"))
    guest.startup_log(tmp_path, "engine", "private-backend-key")
    path = tmp_path / "engine-startup.log"
    assert len(path.read_text()) <= 8192
    assert "private-backend-key" not in path.read_text()
    assert "[redacted]" in path.read_text()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_exited_engine_fails_before_waiting_for_preparation_deadline(tmp_path, monkeypatch):
    cfg = dict(preset_id="deepseek-r1-distill-7b", tensor_parallel=1, revision="a" * 40,
               image="pinned-image", max_model_len=8192, max_num_seqs=1,
               preparation_seconds=1800)
    spec = dict(version=1, generation=1, spec=cfg, backend_token="private-key",
                server_ip="127.0.0.1",
                expires_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat())
    guest.write(tmp_path / "config.json", spec)
    monkeypatch.setattr(guest, "MODELS", tmp_path / "models")
    monkeypatch.setattr(guest.shutil, "which", lambda name: "/usr/bin/" + name)
    monkeypatch.setattr(guest.os.path, "ismount", lambda path: True)
    monkeypatch.setattr(guest.os, "sysconf", lambda name: 4096 if name == "SC_PAGE_SIZE" else 8388608)
    monkeypatch.setattr(guest.os, "cpu_count", lambda: 8)
    monkeypatch.setattr(guest.signal, "signal", lambda *args: None)
    monkeypatch.setattr(guest.ssl, "create_default_context", lambda **kw: None)

    def call(args, **kwargs):
        if args[:2] == ["openssl", "req"]:
            (tmp_path / "key.pem").write_text("test")

    monkeypatch.setattr(guest, "call", call)
    monkeypatch.setattr(guest.subprocess, "run", lambda *args, **kw:
                        SimpleNamespace(returncode=0, stdout=b"false", stderr=b""))
    logs, removed = [], []
    monkeypatch.setattr(guest, "startup_log", lambda *args: logs.append(args))
    monkeypatch.setattr(guest, "cleanup", removed.append)
    guest.run(tmp_path)
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["state"] == "failed" and state["error"] == "model_start_failed"
    assert len(logs) == 1 and removed == [guest.unit(spec)]


@pytest.mark.parametrize(
    "preset,dtype",
    [
        ("deepseek-r1-distill-7b", "float16"),
        ("deepseek-r1-distill-14b", "bfloat16"),
        ("deepseek-r1-distill-32b", "bfloat16"),
        ("deepseek-r1-distill-70b", "bfloat16"),
    ],
)
def test_engine_serves_each_preset_with_its_dtype(tmp_path, preset, dtype):
    spec = dict(
        spec=dict(
            preset_id=preset,
            image="pinned-image",
            tensor_parallel=1,
            max_model_len=8192,
            max_num_seqs=1,
        ),
        backend_token="k",
    )
    args = guest.engine_args(spec, tmp_path, tmp_path / "models", "test")
    assert args[args.index("--dtype") + 1] == dtype


def test_download_fetches_shards_in_parallel_and_reports_progress(tmp_path):
    """Run the guest download script against a fake hub: all shards land, progress is exact."""
    import subprocess
    import sys
    import textwrap

    hub = tmp_path / "fake" / "huggingface_hub"
    hub.mkdir(parents=True)
    (hub / "__init__.py").write_text(
        textwrap.dedent(
            """
            import os, threading, time
            from types import SimpleNamespace
            active = [0, 0]
            lock = threading.Lock()
            FILES = [SimpleNamespace(rfilename=f"model-{i}.safetensors", size=10 + i) for i in range(6)]
            FILES += [SimpleNamespace(rfilename="config.json", size=3), SimpleNamespace(rfilename="x.bin", size=99)]
            class HfApi:
                def model_info(self, repo, revision, files_metadata):
                    return SimpleNamespace(sha=revision, siblings=FILES)
            def hf_hub_download(repo, name, revision, local_dir):
                with lock:
                    active[0] += 1
                    active[1] = max(active[1], active[0])
                time.sleep(0.05)
                size = next(f.size for f in FILES if f.rfilename == name)
                os.makedirs(local_dir, exist_ok=True)
                open(os.path.join(local_dir, name), "wb").write(b"x" * size)
                with lock:
                    active[0] -= 1
                open(os.path.join(os.environ["PEAK"]), "w").write(str(active[1]))
            """
        )
    )
    models = tmp_path / "models"
    (models / "model").mkdir(parents=True)
    script = guest.DOWNLOAD.replace("/models", str(models))
    peak = tmp_path / "peak"
    subprocess.run(
        [sys.executable, "-c", script, "repo", "a" * 40],
        check=True,
        env={"PYTHONPATH": str(tmp_path / "fake"), "PEAK": str(peak)},
    )
    assert json.loads((models / "progress.json").read_text()) == {
        "downloaded_bytes": sum(10 + i for i in range(6)) + 3,
        "total_bytes": sum(10 + i for i in range(6)) + 3,
    }
    assert not (models / "model" / "x.bin").exists()
    assert int(peak.read_text()) > 1
