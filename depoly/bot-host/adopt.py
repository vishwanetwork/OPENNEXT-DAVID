#!/usr/bin/env python3
"""Move the bot host to the compose files in this directory, once. Standard library only.

Until now the running containers took part of their settings from hand-kept compose overlays
next to the releases (AWS accounts, the B300 price profile, the gateway's inference timeout),
and those overlays also pinned the image. This script:

1. reads the environment of the running `spot-order-bot` and `spot-order-gateway` containers;
2. adds every setting the overlays supplied to `.env` / `.env.gateway`, so the env files
   alone hold the full configuration;
3. renders compose.bot.yaml and compose.gateway.yaml with those env files and checks that
   they would start each container with exactly the environment it runs with now;
4. copies the AWS config the Bot mounts today to $SPOTBOT_HOME/aws/config.

It restarts nothing. Without --write it only reports (key names, never values). With --write
it backs up both env files first, then marks the host as adopted (state/adopted), which
release.sh requires before it replaces the Bot or the gateway. Run it on the bot host as root:

    sudo python3 depoly/bot-host/adopt.py            # report
    sudo python3 depoly/bot-host/adopt.py --write    # apply
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICES = {
    # service: (container, compose file, env file name, compose service)
    "spotbot": ("spot-order-bot", "compose.bot.yaml", ".env", "spotbot"),
    "gateway": ("spot-order-gateway", "compose.gateway.yaml", ".env.gateway", "gateway"),
}
AWS_CONFIG_TARGET = "/app/aws/config"


def docker_json(*args):
    return json.loads(subprocess.run(["docker", *args], check=True, capture_output=True, text=True).stdout)


def env_list(items):
    return dict(item.split("=", 1) for item in items or [])


def read_env_file(path):
    """KEY=VALUE lines as docker compose reads the simple cases: optional `export `, matching
    single or double quotes stripped. Compose's own result is checked afterwards anyway."""
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.removeprefix("export ").strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    return values


def quoted(key, value):
    if "'" in value or "\n" in value:
        sys.exit(f"{key}: value contains a single quote or newline; add it by hand")
    return f"{key}='{value}'"


def updated_env_text(text, changes, stamp):
    """Replace changed keys in place; append new ones under one comment."""
    lines, seen = [], set()
    for line in text.splitlines():
        stripped = line.strip()
        key = stripped.split("=", 1)[0].removeprefix("export ").strip() if "=" in stripped else ""
        if key in changes and not stripped.startswith("#"):
            if key not in seen:
                lines.append(quoted(key, changes[key]))
                seen.add(key)
            continue
        lines.append(line)
    added = [key for key in changes if key not in seen]
    if added:
        lines += ["", f"# Moved here from the compose overlays by adopt.py on {stamp}"]
        lines += [quoted(key, changes[key]) for key in added]
    return "\n".join(lines) + "\n"


def compose_environment(compose_file, home, service):
    env = {**os.environ, "SPOTBOT_HOME": str(home), "SPOTBOT_IMAGE": "adopt-check:local"}
    out = subprocess.run(
        ["docker", "compose", "-f", str(compose_file), "config", "--format", "json"],
        check=True, capture_output=True, text=True, env=env,
    ).stdout
    return {k: "" if v is None else str(v) for k, v in json.loads(out)["services"][service]["environment"].items()}


def plan(home):
    results = {}
    for name, (container, compose_file, env_name, service) in SERVICES.items():
        info = docker_json("inspect", container)[0]
        running = env_list(info["Config"]["Env"])
        image_env = env_list(docker_json("image", "inspect", info["Image"])[0]["Config"]["Env"])
        env_path = home / env_name
        file_env = read_env_file(env_path)
        # Settings the container has that the env file lacks or overrides came from overlays,
        # apart from what the image itself sets.
        changes = {
            key: value
            for key, value in running.items()
            if file_env.get(key) != value and not (image_env.get(key) == value and key not in file_env)
        }
        compose_only = {"AWS_CONFIG_FILE"} if name == "spotbot" else {
            "AWS_EC2_METADATA_DISABLED", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE",
        }
        changes = {k: v for k, v in changes.items() if k not in compose_only}
        pending = sorted(k for k in file_env if k not in running)
        mounts = {m["Destination"]: m["Source"] for m in info["Mounts"]}
        results[name] = {
            "container": container, "compose_file": HERE / compose_file, "service": service,
            "env_path": env_path, "running": running, "image_env": image_env,
            "changes": changes, "pending": pending, "aws_source": mounts.get(AWS_CONFIG_TARGET),
        }
    return results


def verify(results, stamp):
    """Render both compose files against the candidate env files in a scratch home."""
    with tempfile.TemporaryDirectory() as scratch:
        scratch = Path(scratch)
        (scratch / "aws").mkdir()
        (scratch / "aws" / "config").write_text("")
        for result in results.values():
            text = result["env_path"].read_text()
            (scratch / result["env_path"].name).write_text(updated_env_text(text, result["changes"], stamp))
        failures = []
        for name, result in results.items():
            rendered = compose_environment(result["compose_file"], scratch, result["service"])
            expected = {
                k: v for k, v in result["running"].items()
                if not (result["image_env"].get(k) == v and k not in rendered)
            }
            differ = sorted(k for k in set(expected) | set(rendered) if expected.get(k) != rendered.get(k))
            if differ:
                failures.append(f"{name}: would differ from the running container in {', '.join(differ)}")
            else:
                print(f"{name}: the new compose file reproduces the running environment ({len(expected)} keys)")
        return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--home", default=os.environ.get("SPOTBOT_HOME", "/opt/spot-order-bot"))
    parser.add_argument("--write", action="store_true", help="back up and update the env files, copy the AWS config")
    parser.add_argument("--accept-pending", action="store_true",
                        help="continue although the env files hold keys the running containers lack")
    args = parser.parse_args()
    if os.geteuid() != 0:
        sys.exit("run as root (sudo)")
    home = Path(args.home)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    results = plan(home)

    for name, result in results.items():
        print(f"{name} ({result['env_path']}):")
        print(f"  add or update: {', '.join(sorted(result['changes'])) or 'nothing'}")
        if result["pending"]:
            print(f"  in the env file but not in the running container: {', '.join(result['pending'])}")
    aws_source = results["spotbot"]["aws_source"]
    aws_target = home / "aws" / "config"
    print(f"AWS config: {aws_source or 'not mounted'} -> {aws_target}")

    failures = verify(results, stamp)
    pending = any(r["pending"] for r in results.values())
    if failures:
        sys.exit("\n".join(failures))
    if pending and not args.accept_pending:
        sys.exit("The env files changed since the containers started; restart them first or pass --accept-pending")
    if not aws_source and not aws_target.exists():
        sys.exit("The Bot has no AWS config mounted and none exists at the target; create it first")
    if not args.write:
        print("Report only. Re-run with --write to apply.")
        return

    for result in results.values():
        path = result["env_path"]
        if result["changes"]:
            backup = path.with_name(f"{path.name}.bak-{stamp}-adopt")
            shutil.copy2(path, backup)
            path.write_text(updated_env_text(path.read_text(), result["changes"], stamp))
            print(f"updated {path} (backup {backup.name})")
    if aws_source and Path(aws_source).resolve() != aws_target.resolve():
        aws_target.parent.mkdir(mode=0o755, exist_ok=True)
        shutil.copy2(aws_source, aws_target)
        stat = Path(aws_source).stat()
        os.chown(aws_target, stat.st_uid, stat.st_gid)
        print(f"copied the AWS config to {aws_target}")
    state = home / "state"
    state.mkdir(exist_ok=True)
    (state / "adopted").write_text(f"{stamp}\n")
    print("Done. Nothing was restarted; the next release.sh run uses the new layout.")


if __name__ == "__main__":
    main()
