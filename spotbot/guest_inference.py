"""Dependency-free guest supervisor for a pinned, lease-bound inference service."""

import argparse
import datetime
import ipaddress
import json
import os
import shutil
import signal
import ssl
import subprocess
import sys
import time
import urllib.request
from contextlib import suppress
from pathlib import Path

ROOT = Path("/var/lib/spotbot/inference")
MODELS = Path("/data/sdf/spotbot-models")
REPOS = {
    "deepseek-r1-distill-7b": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    "deepseek-r1-distill-70b": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
    "deepseek-r1-671b": "deepseek-ai/DeepSeek-R1",
}
DOWNLOAD = """import fnmatch,json,os,sys
from huggingface_hub import HfApi,hf_hub_download
repo,revision=sys.argv[1:]
info=HfApi().model_info(repo,revision=revision,files_metadata=True)
assert info.sha==revision
patterns=['*.safetensors','*.json','*.model','*.tiktoken','*.txt','*.jinja','LICENSE*']
files=[f for f in info.siblings if any(fnmatch.fnmatch(f.rfilename,p) for p in patterns)]
assert files and all(f.size is not None for f in files)
total=sum(f.size for f in files)
assert total < os.statvfs('/models').f_bavail*os.statvfs('/models').f_frsize + sum(os.path.getsize(os.path.join('/models/model',f.rfilename)) for f in files if os.path.isfile(os.path.join('/models/model',f.rfilename)))
done=0
with open('/models/progress.tmp','w') as h:json.dump({'downloaded_bytes':0,'total_bytes':total},h)
os.replace('/models/progress.tmp','/models/progress.json')
for f in files:
 hf_hub_download(repo,f.rfilename,revision=revision,local_dir='/models/model')
 done+=f.size
 with open('/models/progress.tmp','w') as h:json.dump({'downloaded_bytes':done,'total_bytes':total},h)
 os.replace('/models/progress.tmp','/models/progress.json')
"""


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(".tmp")
    with os.fdopen(os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as h:
        json.dump(value, h)
    os.replace(temp, path)


def call(args, *, timeout=30, check=True):
    return subprocess.run(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
        check=check,
    )


def unit(spec):
    return f"spotbot-inference-{int(spec['version'])}-{int(spec['generation'])}"


def stop(name):
    with suppress(OSError, subprocess.SubprocessError):
        call(["systemctl", "stop", name, name + "-expiry"], check=False)
    cleanup(name)


def cleanup(name):
    with suppress(OSError, subprocess.SubprocessError):
        call(["docker", "rm", "-f", name, name + "-download"], check=False)


def expires(spec):
    return datetime.datetime.fromisoformat(spec["expires_at"]).timestamp()


def expire(directory):
    # Separate from the supervisor: Docker containers outlive their launching process.
    while True:
        spec = json.loads((directory / "config.json").read_text())
        if time.time() >= expires(spec):
            cleanup(unit(spec))
            return
        time.sleep(2)


def step(spec):
    try:
        return reconcile(spec)
    except Exception:
        # A service failure must not prevent SSH, backup or interruption heartbeats.
        return dict(version=spec["version"], state="failed", error="runtime_unavailable")


def reconcile(spec):
    """Nonblocking heartbeat-side orchestration; actual preparation runs in its own unit."""
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    active_path = ROOT / "active.json"
    active = json.loads(active_path.read_text()) if active_path.exists() else None
    name = unit(spec)
    if active and (active["unit"] != name or not spec["run"]):
        stop(active["unit"])
        active_path.unlink(missing_ok=True)
        active = None
    if not spec["run"]:
        return dict(version=spec["version"], state="stopped", error="inference_stopped")
    directory = ROOT / name
    if active and active.get("expires_at") != spec["expires_at"]:
        # Update both the independent expiry watcher and systemd's maximum runtime.
        write(directory / "config.json", spec)
        maximum = max(1, int(expires(spec) - active["started_at"]))
        call(["systemctl", "set-property", name, f"RuntimeMaxSec={maximum}"])
        active["expires_at"] = spec["expires_at"]
        write(active_path, active)
    if not active:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        write(directory / "config.json", spec)
        # Replace stale restored state before dispatch, even when a unit name is reused.
        write(directory / "state.json", dict(version=spec["version"], state="queued"))
        remaining = int(
            datetime.datetime.fromisoformat(spec["expires_at"]).timestamp() - time.time()
        )
        if remaining <= 0:
            return dict(version=spec["version"], state="stopped", error="lease_expired")
        call(
            [
                "systemd-run",
                "--unit",
                name,
                "-p",
                "Type=exec",
                "-p",
                "TimeoutStopSec=30",
                "-p",
                f"RuntimeMaxSec={remaining}",
                sys.executable,
                __file__,
                "--run",
                str(directory),
            ]
        )
        write(active_path, dict(unit=name, started_at=time.time(), expires_at=spec["expires_at"]))
    value = json.loads((directory / "state.json").read_text())
    model_dir = MODELS / spec["spec"]["preset_id"] / spec["spec"]["revision"]
    if value["state"] == "downloading" and (model_dir / "progress.json").is_file():
        counts = json.loads((model_dir / "progress.json").read_text())
        for field in ["downloaded_bytes", "total_bytes"]:
            value[field] = max(0, int(counts.get(field, 0)))
    # A stopped/crashed supervisor must not leave a stale ready route indefinitely.
    if value["state"] not in {"failed", "stopped"}:
        status = (
            subprocess.run(["systemctl", "is-active", name], capture_output=True, timeout=5)
            .stdout.decode()
            .strip()
        )
        if status not in {"active", "activating"}:
            value.update(state="failed", error="model_start_failed")
    return value


def engine_args(spec, directory, model_dir, name):
    cfg = spec["spec"]
    args = [
        "docker",
        "run",
        "-d",
        "--name",
        name,
        "--gpus",
        "all",
        "--ipc=host",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "-p",
        "8000:8000",
        "--env-file",
        str(directory / "engine.env"),
        "--mount",
        f"type=bind,src={model_dir},dst=/models",
        "--mount",
        f"type=bind,src={directory},dst=/run/spotbot,readonly",
        "--entrypoint",
        "vllm",
        cfg["image"],
        "serve",
        "/models/model",
        "--served-model-name",
        cfg["preset_id"],
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
        "--tensor-parallel-size",
        str(cfg["tensor_parallel"]),
        "--max-model-len",
        str(cfg["max_model_len"]),
        "--max-num-seqs",
        str(cfg["max_num_seqs"]),
        "--gpu-memory-utilization",
        "0.85",
        "--dtype",
        "float16"
        if cfg["preset_id"].endswith("-7b")
        else "bfloat16"
        if cfg["preset_id"].endswith("70b")
        else "auto",
        "--ssl-keyfile",
        "/run/spotbot/key.pem",
        "--ssl-certfile",
        "/run/spotbot/cert.pem",
        "--disable-log-requests",
        "--disable-log-outputs",
        "--disable-fastapi-docs",
        "--sse-keep-alive-interval",
        "15",
    ]
    return args


def run(directory):
    spec = json.loads((directory / "config.json").read_text())
    cfg = spec["spec"]
    name = unit(spec)
    deadline = min(
        datetime.datetime.fromisoformat(spec["expires_at"]).timestamp(),
        time.time() + cfg["preparation_seconds"],
    )
    phase = "runtime_unavailable"

    def update(state, **fields):
        write(directory / "state.json", dict(version=spec["version"], state=state, **fields))

    def timed(args, limit=None):
        remaining = max(1, int(deadline - time.time()))
        return call(args, timeout=min(remaining, limit) if limit else remaining)

    def interrupted(*_):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        update("preparing_runtime")
        if (
            not shutil.which("docker")
            or not shutil.which("openssl")
            or not os.path.ismount("/data/sdf")
        ):
            raise RuntimeError("runtime_unavailable")
        ip = str(ipaddress.ip_address(spec["server_ip"]))
        model_dir = MODELS / cfg["preset_id"] / cfg["revision"]
        model_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Independent watcher follows paid lease extensions, even if the supervisor dies.
        timed(
            [
                "systemd-run",
                "--unit",
                name + "-expiry",
                sys.executable,
                __file__,
                "--expire",
                str(directory),
            ],
            30,
        )
        timed(["docker", "pull", cfg["image"]])
        timed(
            [
                "docker",
                "run",
                "--rm",
                "--gpus",
                "all",
                "--entrypoint",
                "python",
                cfg["image"],
                "-c",
                "import torch; assert torch.cuda.is_available()",
            ]
        )
        phase = "download_failed"
        update("downloading")
        timed(
            [
                "docker",
                "run",
                "--rm",
                "--name",
                name + "-download",
                "--mount",
                f"type=bind,src={model_dir},dst=/models",
                "--entrypoint",
                "python",
                cfg["image"],
                "-c",
                DOWNLOAD,
                REPOS[cfg["preset_id"]],
                cfg["revision"],
            ]
        )
        phase = "model_start_failed"
        timed(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:3072",
                "-nodes",
                "-days",
                "365",
                "-keyout",
                str(directory / "key.pem"),
                "-out",
                str(directory / "cert.pem"),
                "-subj",
                "/CN=spotbot-inference",
                "-addext",
                f"subjectAltName=IP:{ip},IP:127.0.0.1",
            ]
        )
        os.chmod(directory / "key.pem", 0o600)
        env = (
            "VLLM_API_KEY="
            + spec["backend_token"]
            + "\nVLLM_NO_USAGE_STATS=1\nVLLM_DO_NOT_TRACK=1\nHF_HUB_OFFLINE=1\nTRANSFORMERS_OFFLINE=1\nVLLM_LOGGING_LEVEL=WARNING\n"
        )
        (directory / "engine.env").write_text(env)
        os.chmod(directory / "engine.env", 0o600)
        update("loading")
        timed(engine_args(spec, directory, model_dir, name))
        context = ssl.create_default_context(cafile=str(directory / "cert.pem"))
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context)
        )
        smoke = dict(
            model=cfg["preset_id"],
            messages=[dict(role="user", content="Reply OK.")],
            max_tokens=8,
            temperature=0.6,
        )
        tokens = 0
        while time.time() < deadline:
            try:
                request = urllib.request.Request(
                    "https://127.0.0.1:8000/v1/chat/completions",
                    data=json.dumps(smoke).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + spec["backend_token"],
                    },
                )
                with opener.open(
                    request, timeout=min(120, max(1, deadline - time.time()))
                ) as response:
                    body = json.load(response)
                tokens = int(body.get("usage", {}).get("completion_tokens", 0))
                if tokens > 0 and body.get("choices"):
                    break
            except (OSError, ValueError):
                pass
            time.sleep(5)
        if tokens < 1:
            raise TimeoutError()
        cert = (directory / "cert.pem").read_text()
        update("ready", certificate=cert, smoke_tokens=tokens)
        while time.time() < expires(json.loads((directory / "config.json").read_text())):
            result = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", name],
                capture_output=True,
                timeout=10,
            )
            if result.stdout.strip() != b"true":
                raise RuntimeError("model_start_failed")
            time.sleep(5)
        update("stopped", error="lease_expired")
    except (KeyboardInterrupt, SystemExit):
        update("stopped", error="inference_stopped")
    except (TimeoutError, subprocess.TimeoutExpired):
        update("failed", error="preparation_timeout")
    except Exception:
        update("failed", error=phase)
    finally:
        cleanup(name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--run", type=Path)
    group.add_argument("--expire", type=Path)
    args = parser.parse_args()
    expire(args.expire) if args.expire else run(args.run)
