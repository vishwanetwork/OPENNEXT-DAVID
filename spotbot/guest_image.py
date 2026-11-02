"""CPU-only preparation of a clean runtime and model disk, without customer credentials."""

import glob
import json
import os
import shutil
import subprocess
import time
from pathlib import Path


def call(args, **kwargs):
    return subprocess.run(args, check=True, stdin=subprocess.DEVNULL, **kwargs)


def event(state):
    print(json.dumps(dict(event="inference_image_build", state=state)), flush=True)


def run(config):
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
                subprocess.check_output(["lsblk", "-Jb", "-o", "PATH,TYPE,FSTYPE,MOUNTPOINTS,SIZE"])
            )["blockdevices"]
            blank = [
                d
                for d in devices
                if d["type"] == "disk"
                and not d.get("fstype")
                and not d.get("children")
                and not any(d.get("mountpoints") or [])
                and int(d["size"]) == config["disk_gib"] * 2**30
            ]
            if len(blank) == 1:
                break
            time.sleep(2)
        else:
            raise RuntimeError("unique_empty_model_disk_missing")
        device = blank[0]["path"]
        call(["mkfs.ext4", "-m", "0", device], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        uuid = (
            subprocess.check_output(["blkid", "-s", "UUID", "-o", "value", device]).decode().strip()
        )
        Path("/data/sdf").mkdir(parents=True, exist_ok=True)
        with open("/etc/fstab", "a") as handle:
            handle.write(f"UUID={uuid} /data/sdf ext4 defaults,nofail 0 2\n")
        call(["mount", "/data/sdf"])
        model_dir = Path("/data/sdf/spotbot-models") / config["preset_id"] / config["revision"]
        model_dir.mkdir(parents=True, mode=0o700)
        if shutil.disk_usage("/").free < 45 * 2**30:
            raise RuntimeError("insufficient_runtime_disk_space")
        event("pulling_runtime")
        call(
            ["docker", "pull", config["image"]],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        event("downloading_model")
        call(
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
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
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
        print("SPOTBOT_IMAGE_PREPARED:" + config["build_id"], flush=True)
    except Exception as exc:
        print(
            json.dumps(dict(event="inference_image_failed", error=type(exc).__name__)), flush=True
        )
        raise
    finally:
        os.sync()
        subprocess.run(["shutdown", "-h", "now"], check=False)


if __name__ == "__main__":
    run(json.loads(Path("/opt/spotbot-cache/build.json").read_text()))
