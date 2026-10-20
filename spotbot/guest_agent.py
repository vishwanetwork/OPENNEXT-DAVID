"""Dependency-free Linux guest agent, installed by the protected-server bootstrap."""

import hashlib
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def command(*args, timeout=5):
    return subprocess.check_output(args, timeout=timeout, stderr=subprocess.DEVNULL).decode()


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


def collect(config):
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
    config_path = Path("/etc/spotbot/agent.json")
    flushed = None
    last_report = 0.0
    opener = urllib.request.build_opener(NoRedirect)
    while True:
        try:
            config = json.loads(config_path.read_text())
            # Check warnings every five seconds, even between ordinary heartbeats.
            notice = False
            try:
                notice = bool(json.loads(metadata("spot/instance-action")))
            except (OSError, ValueError):
                pass
            if notice or time.monotonic() - last_report >= 15:
                report = collect(config)
                report["flushed_command"] = flushed
                request = urllib.request.Request(
                    config["url"] + "/v1/agents/report",
                    data=json.dumps(report).encode(),
                    headers={"Content-Type": "application/json"},
                )
                with opener.open(request, timeout=8) as response:
                    instructions = json.load(response)
                last_report = time.monotonic()
                for disk in instructions.get("initialize_disks", []):
                    initialize_disk(disk)
                if bool(instructions.get("create_canaries")) != bool(config.get("create_canaries")):
                    config["create_canaries"] = bool(instructions.get("create_canaries"))
                    config_path.write_text(json.dumps(config))
                identity = instructions.get("flush_command")
                if identity and identity != flushed:
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
                    flushed = identity
                    last_report = 0.0
        except Exception:
            # Never log bearer material or arbitrary server response bodies.
            print("Guest agent cycle failed; retrying", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    run()
