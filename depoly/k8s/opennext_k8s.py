#!/usr/bin/env python3
"""Kubernetes release and migration helpers for OpenNEXT (web, SpotOrderBot, gateway).

Standard library only. Commands that produce secrets write them to stdout for `kubectl apply`
or into private files, and refuse to print them to a terminal. See depoly/k8s/README.md.

  render         Render an overlay with both images pinned to one full commit SHA
  env-secret     Build a Secret manifest from exported KEY=VALUE env files
  aws-config     Convert the Bot host's AWS config to a pod identity role chain
  trust-policy   Add a principal to an IAM role trust policy document
  mysql-setup    Generate database users for a new MySQL server and the Bot/gateway URLs
"""

import argparse
import configparser
import io
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAMESPACE = "opennext"
IMAGES = ("opennext-web", "opennext-spotbot")
PLACEHOLDER = "REPLACE_WITH_"
SHA = re.compile(r"[a-f0-9]{40}")
KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# Set by the images themselves or by the container runtime; never carried into a Secret.
RUNTIME_KEYS = {
    "PATH",
    "HOME",
    "HOSTNAME",
    "LANG",
    "GPG_KEY",
    "PYTHON_VERSION",
    "PYTHON_SHA256",
    "NODE_VERSION",
    "YARN_VERSION",
}
DEFAULT_BOT_ROLE = "arn:aws:iam::860165147463:role/SpotOrderBotEC2Role"
IRSA_TOKEN = "/var/run/secrets/eks.amazonaws.com/serviceaccount/token"


class Invalid(ValueError):
    pass


def pin_images(text, tag):
    """Pin the overlay's RELEASE image tags to one full commit SHA."""
    if not SHA.fullmatch(tag):
        raise Invalid("The release tag must be a full 40-character commit SHA.")
    for name in IMAGES:
        text = re.sub(rf"(image: \S*/{name}):RELEASE\b", rf"\1:{tag}", text)
    if ":RELEASE" in text:
        raise Invalid("An image is still tagged RELEASE.")
    return text


def documents(text):
    return [d for d in re.split(r"^---\s*$", text, flags=re.M) if d.strip()]


def render(overlay, tag=None, kinds=None, allow_placeholders=False):
    text = subprocess.run(
        ["kubectl", "kustomize", str(overlay)], check=True, capture_output=True, text=True
    ).stdout
    if kinds:
        wanted = set(kinds)
        text = "---\n".join(
            d for d in documents(text) if re.search(r"^kind: (\S+)", d, re.M)[1] in wanted
        )
    elif tag is None:
        raise Invalid("Rendering workloads requires --tag.")
    if tag is not None:
        text = pin_images(text, tag)
    if not allow_placeholders and PLACEHOLDER in text:
        names = sorted(set(re.findall(PLACEHOLDER + r"[A-Z_]+", text)))
        raise Invalid("Fill these values in the overlay first: " + ", ".join(names))
    return text


def read_env(path):
    """KEY=VALUE lines as written by the export scripts (docker inspect: raw, unquoted)."""
    values = {}
    for number, line in enumerate(Path(path).read_text().splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not KEY.fullmatch(key):
            raise Invalid(f"{path}:{number} is not a KEY=VALUE line.")
        values[key] = value
    return values


def merge_env(paths, drop=()):
    values = {}
    for path in paths:
        values.update(read_env(path))  # Later files, such as the new MySQL URL, win.
    for key in RUNTIME_KEYS | set(drop):
        values.pop(key, None)
    return values


def secret_manifest(name, values, namespace=NAMESPACE):
    return json.dumps(
        dict(
            apiVersion="v1",
            kind="Secret",
            type="Opaque",
            metadata=dict(name=name, namespace=namespace),
            stringData=values,
        ),
        indent=1,
    )


def aws_config(source, role_arn, identity, irsa_role_arn=""):
    """Replace the EC2 instance role at the head of the Bot's role chain with the pod's identity.

    On the old host every profile started from the instance role (credential_source =
    Ec2InstanceMetadata) and the default account used that role directly. In the cluster the
    pod's own AWS identity assumes the same Bot role first ([default]); every other profile then
    chains from [default], so the trust policies of the accounts it reaches stay unchanged.
    """
    if identity not in {"pod-identity", "irsa"}:
        raise Invalid("Identity must be pod-identity or irsa.")
    if identity == "irsa" and not irsa_role_arn:
        raise Invalid("IRSA needs the pod role ARN.")
    old = configparser.ConfigParser(interpolation=None)
    old.read_string(Path(source).read_text())
    new = configparser.ConfigParser(interpolation=None)
    new["default"] = dict(role_arn=role_arn, role_session_name="spotbot")
    if identity == "pod-identity":
        new["default"]["credential_source"] = "EcsContainer"
    else:
        new["default"]["source_profile"] = "pod"
        new["profile pod"] = dict(role_arn=irsa_role_arn, web_identity_token_file=IRSA_TOKEN)
    for section in old.sections():
        if section in {"default", "profile pod"}:
            continue
        values = dict(old[section])
        if values.pop("credential_source", "") == "Ec2InstanceMetadata":
            values["source_profile"] = "default"
        new[section] = values
    out = io.StringIO()
    new.write(out)
    return out.getvalue()


def trust_policy(document, principal):
    """Allow `principal` (the pod's role) to assume a role, keeping every existing statement."""
    if not re.fullmatch(r"arn:aws:iam::\d{12}:role/[\w+=,.@/-]+", principal):
        raise Invalid("The principal must be an IAM role ARN.")
    policy = json.loads(document)
    statements = policy.setdefault("Statement", [])
    for statement in statements:
        aws = statement.get("Principal", {}).get("AWS", [])
        if statement.get("Effect") == "Allow" and principal in (
            aws if isinstance(aws, list) else [aws]
        ):
            return json.dumps(policy, indent=1)
    statements.append(
        dict(
            Sid="OpenNEXTKubernetesBot",
            Effect="Allow",
            Principal=dict(AWS=principal),
            Action="sts:AssumeRole",
        )
    )
    return json.dumps(policy, indent=1)


def mysql_setup(out, host, port=3306, bot_db="spot_order_bot", gateway_db="spot_order_gateway"):
    """Private files: users for a new server, and the Bot's and gateway's new MySQL URLs."""
    if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host):
        raise Invalid("Use a plain MySQL host name.")
    for name in (bot_db, gateway_db):
        if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", name):
            raise Invalid("Database names may only use letters, digits and underscores.")
    out = Path(out)
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    users = dict(spotbot=bot_db, spotgateway=gateway_db)
    passwords = {user: secrets.token_hex(24) for user in users}
    sql = "".join(
        f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n"
        f"CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY '{passwords[user]}';\n"
        f"ALTER USER '{user}'@'%' IDENTIFIED BY '{passwords[user]}';\n"
        f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{user}'@'%';\n"
        for user, db in users.items()
    )

    def url(user):
        return f"mysql+pymysql://{user}:{passwords[user]}@{host}:{port}/{users[user]}?charset=utf8mb4"

    files = {
        "create-users.sql": sql,
        "bot-override.env": f"SPOTBOT_MYSQL_URL={url('spotbot')}\n",
        "gateway-override.env": f"SPOTBOT_GATEWAY_MYSQL_URL={url('spotgateway')}\n",
    }
    for name, text in files.items():
        path = out / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
    return sorted(files)


def refuse_terminal():
    if sys.stdout.isatty():
        raise Invalid("This prints secrets; pipe it to `kubectl apply -f -` instead.")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    r = sub.add_parser("render")
    r.add_argument("--overlay", default=str(HERE / "overlays" / "production"))
    r.add_argument("--tag", help="Full commit SHA of the images (required for workloads)")
    r.add_argument("--kinds", help="Only these kinds, e.g. Namespace,PersistentVolumeClaim")
    r.add_argument("--allow-placeholders", action="store_true")
    e = sub.add_parser("env-secret")
    e.add_argument("--name", required=True)
    e.add_argument("--drop", default="", help="Comma-separated keys to leave out")
    e.add_argument("files", nargs="+")
    a = sub.add_parser("aws-config")
    a.add_argument("--source", required=True)
    a.add_argument("--role-arn", default=DEFAULT_BOT_ROLE)
    a.add_argument("--identity", choices=["pod-identity", "irsa"], default="pod-identity")
    a.add_argument("--irsa-role-arn", default="")
    t = sub.add_parser("trust-policy")
    t.add_argument("--current", required=True, help="Current policy document (JSON file)")
    t.add_argument("--principal", required=True)
    m = sub.add_parser("mysql-setup")
    m.add_argument("--out", required=True)
    m.add_argument("--host", required=True)
    m.add_argument("--port", type=int, default=3306)
    args = p.parse_args(argv)
    try:
        if args.command == "render":
            kinds = args.kinds.split(",") if args.kinds else None
            print(render(args.overlay, args.tag, kinds, args.allow_placeholders))
        elif args.command == "env-secret":
            refuse_terminal()
            drop = [k for k in args.drop.split(",") if k]
            print(secret_manifest(args.name, merge_env(args.files, drop)))
        elif args.command == "aws-config":
            print(aws_config(args.source, args.role_arn, args.identity, args.irsa_role_arn), end="")
        elif args.command == "trust-policy":
            print(trust_policy(Path(args.current).read_text(), args.principal))
        elif args.command == "mysql-setup":
            print("Wrote " + ", ".join(mysql_setup(args.out, args.host, args.port)))
    except (Invalid, configparser.Error, subprocess.CalledProcessError) as exc:
        stderr = getattr(exc, "stderr", "") or ""
        print(f"error: {exc} {stderr}".strip(), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
