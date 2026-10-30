#!/usr/bin/env bash
# Paste this entire file into the Autopilot Script field. No downloads are required.
set -euo pipefail
exec python3 -u - <<'PY'
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


def log(event, **values):
    print(json.dumps(dict(at=datetime.now(timezone.utc).isoformat(), event=event, **values)), flush=True)


def number(name, default, minimum, maximum):
    value = float(os.environ.get(name, default))
    if not minimum <= value <= maximum:
        raise ValueError(name + " is outside the demo limits")
    return value


name = os.environ.get("DEMO_NAME", "autopilot-demo")
if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
    raise ValueError("DEMO_NAME must contain only letters, digits, underscores and hyphens")
mode = os.environ.get("DEMO_MODE", "success")
if mode not in {"success", "failure", "long"}:
    raise ValueError("DEMO_MODE must be success, failure or long")
steps = int(number("DEMO_STEPS", "12", 1, 10000))
delay = number("DEMO_STEP_SECONDS", "5", 0.01, 60)
fail_at = int(number("DEMO_FAIL_AT", "4", 1, steps)) if mode == "failure" else None
attempt = os.environ.get("SPOTBOT_ATTEMPT", "local")
resumed = os.environ.get("SPOTBOT_RESUMED", "0") == "1"
root = Path.home() / "autopilot-demo" / name
root.mkdir(parents=True, exist_ok=True)
os.chmod(root, 0o700)
checkpoint = root / "checkpoint.json"
config = dict(name=name, mode=mode, steps=steps, fail_at=fail_at)
fingerprint = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
completed = 0
if resumed and checkpoint.exists():
    old = json.loads(checkpoint.read_text())
    if old.get("fingerprint") != fingerprint:
        raise ValueError("The restored checkpoint belongs to a different demo configuration")
    completed = int(old["completed_steps"])
    if not 0 <= completed <= steps:
        raise ValueError("Invalid checkpoint progress")
    log("checkpoint_loaded", completed_steps=completed, previous_attempt=old.get("attempt"))
elif resumed:
    log("checkpoint_missing", note="The selected recovery point has no demo checkpoint; starting at step 1")


def save(state):
    value = dict(config, fingerprint=fingerprint, completed_steps=completed,
                 attempt=attempt, state=state, updated_at=datetime.now(timezone.utc).isoformat())
    # Each checkpoint is durable and atomic; the selected disk snapshot defines recovery progress.
    with tempfile.NamedTemporaryFile(mode="w", dir=root, delete=False) as stream:
        path = Path(stream.name)
        try:
            os.chmod(path, 0o600)
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(path, checkpoint)
        finally:
            path.unlink(missing_ok=True)
    descriptor = os.open(root, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


stopping = False


def stop(_signum, _frame):
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
log("started", **config, attempt=attempt, resumed=resumed,
    output_dir=str(root), secret_present=bool(os.environ.get("DEMO_SECRET")))
save("running")
try:
    result = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                            capture_output=True, text=True, timeout=10, check=True)
    log("gpu_detected", devices=result.stdout.strip())
except (OSError, subprocess.SubprocessError):
    log("gpu_not_available")
    if os.environ.get("DEMO_REQUIRE_GPU", "1") == "1":
        save("failed")
        sys.exit(2)

gpu_work = None
if os.environ.get("DEMO_GPU_WORK", "1") == "1":
    try:
        import torch
        if torch.cuda.is_available():
            tensor = torch.ones((256, 256), device="cuda")
            gpu_work = lambda: float((tensor @ tensor)[0, 0].item())
    except ImportError:
        pass
log("workload", engine="pytorch_cuda" if gpu_work else "python_checksum",
    note="GPU detection alone is not a GPU compute benchmark")

for step in range(completed + 1, steps + 1):
    deadline = time.monotonic() + delay
    while time.monotonic() < deadline and not stopping:
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))
    if stopping:
        break
    checksum = hashlib.sha256((name + ":" + str(step)).encode()).hexdigest()
    gpu_value = gpu_work() if gpu_work else None
    completed = step
    save("running")
    log("progress", step=step, total=steps, checksum=checksum[:12], gpu_value=gpu_value)
    if mode == "failure" and step == fail_at:
        save("failed")
        log("intentional_failure", exit_code=42, checkpoint=str(checkpoint))
        sys.exit(42)

if stopping:
    save("interrupted")
    log("termination_checkpoint_saved", completed_steps=completed, checkpoint=str(checkpoint))
    sys.exit(143)
save("succeeded")
log("succeeded", completed_steps=completed, checkpoint=str(checkpoint))
PY
