"""Explicit operator actions for a fresh, isolated production Compose project."""

import hashlib
import ipaddress
import json
import os
import platform
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from config import HERE, Invalid, immutable, render, validate, write_private


def run(argv, *, capture=False, **kwargs):
    # Do not let a test shell's Compose variables override the generated production config.
    env = {
        k: v
        for k, v in os.environ.items()
        if k
        in {
            "PATH",
            "HOME",
            "USER",
            "LANG",
            "SYSTEMROOT",
            "DOCKER_HOST",
            "DOCKER_CONTEXT",
            "DOCKER_CONFIG",
            "DOCKER_CERT_PATH",
            "DOCKER_TLS_VERIFY",
            "SSH_AUTH_SOCK",
        }
    }
    kwargs.setdefault("stdout", subprocess.PIPE if capture else None)
    return subprocess.run(argv, check=True, text=True, env=env, **kwargs)


class Deployment:
    def __init__(self, config, private):
        self.config, self.private = config, Path(private).resolve()
        self.state = Path(config["state_root"])

    def compose(self, *args, **kwargs):
        return run(
            [
                "docker",
                "compose",
                "--project-directory",
                str(HERE),
                "--env-file",
                str(self.private / "compose.env"),
                "--project-name",
                self.config["project_name"],
                "-f",
                str(HERE / "compose.yaml"),
                *args,
            ],
            **kwargs,
        )

    def locked(self):
        value = json.loads((self.private / "images.lock.json").read_text())
        if (
            value.get("deployment_id") != self.config["deployment_id"]
            or value.get("sources") != self.config["images"]
        ):
            raise Invalid("Image settings changed; lock and verify the images again.")
        if set(value["digests"]) != {"web", "bot", "mysql"} or not all(
            "@sha256:" in v and immutable(v) for v in value["digests"].values()
        ):
            raise Invalid("All runtime images must resolve to immutable digests.")
        return value["digests"]

    def configure(self):
        render(self.config, self.private, locked=self.locked())
        self.compose("config", "--quiet")

    def lock_images(self):
        validate(self.config, ready=True)
        digests = {}
        for name, source in self.config["images"].items():
            run(["docker", "pull", "--platform", "linux/amd64", source])
            metadata = json.loads(
                run(
                    [
                        "docker",
                        "image",
                        "inspect",
                        "--format",
                        "{{json .Config}}",
                        source,
                    ],
                    capture=True,
                ).stdout
            )
            reject_baked_credentials(metadata)
            result = run(
                [
                    "docker",
                    "image",
                    "inspect",
                    "--format",
                    "{{json .RepoDigests}}",
                    source,
                ],
                capture=True,
            )
            values = json.loads(result.stdout)
            if not values:
                raise Invalid("Push the reviewed image to its registry before locking it.")
            digests[name] = values[0]
        # This is an isolated, no-network feature probe: no data mounts and no app startup.
        probe = """from pathlib import Path
from spotbot.opennext_paid import PaidPurchases
from spotbot.opennext_kyb_bundle import form_pdf
from spotbot.opennext_accounts import Accounts
from spotbot.opennext_pricing import SERVICE_FEE_BPS
from spotbot.opennext_market import checkout_totals
assert SERVICE_FEE_BPS == 0 and checkout_totals(1.2, 1)["totalCents"] == 120
import subprocess
subprocess.run(["node", "-e", "const fees=require('/app/legacy/OpenNEXT-transaction-fees.cjs'); if(fees.FEE_PERCENT !== 0) process.exit(1)"], check=True)
form_pdf(dict(id='probe', account='probe', mode='Auto', company={'companyName':'Unicode \u6d4b\u8bd5'}, submitted_at='2026-11-01T00:00:00Z'))
chunks=Path('/app/apps/web/.next/static')
text=''.join(p.read_text(errors='ignore') for p in chunks.rglob('*.js'))
assert '/api/billing/paid-purchases' in text and '/api/admin/accounts' in text
assert 'opennext-markup-only-v2' in text
print('Verified bundled adapter, Unicode PDF support, zero service fee and frontend review capabilities.')
"""
        run(
            [
                "docker",
                "run",
                "--rm",
                "--platform",
                "linux/amd64",
                "--network",
                "none",
                "--read-only",
                "--cap-drop",
                "ALL",
                "--entrypoint",
                "/opt/spotbot/bin/python",
                digests["web"],
                "-c",
                probe,
            ]
        )
        run(
            [
                "docker",
                "run",
                "--rm",
                "--platform",
                "linux/amd64",
                "--network",
                "none",
                "--read-only",
                "--cap-drop",
                "ALL",
                "--entrypoint",
                "python",
                digests["bot"],
                "-c",
                "from spotbot.opennext_paid import PaidPurchases; from spotbot.rental_api import install; from spotbot.opennext_pricing import SERVICE_FEE_BPS; assert SERVICE_FEE_BPS == 0; print('Verified Bot feature imports and zero service fee.')",
            ]
        )
        write_private(
            self.private / "images.lock.json",
            json.dumps(
                dict(
                    deployment_id=self.config["deployment_id"],
                    sources=self.config["images"],
                    digests=digests,
                ),
                indent=2,
            )
            + "\n",
        )
        self.configure()

    def marker(self):
        path = self.state / ".production.json"
        if path.is_symlink() or not path.is_file():
            raise Invalid("Initialize fresh production storage with prepare first.")
        value = json.loads(path.read_text())
        if value.get("deployment_id") != self.config["deployment_id"]:
            raise Invalid("The production data directory belongs to a different deployment.")
        return value

    def save_marker(self, phase):
        write_private(
            self.state / ".production.json",
            json.dumps(dict(deployment_id=self.config["deployment_id"], phase=phase)) + "\n",
        )

    def database_empty(self):
        sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema IN ('opennext_prod_bot','opennext_prod_gateway','opennext_prod_adapter');"
        result = self.compose(
            "exec",
            "-T",
            "mysql",
            "sh",
            "-ec",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -Nse "$1"',
            "sh",
            sql,
            capture=True,
        )
        if result.stdout.strip() != "0":
            raise Invalid(
                "Fresh production databases are not empty; no data was imported or deleted."
            )

    def prepare(self):
        validate(self.config, ready=True)
        require_host()
        self.configure()
        if self.state.is_symlink():
            raise Invalid("Production storage cannot be a symlink to another environment.")
        if self.state.exists() and any(self.state.iterdir()):
            if self.marker()["phase"] != "preparing":
                raise Invalid(
                    "Production storage is already prepared; use up without reinitializing it."
                )
        else:
            self.state.mkdir(parents=True, mode=0o700, exist_ok=True)
            self.save_marker("preparing")
        # Reject a bridge overlapping another project before Docker allocates it.
        existing = run(["docker", "network", "ls", "-q"], capture=True).stdout.split()
        own = self.config["project_name"] + "_control"
        if existing:
            for network in json.loads(
                run(["docker", "network", "inspect", *existing], capture=True).stdout
            ):
                if network["Name"] == own:
                    continue
                for item in network.get("IPAM", {}).get("Config", []):
                    if (
                        item.get("Subnet")
                        and ipaddress.ip_network(item["Subnet"]).version == 4
                        and ipaddress.ip_network(self.config["network_cidr"]).overlaps(
                            ipaddress.ip_network(item["Subnet"])
                        )
                    ):
                        raise Invalid("Production Docker subnet overlaps an existing network.")
        for name, uid in (
            ("web", 1000),
            ("bot", 10001),
            ("gateway", 10002),
            ("mysql", 999),
        ):
            target = self.state / name
            if target.is_symlink():
                raise Invalid("A production data mount cannot be a symlink.")
            target.mkdir(mode=0o700, exist_ok=True)
            os.chown(target, uid, uid)
        self.compose("up", "-d", "--wait", "--wait-timeout", "300", "mysql")
        self.database_empty()
        web = self.state / "web"
        if any(web.iterdir()):
            if (
                json.loads((web / ".production-deployment.json").read_text()).get("deploymentId")
                != self.config["deployment_id"]
            ):
                raise Invalid(
                    "Existing customer storage cannot be imported into a new production installation."
                )
            assert_empty_accounts(web)
        else:
            self.compose(
                "run",
                "--rm",
                "--no-deps",
                "--user",
                "1000:1000",
                "--entrypoint",
                "node",
                "web",
                "/opt/depoly/bootstrap-empty.cjs",
                self.config["deployment_id"],
            )
        self.save_marker("prepared")
        print("Prepared three empty production databases and an empty account directory.")

    def metadata_probe(self):
        probe = """import urllib.request, urllib.error
for url in ('http://169.254.169.254/latest/api/token','http://[fd00:ec2::254]/latest/api/token'):
 try:
  req=urllib.request.Request(url, method='PUT', headers={'X-aws-ec2-metadata-token-ttl-seconds':'1'})
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=2) as response:
   assert response.status != 200, 'Instance metadata is reachable from the gateway'
 except (OSError, urllib.error.URLError): pass
print('Gateway cannot obtain an EC2 instance metadata token.')
"""
        self.compose("run", "--rm", "--no-deps", "--entrypoint", "python", "gateway", "-c", probe)

    def up(self):
        require_host()
        validate(self.config, ready=True)
        self.configure()
        marker = self.marker()
        if marker["phase"] not in {"prepared", "active"}:
            raise Invalid("Production preparation has not completed.")
        self.compose("up", "-d", "--wait", "--wait-timeout", "300", "mysql")
        if marker["phase"] == "prepared":
            self.database_empty()
            assert_empty_accounts(self.state / "web")
        run(
            [
                "iptables",
                "-C",
                "DOCKER-USER",
                "-s",
                self.config["network_cidr"],
                "-d",
                "169.254.169.254/32",
                "-m",
                "comment",
                "--comment",
                "opennext-production-imds",
                "-j",
                "REJECT",
            ],
            capture=True,
        )
        self.metadata_probe()
        self.compose("up", "-d", "--wait", "--wait-timeout", "360")
        self.save_marker("active")
        print("Production services started. Complete smoke checks before opening customer traffic.")

    def backup(self, recipient):
        self.marker()
        self.configure()
        if not shutil.which("age") or not recipient.startswith(("age1", "ssh-")):
            raise Invalid("Install age and provide the production backup public recipient.")
        destination = self.state / "backups"
        destination.mkdir(mode=0o700, exist_ok=True)
        name = (
            datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            + "-"
            + self.config["deployment_id"][:8]
            + ".tar.age"
        )
        target = destination / name
        if target.exists():
            raise Invalid("A backup with this timestamp already exists.")
        running = self.compose(
            "ps", "--status", "running", "--services", capture=True
        ).stdout.split()
        stopped = [name for name in running if name in {"web", "bot", "gateway"}]
        with tempfile.TemporaryDirectory(prefix=".backup-", dir=destination) as temporary:
            directory = Path(temporary)
            try:
                if stopped:
                    self.compose("stop", "-t", "60", *stopped)
                with (directory / "database.sql").open("w") as handle:
                    self.compose(
                        "exec",
                        "-T",
                        "mysql",
                        "sh",
                        "-ec",
                        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --databases opennext_prod_bot opennext_prod_gateway opennext_prod_adapter',
                        stdout=handle,
                    )
                with (directory / "database.sql").open("rb") as handle:
                    database_hash = hashlib.file_digest(handle, "sha256").hexdigest()
                write_private(
                    directory / "manifest.json",
                    json.dumps(
                        dict(
                            deployment_id=self.config["deployment_id"],
                            created_at=datetime.now(UTC).isoformat(),
                            database_sha256=database_hash,
                            images=self.locked(),
                        )
                    )
                    + "\n",
                )
                partial = target.with_suffix(target.suffix + ".partial")
                command = [
                    "tar",
                    "--exclude=web/clamav",
                    "-C",
                    str(self.state),
                    "-cf",
                    "-",
                    "web",
                    "bot",
                    "gateway",
                    ".production.json",
                    "-C",
                    str(directory),
                    "database.sql",
                    "manifest.json",
                    "-C",
                    str(self.private),
                    "settings.json",
                    "images.lock.json",
                ]
                with subprocess.Popen(command, stdout=subprocess.PIPE) as archive:
                    try:
                        run(
                            ["age", "-r", recipient, "-o", str(partial)],
                            stdin=archive.stdout,
                        )
                        archive.stdout.close()
                        if archive.wait() != 0:
                            raise Invalid("The production backup archive failed.")
                        os.replace(partial, target)
                    finally:
                        partial.unlink(missing_ok=True)
            finally:
                if stopped:
                    self.compose("start", *stopped)
        print("Encrypted production backup saved: " + str(target))


def reject_baked_credentials(metadata):
    sensitive = {
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "SMTP_PASS",
        "SMTP_PASSWORD",
        "MYSQL_ROOT_PASSWORD",
        "MYSQL_PASSWORD",
        "GOOGLE_CLIENT_SECRET",
        "GITHUB_CLIENT_SECRET",
        "LAMBDA_API_KEY",
        "VULTR_API_KEY",
        "SHADEFORM_API_KEY",
        "OPENNEXT_ADMIN_TOKEN",
        "OPENNEXT_AUTH_SESSION_SECRET",
        "OPENNEXT_AGENT_CALLBACK_TOKEN",
    }
    for item in metadata.get("Env") or []:
        key, _, value = item.partition("=")
        if value and (
            key in sensitive
            or (
                key.startswith("SPOTBOT_")
                and key.endswith(("_PASSWORD", "_PASS", "_SECRET", "_TOKEN", "_KEY"))
            )
        ):
            raise Invalid("A selected image contains a baked credential; rebuild a clean image.")


def require_host():
    if (
        platform.system() != "Linux"
        or platform.machine() not in {"x86_64", "amd64"}
        or os.geteuid() != 0
    ):
        raise Invalid("Run deployment mutations as root on a Linux x86-64 production host.")


def assert_empty_accounts(directory):
    expected = {
        "auth-state.json": ("users", "sessions"),
        "marketplace.json": (
            "rfqs",
            "supplies",
            "instances",
            "quotes",
            "orders",
            "notifications",
            "kyb",
            "audit",
            "interests",
            "homepageReviews",
            "submissionRequests",
        ),
        "credit-topups.json": ("requests", "credits", "notifications"),
    }
    for name, fields in expected.items():
        value = json.loads((Path(directory) / name).read_text())
        if any(value.get(key) != [] for key in fields):
            raise Invalid(
                "Nonempty customer data was found; production initialization was refused."
            )
