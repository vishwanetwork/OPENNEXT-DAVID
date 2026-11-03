"""CPU-only preparation of a clean runtime and model disk, without customer credentials."""

import glob
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

REPORT = {}
PROGRESS = {}


def call(args, **kwargs):
    return subprocess.run(args, check=True, stdin=subprocess.DEVNULL, **kwargs)


def event(state, **fields):
    PROGRESS.update(fields)
    value = dict(
        PROGRESS, event="inference_image_build", state=state, build_id=REPORT.get("build_id")
    )
    PROGRESS["stage"] = state
    print(json.dumps(value), flush=True)
    if REPORT.get("status_url"):
        request = urllib.request.Request(
            REPORT["status_url"],
            data=json.dumps(value).encode(),
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=20):
                pass
        except OSError:
            # A transient reporting outage must not discard downloaded artifacts.
            print(json.dumps(dict(event="progress_delivery_retry", state=state)), flush=True)


def observed(args, state, *, progress_path=None):
    """Bound external work and expose progress without filling the serial console."""
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
        try:
            while True:
                try:
                    result = process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    result = None
                fields = dict(free_root_bytes=shutil.disk_usage("/").free)
                if progress_path and progress_path.exists():
                    fields.update(json.loads(progress_path.read_text()))
                size = os.fstat(output.fileno()).st_size
                fields["command_output"] = os.pread(
                    output.fileno(), 1600, max(0, size - 1600)
                ).decode(errors="replace")
                event(state, **fields)
                if result is not None:
                    if result:
                        raise RuntimeError(f"{state}_exit_{result}")
                    return
                if time.monotonic() > REPORT["deadline"]:
                    raise RuntimeError("cpu_build_deadline_exceeded")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def model_volume_id():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        "http://169.254.169.254/latest/api/token",
        method="PUT",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "300"},
    )
    with opener.open(request, timeout=5) as response:
        token = response.read().decode()
    request = urllib.request.Request(
        "http://169.254.169.254/latest/meta-data/tags/instance/spotbot-model-volume",
        headers={"X-aws-ec2-metadata-token": token},
    )
    with opener.open(request, timeout=5) as response:
        return response.read().decode().strip().replace("-", "")


def model_disk(devices, volume, size):
    candidates = [
        d
        for d in devices
        if d["type"] == "disk"
        and (d.get("serial") or "").replace("-", "") == volume
        and int(d["size"]) == size * 2**30
    ]
    if len(candidates) != 1:
        return None
    disk = candidates[0]
    if disk.get("children"):
        if len(disk["children"]) != 1:
            raise RuntimeError("unsupported_model_disk_layout")
        disk = disk["children"][0]
    if "/" in (disk.get("mountpoints") or []):
        raise RuntimeError("model_disk_cannot_be_root")
    return disk


def run(config):
    REPORT.update(config)
    REPORT["deadline"] = time.monotonic() + config["max_minutes"] * 60
    call(
        [
            "systemd-run",
            "--unit=spotbot-image-deadline",
            f"--on-active={config['max_minutes']}m",
            "/sbin/shutdown",
            "-h",
            "now",
        ]
    )
    os.umask(0o077)
    try:
        event("preparing_runtime")
        if not shutil.which("docker"):
            raise RuntimeError("base_image_requires_docker")
        call(["systemctl", "start", "docker"])
        for _ in range(120):
            devices = json.loads(
                subprocess.check_output(
                    ["lsblk", "-Jb", "--tree", "-o", "PATH,TYPE,FSTYPE,MOUNTPOINTS,SIZE,SERIAL"]
                )
            )["blockdevices"]
            if _ == 0:
                event("checking_model_disk", disks=devices)
            try:
                volume = model_volume_id()
            except OSError:
                time.sleep(2)
                continue
            disk = model_disk(devices, volume, config["disk_gib"])
            if disk:
                break
            time.sleep(2)
        else:
            raise RuntimeError("unique_empty_model_disk_missing")
        device = disk["path"]
        filesystem = disk.get("fstype")
        if not filesystem:
            call(
                ["mkfs.ext4", "-m", "0", device],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            filesystem = "ext4"
        if filesystem not in {"ext4", "xfs"}:
            raise RuntimeError("unsupported_model_filesystem")
        uuid = (
            subprocess.check_output(["blkid", "-s", "UUID", "-o", "value", device]).decode().strip()
        )
        Path("/data/sdf").mkdir(parents=True, exist_ok=True)
        with open("/etc/fstab", "a") as handle:
            handle.write(f"UUID={uuid} /data/sdf {filesystem} defaults,nofail 0 2\n")
        call(["mount", "/data/sdf"])
        model_dir = Path("/data/sdf/spotbot-models") / config["preset_id"] / config["revision"]
        model_dir.mkdir(parents=True, mode=0o700)
        if shutil.disk_usage("/").free < 45 * 2**30:
            raise RuntimeError("insufficient_runtime_disk_space")
        event("pulling_runtime")
        observed(["docker", "pull", config["image"]], "pulling_runtime")
        event("downloading_model")
        observed(
            [
                "docker",
                "run",
                "--rm",
                "--runtime=runc",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--env",
                "HF_HUB_DISABLE_TELEMETRY=1",
                "--env",
                "DO_NOT_TRACK=1",
                "--mount",
                f"type=bind,src={model_dir},dst=/models",
                "--entrypoint",
                "python",
                config["image"],
                "-c",
                config["download"],
                config["repo"],
                config["revision"],
            ],
            "downloading_model",
            progress_path=model_dir / "progress.json",
        )
        counts = json.loads((model_dir / "progress.json").read_text())
        if not counts["total_bytes"] or counts["downloaded_bytes"] != counts["total_bytes"]:
            raise RuntimeError("incomplete_model_artifacts")
        call(["docker", "image", "inspect", config["image"]], stdout=subprocess.DEVNULL)
        manifest = {
            k: config[k] for k in ["build_id", "preset_id", "repo", "revision", "image", "disk_gib"]
        }
        manifest.update(artifact_bytes=counts["total_bytes"], gpu_validation=False)
        Path("/opt/spotbot-cache/manifest.json").write_text(json.dumps(manifest))
        event("sanitizing_image")
        for path in (
            glob.glob("/etc/ssh/ssh_host_*")
            + glob.glob("/home/*/.ssh/authorized_keys")
            + ["/root/.ssh/authorized_keys", "/root/.bash_history"]
        ):
            Path(path).unlink(missing_ok=True)
        for path in ["/etc/spotbot", "/var/lib/spotbot", "/opt/spotbot"]:
            shutil.rmtree(path, ignore_errors=True)
        call(["cloud-init", "clean", "--logs"])
        Path("/etc/machine-id").write_text("")
        # This marker is checked through the EC2 console before publishing an AMI.
        os.sync()
        # Remove the one-object, short-lived status capability before taking any image.
        Path("/opt/spotbot-cache/build.json").unlink(missing_ok=True)
        event("prepared", artifact_bytes=counts["total_bytes"], gpu_validation=False)
        print("SPOTBOT_IMAGE_PREPARED:" + config["build_id"], flush=True)
    except Exception as exc:
        message = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        event(
            "failed",
            error=message,
            http_status=getattr(exc, "code", None),
            stage=PROGRESS.get("stage"),
        )
        raise
    finally:
        os.sync()
        subprocess.run(["shutdown", "-h", "now"], check=False)


if __name__ == "__main__":
    run(json.loads(Path("/opt/spotbot-cache/build.json").read_text()))
