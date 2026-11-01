#!/usr/bin/env python3
"""Production deployment entry point. All output and operator instructions are English."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from checks import smoke
from config import HERE, Invalid, initialize, load, render, validate, write_private
from operations import Deployment, run


def build_image(config, target, push):
    target = target or config["images"]["web"]
    root = HERE.parent
    revision = run(["git", "-C", str(root), "rev-parse", "HEAD"], capture=True).stdout.strip()
    if not target.endswith(":" + revision):
        raise Invalid("A build target must use the checked-out full Git commit as its tag.")
    run(
        [
            "git",
            "-C",
            str(root),
            "diff",
            "--exit-code",
            "--quiet",
            "HEAD",
            "--",
            "apps",
            "packages",
            "legacy",
            "docker",
            "Dockerfile",
            ".dockerignore",
            "pnpm-lock.yaml",
        ]
    )
    arguments = [
        "docker",
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--file",
        str(root / "Dockerfile"),
        "--tag",
        target,
        "--build-arg",
        "SPOTBOT_SOURCE=image",
        "--build-arg",
        "SPOTBOT_IMAGE=" + config["images"]["bot"],
        "--label",
        "org.opencontainers.image.revision=" + revision,
        "--label",
        "com.opennext.spotbot-image=" + config["images"]["bot"],
    ]
    for key in ("site", "terminal", "admin"):
        arguments += ["--build-arg", key.upper() + "_HOST=" + config["domains"][key]]
    run([*arguments, "--push" if push else "--load", str(root)])
    print("Built the production web release without triggering the 1Panel deployment workflow.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-dir", type=Path, default=HERE / "private")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser(
        "init", help="Generate fresh production settings and unrelated secrets"
    )
    init.add_argument("--domain", default="opennextlab.ai")
    init.add_argument("--web-image", default="")
    init.add_argument("--state-root", default="/opt/opennext-production")
    for name in (
        "render",
        "lock-images",
        "check",
        "prepare",
        "up",
        "status",
        "logs",
        "metadata-check",
        "stop",
    ):
        commands.add_parser(name)
    check = commands.add_parser(
        "smoke", help="Verify HTTPS/authentication; never purchase or send mail"
    )
    check.add_argument("--expect-empty", action="store_true")
    backup = commands.add_parser(
        "backup", help="Quiesce writers and create an encrypted production-only backup"
    )
    backup.add_argument("--recipient", required=True)
    build = commands.add_parser("build-image", help="Build the bundled web image without deploying")
    build.add_argument("--image", default="")
    build.add_argument("--push", action="store_true")
    rollback = commands.add_parser(
        "rollback", help="Restore reviewed image versions, preserving production data"
    )
    rollback.add_argument("--web-image", required=True)
    rollback.add_argument("--bot-image", required=True)
    args = parser.parse_args()
    try:
        if args.command == "init":
            initialize(args.private_dir, args.domain, args.web_image, args.state_root)
            print(
                "Generated fresh production settings. Edit private/settings.json; no test configuration was read."
            )
            return
        config = load(args.private_dir)
        deployment = Deployment(config, args.private_dir)
        if args.command == "render":
            render(config, args.private_dir)
            print("Generated private service env files and HTTPS proxy configuration.")
        elif args.command == "build-image":
            build_image(config, args.image, args.push)
        elif args.command == "lock-images":
            deployment.lock_images()
        elif args.command == "check":
            validate(config, ready=True)
            deployment.configure()
            print(
                "Production configuration and immutable image lock are valid. No credentials were printed."
            )
        elif args.command == "prepare":
            deployment.prepare()
        elif args.command == "up":
            deployment.up()
        elif args.command == "status":
            deployment.configure()
            deployment.compose("ps")
        elif args.command == "logs":
            deployment.configure()
            deployment.compose("logs", "--tail", "100", "web", "bot", "gateway")
        elif args.command == "metadata-check":
            deployment.configure()
            deployment.metadata_probe()
        elif args.command == "smoke":
            deployment.configure()
            deployment.compose(
                "exec",
                "-T",
                "web",
                "/opt/spotbot/bin/python",
                "-c",
                "from spotbot.opennext_files import clamd_scan; clamd_scan('127.0.0.1:3310', b'OpenNEXT production scanner readiness'); print('Production malware scanner is ready.')",
            )
            smoke(config, expect_empty=args.expect_empty)
        elif args.command == "stop":
            deployment.marker()
            deployment.configure()
            deployment.compose("stop", "-t", "60", "web", "bot", "gateway")
        elif args.command == "backup":
            deployment.backup(args.recipient)
        elif args.command == "rollback":
            deployment.marker()
            config["images"].update(web=args.web_image, bot=args.bot_image)
            validate(config, ready=True)
            deployment.lock_images()
            # Check image capabilities before persisting rollback settings. Never downgrade data.
            write_private(args.private_dir / "settings.json", json.dumps(config, indent=2) + "\n")
            deployment.up()
    except (Invalid, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        # Dependency errors can contain environment values. Never dump exception repr or settings.
        print(
            "ERROR: "
            + (
                str(exc)
                if isinstance(exc, Invalid)
                else "Operation failed; check the selected command and private configuration. No credentials were printed."
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
