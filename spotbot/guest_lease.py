"""Dependency-free execution deadline, independent of the network-facing agent loop."""

import datetime
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/var/lib/spotbot/execution")
UNIT = "spotbot-execution-deadline"


def step(spec):
    if not spec:
        return
    deadline = datetime.datetime.fromisoformat(spec["expires_at"]).timestamp()
    if deadline > time.time() + 305:
        raise ValueError("execution_deadline_too_distant")
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = ROOT / "lease.json"
    temporary = ROOT / "lease.tmp"
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(dict(expires_at=deadline), f)
    os.replace(temporary, path)
    active = subprocess.run(["systemctl", "is-active", UNIT], capture_output=True, timeout=5)
    if active.stdout.strip() not in {b"active", b"activating"}:
        subprocess.run(
            ["systemd-run", "--unit", UNIT, "-p", "Restart=on-failure",
             "-p", "RestartSec=1", sys.executable, __file__, "--watch", str(path)],
            check=True, capture_output=True, timeout=10,
        )


def watch(path):
    while True:
        deadline = json.loads(Path(path).read_text())["expires_at"]
        if time.time() >= deadline:
            subprocess.run(["/sbin/shutdown", "-h", "now"], check=True, timeout=15)
            return
        time.sleep(2)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--watch":
        raise SystemExit("Use --watch with the private execution lease path")
    watch(sys.argv[2])
