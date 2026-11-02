"""Dependency-free Linux guest agent, installed by the protected-server bootstrap."""

import hashlib
import json
import os
import pwd
import shlex
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def command(*args, timeout=5):
    return subprocess.check_output(args, timeout=timeout, stderr=subprocess.DEVNULL).decode()


KEYS_BEGIN = "# BEGIN spotbot managed keys"
KEYS_END = "# END spotbot managed keys"


def install_keys(spec):
    """Replace the managed block of the user's authorized_keys; other lines stay as they are."""
    user = pwd.getpwnam(spec["user"])
    keys = [k for k in spec["keys"] if isinstance(k, str) and k and "\n" not in k and "\r" not in k]
    directory = Path(user.pw_dir) / ".ssh"
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chown(directory, user.pw_uid, user.pw_gid)
    path = directory / "authorized_keys"
    lines = path.read_text().splitlines() if path.exists() else []
    kept, inside = [], False
    for line in lines:
        if line == KEYS_BEGIN:
            inside = True
        elif line == KEYS_END:
            inside = False
        elif not inside:
            kept.append(line)
    staged = directory / ".authorized_keys.spotbot"
    staged.write_text("\n".join([*kept, KEYS_BEGIN, *keys, KEYS_END]) + "\n")
    os.chmod(staged, 0o600)
    os.chown(staged, user.pw_uid, user.pw_gid)
    os.replace(staged, path)


TASK_ROOT = Path("/var/lib/spotbot/task")
TASK_LOGS = Path("/var/log/spotbot-task")
TASK_TAIL = 4096


def task_unit(spec):
    return f"spotbot-task-{int(spec['version'])}-{int(spec['attempt'])}"


def unit_state(unit):
    output = subprocess.run(
        [
            "systemctl",
            "show",
            unit,
            "-p",
            "LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus",
        ],
        capture_output=True,
        timeout=10,
        check=False,
    ).stdout.decode()
    return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)


def start_task(spec, user, run_dir, log):
    """Start the customer's script as a transient systemd unit running as the SSH user."""
    account = pwd.getpwnam(user)
    run_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(run_dir, account.pw_uid, account.pw_gid)
    env = dict(spec.get("env") or {}, **(spec.get("secrets") or {}))
    env.update(
        SPOTBOT_TASK_VERSION=str(spec["version"]),
        SPOTBOT_ATTEMPT=str(spec["attempt"]),
        SPOTBOT_RESUMED="1" if spec.get("resumed") else "0",
    )
    for name, text in (
        ("run.sh", spec["script"]),
        ("env.sh", "".join(f"{k}={shlex.quote(v)}\n" for k, v in env.items())),
    ):
        path = run_dir / name
        path.write_text(text)
        os.chmod(path, 0o600)
        os.chown(path, account.pw_uid, account.pw_gid)
    TASK_LOGS.mkdir(mode=0o755, parents=True, exist_ok=True)
    # The log may hold whatever the script prints: readable by the SSH user, not by everyone.
    os.close(os.open(log, os.O_CREAT | os.O_WRONLY, 0o640))
    os.chmod(log, 0o640)
    os.chown(log, 0, account.pw_gid)
    args = [
        "systemd-run",
        "--unit",
        task_unit(spec),
        "--uid",
        user,
        "--gid",
        str(account.pw_gid),
        "-p",
        "WorkingDirectory=" + account.pw_dir,
        "-p",
        "RemainAfterExit=yes",
        "-p",
        f"StandardOutput=append:{log}",
        "-p",
        f"StandardError=append:{log}",
        "-p",
        "KillMode=mixed",
    ]
    if spec.get("max_minutes"):
        args += ["-p", f"RuntimeMaxSec={int(spec['max_minutes']) * 60}"]
    args += [
        "/bin/bash",
        "-c",
        'set -a; . "$0"; set +a; exec /bin/bash "$1"',
        str(run_dir / "env.sh"),
        str(run_dir / "run.sh"),
    ]
    subprocess.run(args, check=True, timeout=30, capture_output=True)


def log_tail(log, secrets):
    try:
        with open(log, "rb") as handle:
            handle.seek(max(0, os.path.getsize(log) - TASK_TAIL))
            text = handle.read().decode(errors="replace")
    except OSError:
        return ""
    for value in sorted(secrets, key=len, reverse=True):
        if len(value) >= 4:
            text = text.replace(value, "[redacted]")
    return "".join(c for c in text if c in "\n\t" or c >= " ")


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def step_task(spec, user, interrupted):
    """Start, watch or stop one task run; returns its report.

    The run's state lives in files beside its directory, so an agent restart neither starts it
    twice nor loses its result. A run whose unit vanished (the server rebooted) is stopped.
    """
    name = f"{int(spec['version'])}-{int(spec['attempt'])}"
    TASK_ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    result_path, marker = TASK_ROOT / (name + ".json"), TASK_ROOT / (name + ".started")
    run_dir, log = TASK_ROOT / name, TASK_LOGS / (name + ".log")
    unit = task_unit(spec)
    report = dict(version=spec["version"], attempt=spec["attempt"])
    if result_path.exists():
        return dict(report, **json.loads(result_path.read_text()))
    started = json.loads(marker.read_text()) if marker.exists() else None
    status = unit_state(unit)
    if started is None and status.get("LoadState") == "loaded":
        started = dict(started_at=now_iso())  # Started before the marker was written.
        marker.write_text(json.dumps(started))
    result = None
    if started is None:
        if spec.get("stop"):
            result = dict(state="stopped", exit_code=None, started_at=None)
        else:
            start_task(spec, user, run_dir, log)
            started = dict(started_at=now_iso())
            marker.write_text(json.dumps(started))
            status = unit_state(unit)
    if result is None:
        active, sub = status.get("ActiveState"), status.get("SubState")
        if spec.get("stop") and active in {"active", "activating"} and sub != "exited":
            subprocess.run(["systemctl", "stop", unit], timeout=120, check=False)
            result = dict(state="stopped", exit_code=None)
        elif interrupted and not started.get("interrupted") and sub == "running":
            # The two-minute Spot notice: let the task checkpoint before the server goes.
            subprocess.run(["systemctl", "kill", "--signal=SIGTERM", unit], timeout=10, check=False)
            started["interrupted"] = True
            marker.write_text(json.dumps(started))
        elif status.get("LoadState") != "loaded":
            result = dict(
                state="interrupted" if started.get("interrupted") else "stopped", exit_code=None
            )
        elif (active == "active" and sub == "exited") or active == "failed":
            code = int(status.get("ExecMainStatus") or 0)
            exited = status.get("ExecMainCode") == "1"
            succeeded = active == "active" and exited and code == 0
            result = dict(
                state="interrupted"
                if started.get("interrupted")
                else "succeeded"
                if succeeded
                else "failed",
                exit_code=code if exited else 128 + code,
            )
        if result is None:
            return dict(
                report,
                state="running",
                exit_code=None,
                started_at=started["started_at"],
                log_tail=log_tail(log, (spec.get("secrets") or {}).values()),
            )
    result.setdefault("started_at", started and started["started_at"])
    result.update(
        finished_at=now_iso(), log_tail=log_tail(log, (spec.get("secrets") or {}).values())
    )
    result_path.write_text(json.dumps(result))
    try:
        (run_dir / "env.sh").unlink()
    except OSError:
        pass
    return dict(report, **result)


def metadata(path):
    request = urllib.request.Request(
        "http://169.254.169.254/latest/api/token",
        method="PUT",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=2) as response:
        token = response.read().decode()
    request = urllib.request.Request(
        "http://169.254.169.254/latest/meta-data/" + path,
        headers={"X-aws-ec2-metadata-token": token},
    )
    with opener.open(request, timeout=2) as response:
        return response.read().decode()


def disks():
    devices = json.loads(
        command("lsblk", "-J", "-b", "-o", "NAME,TYPE,SERIAL,FSTYPE,UUID,MOUNTPOINTS,SIZE")
    )["blockdevices"]
    result = []

    def visit(device, serial=""):
        serial = device.get("serial") or serial
        if serial.startswith("vol"):
            identity = "vol-" + serial.removeprefix("vol").lstrip("-")
            result.append(dict(device=device, volume_id=identity))
        for child in device.get("children", []):
            visit(child, serial)

    for device in devices:
        visit(device)
    return result


def initialize_disk(instruction):
    for entry in disks():
        device = entry["device"]
        if entry["volume_id"] != instruction["volume_id"] or device["type"] != "disk":
            continue
        target = "/data/" + instruction["device"].split("/")[-1]
        if device.get("children"):
            return  # Never format a partitioned device.
        path = "/dev/" + device["name"]
        if not device.get("fstype"):
            command("mkfs.ext4", "-F", path, timeout=60)
        uuid = command("blkid", "-s", "UUID", "-o", "value", path).strip()
        fstab = Path("/etc/fstab")
        filesystem = device.get("fstype") or "ext4"
        line = f"UUID={uuid} {target} {filesystem} defaults,nofail 0 2\n"
        if f"UUID={uuid} " not in fstab.read_text():
            with fstab.open("a") as handle:
                handle.write(line)
        Path(target).mkdir(parents=True, exist_ok=True)
        if not os.path.ismount(target):
            command("mount", target, timeout=20)


# Filesystems the kernel can freeze; others (e.g. vfat /boot/efi) are left as they are.
FREEZABLE = {"ext4", "xfs", "btrfs"}
# Thaw on our own only if the bot never terminates this server; the bot gives up on a
# frozen snapshot long before this, so a thaw can never follow a capture it relies on.
FREEZE_WATCHDOG_SECONDS = 900


def protected_mounts():
    """Mounted filesystems on the rental's EBS volumes, root last."""
    found = set()
    for entry in disks():
        device = entry["device"]
        for mount in device.get("mountpoints") or []:
            if mount and mount.startswith("/") and device.get("fstype") in FREEZABLE:
                found.add(mount)
    return sorted(found, key=lambda m: (m == "/", m))


def freeze(mounts):
    """Freeze every mount or none: a partial freeze is undone before failing."""
    frozen = []
    try:
        for mount in mounts:
            command("fsfreeze", "--freeze", mount, timeout=30)
            frozen.append(mount)
    except Exception:
        thaw(frozen)
        raise
    return frozen


def thaw(mounts):
    for mount in reversed(mounts):
        try:
            command("fsfreeze", "--unfreeze", mount, timeout=30)
        except Exception:
            pass


def pre_backup():
    hook = Path("/etc/spotbot/pre-backup")
    if hook.is_file() and os.access(hook, os.X_OK):
        subprocess.run(
            [str(hook)],
            timeout=8,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    os.sync()


def collect(config, frozen=False):
    entries = disks()
    mounts, canaries = [], {}
    for entry in entries:
        for mount in entry["device"].get("mountpoints") or []:
            if not mount or not mount.startswith("/"):
                continue
            mounts.append(mount)
            path = Path(mount) / ".spotbot-restore-canary"
            if config.get("create_canaries") and not path.exists():
                path.write_bytes(os.urandom(64))
                os.sync()
            if path.is_file():
                canaries[entry["volume_id"]] = hashlib.sha256(path.read_bytes()).hexdigest()
    report = dict(
        rental_id=config["rental_id"],
        generation=config["generation"],
        instance_id=metadata("instance-id"),
        token=config["token"],
        mounts=sorted(set(mounts)),
        volume_ids=sorted({e["volume_id"] for e in entries}),
        canaries=canaries,
    )
    try:
        if frozen:
            # Tools that may write logs would block on a frozen filesystem.
            raise OSError("frozen")
        output = command(
            "nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"
        )
        gpu = [row.rsplit(",", 1) for row in output.strip().splitlines()]
        report.update(
            gpu_model=gpu[0][0].strip(),
            gpu_count=len(gpu),
            gpu_memory_mib=min(int(m[1].strip()) for m in gpu),
        )
    except (subprocess.SubprocessError, OSError, ValueError, IndexError):
        pass
    try:
        with socket.create_connection(("127.0.0.1", 22), timeout=1):
            report["ssh_ready"] = True
    except OSError:
        pass
    try:
        notice = json.loads(metadata("spot/instance-action"))
        report.update(interruption=True, interruption_at=notice.get("time"))
    except (OSError, ValueError):
        pass
    return report


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def run():
    from spotbot_inference import step as step_inference

    config_path = Path("/etc/spotbot/agent.json")
    flushed = None
    # (command, mounts, watchdog deadline). While frozen nothing below may write to disk.
    frozen = None
    thawed = None
    keys_version = None
    task_spec, task_user, task_report = None, "ubuntu", None
    inference_spec, inference_report = None, None
    last_report = 0.0
    opener = urllib.request.build_opener(NoRedirect)
    while True:
        try:
            config = json.loads(config_path.read_text())
            if frozen and time.monotonic() >= frozen[2]:
                thaw(frozen[1])
                thawed, frozen = frozen[0], None
                last_report = 0.0
            if frozen:
                config = dict(config, create_canaries=False)
            # Check warnings every five seconds, even between ordinary heartbeats.
            notice = False
            try:
                notice = bool(json.loads(metadata("spot/instance-action")))
            except (OSError, ValueError):
                pass
            if notice or time.monotonic() - last_report >= 15:
                report = collect(config, frozen=bool(frozen))
                report["flushed_command"] = flushed
                report["freeze_supported"] = shutil.which("fsfreeze") is not None
                report["frozen_command"] = frozen[0] if frozen else None
                report["thawed_command"] = thawed
                report["ssh_keys_version"] = keys_version
                report["task"] = task_report
                report["inference"] = inference_report
                request = urllib.request.Request(
                    config["url"] + "/v1/agents/report",
                    data=json.dumps(report).encode(),
                    headers={"Content-Type": "application/json"},
                )
                with opener.open(request, timeout=8) as response:
                    instructions = json.load(response)
                last_report = time.monotonic()
                if not frozen:
                    for disk in instructions.get("initialize_disks", []):
                        initialize_disk(disk)
                    if bool(instructions.get("create_canaries")) != bool(
                        config.get("create_canaries")
                    ):
                        config["create_canaries"] = bool(instructions.get("create_canaries"))
                        config_path.write_text(json.dumps(config))
                    keys = instructions.get("authorized_keys")
                    if keys and keys.get("version") != keys_version:
                        install_keys(keys)
                        keys_version = keys["version"]
                        last_report = 0.0
                    if instructions.get("task"):
                        task_spec = instructions["task"]
                        task_user = keys["user"] if keys else "ubuntu"
                    desired = instructions.get("inference")
                    if desired is not None:
                        inference_spec = desired
                    if inference_spec:
                        desired = (
                            dict(inference_spec, run=False)
                            if notice or desired is None
                            else desired
                        )
                        inference_report = step_inference(desired)
                    # A Spot warning moves the rental to recovery, which stops the bot sending
                    # the task; the run it already started must still get its SIGTERM.
                    if task_spec and (instructions.get("task") or notice):
                        previous = (task_report or {}).get("state")
                        task_report = step_task(task_spec, task_user, notice)
                        if previous != task_report["state"]:
                            last_report = 0.0
                identity = instructions.get("flush_command")
                if identity and identity != flushed:
                    if not frozen:  # A frozen filesystem is already synced; sync would block.
                        pre_backup()
                    flushed = identity
                    last_report = 0.0
                identity = instructions.get("freeze_command")
                if identity and not frozen and identity != thawed:
                    pre_backup()
                    # Stay frozen until the bot terminates this server (or the watchdog).
                    frozen = (
                        identity,
                        freeze(protected_mounts()),
                        time.monotonic() + FREEZE_WATCHDOG_SECONDS,
                    )
                    last_report = 0.0
        except Exception:
            # Never log bearer material or arbitrary server response bodies.
            print("Guest agent cycle failed; retrying", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    run()
