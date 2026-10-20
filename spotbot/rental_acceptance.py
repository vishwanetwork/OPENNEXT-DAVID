"""Opt-in live acceptance through the bot and gateway; no direct cloud mutations."""

import asyncio
import hashlib
import json
import os
import re
import tempfile
import time
from pathlib import Path
from uuid import UUID

import httpx
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from spotbot.models import gpu_model, timestamp, utcnow
from spotbot.rental_readiness import safe_url
from spotbot.rentals import identity


class AcceptanceError(RuntimeError):
    pass


def storage_deletion_reported(backups, generations):
    # A closed request rejected for capacity has no backups or disks to delete.
    # An allocated/uncertain generation must still have a terminal, complete inventory.
    return all(b["state"] == "DELETED" for b in backups) and all(
        g.get("state") in {"STOPPED", "REJECTED"}
        and (not g.get("instance_id") or bool(g.get("volumes")))
        and {v["volume_id"] for v in g.get("volumes", [])}
        <= set(g.get("deleted_volumes", []))
        for g in generations
    )


class AcceptanceSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SPOTBOT_ACCEPTANCE_",
        env_file=".env.acceptance",
        extra="ignore",
        hide_input_in_errors=True,
    )
    bot_url: str
    gateway_url: str
    bot_token: SecretStr = Field(min_length=32)
    gateway_token: SecretStr = Field(min_length=32)
    tenant_id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,100}$")
    ssh_key_path: Path
    known_hosts_path: Path
    trust_new_host_keys: bool = False
    stage_timeout_seconds: int = Field(1200, ge=10, le=3600)
    cleanup_timeout_seconds: int = Field(1200, ge=10, le=3600)
    poll_seconds: int = Field(5, ge=1, le=30)

    @field_validator("bot_url", "gateway_url")
    @classmethod
    def origin(cls, value):
        from urllib.parse import urlsplit

        if not safe_url(value) or urlsplit(value).path not in {"", "/"}:
            raise ValueError("Acceptance service URLs must be HTTPS origins or loopback HTTP")
        return value.rstrip("/")


def validate_acceptance(rules):
    if (
        not rules.require_gateway_ack
        or not rules.data_disks
        or rules.allow_older_backup
        or rules.backup.final_retention_seconds > 300
        or rules.acquisition_deadline <= utcnow()
        or rules.expires_at <= utcnow()
        or (rules.expires_at - utcnow()).total_seconds() > 10800
    ):
        raise AcceptanceError(
            "acceptance_requires_gateway_data_disk_fresh_deadline_and_short_retention"
        )


def plan(request, run_id):
    validate_acceptance(request.rfq)
    return dict(
        run_id=str(UUID(run_id)),
        execution_enabled=False,
        operations=[
            "create_rental",
            "verify_gateway_ssh",
            "write_root_and_data_files",
            "manual_backup",
            "recover_server",
            "verify_restored_files",
            "release_rental",
        ],
        rfq=request.rfq.model_dump(mode="json"),
        note="Execution can incur compute and retained-storage charges within the supplied RFQ policy.",
    )


def remote_script(rules, run_id, write):
    paths = [f"/var/lib/spotbot-acceptance/{run_id}/marker.dat"] + [
        f"/data/{disk.device.rsplit('/', 1)[1]}/.spotbot-acceptance/{run_id}/marker.dat"
        for disk in rules.data_disks
    ]
    return """import hashlib, json, os, stat, subprocess
from pathlib import Path
paths = json.loads(CONFIG)
results = []
for name in paths:
    path = Path(name)
    if name.startswith('/data/'):
        mount = Path('/').joinpath(*path.parts[1:3])
        assert os.path.ismount(mount), 'Protected data disk is not mounted'
    if WRITE:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(os.urandom(65536))
        path.chmod(0o640)
    info = path.stat()
    results.append(dict(path=name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                        mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid))
os.sync()
gpu = subprocess.check_output(['nvidia-smi', '--query-gpu=name,memory.total',
                               '--format=csv,noheader,nounits'], timeout=10).decode()
print(json.dumps(dict(files=results, gpu=gpu)))
""".replace("CONFIG", repr(json.dumps(paths))).replace("WRITE", repr(write))


class Acceptance:
    def __init__(self, settings, request, run_id, report_path, *, client=None, ssh=None):
        self.settings, self.request = settings, request
        self.run_id, self.report_path = str(UUID(run_id)), Path(report_path)
        self.key = "acceptance:" + self.run_id
        self.rental_id = identity("rental", settings.tenant_id, self.key)
        self.client = client or httpx.AsyncClient(
            timeout=15, follow_redirects=False, trust_env=False
        )
        self.own_client = client is None
        self.ssh = ssh or self.run_ssh
        self.http_endpoint = None
        self.report = dict(
            run_id=self.run_id,
            rental_id=self.rental_id,
            status="started",
            created_at=timestamp(),
            steps=[],
            cleanup="not_started",
            rfq_hash=hashlib.sha256(request.model_dump_json().encode()).hexdigest(),
            host_key_verification="trust_on_first_use"
            if settings.trust_new_host_keys
            else "strict",
        )

    def checkpoint(self, step=None):
        if step:
            self.report["steps"].append(dict(step=step, at=timestamp()))
        self.report["updated_at"] = timestamp()
        # Replace atomically with mode 600; never store API tokens or private keys.
        with tempfile.NamedTemporaryFile(
            mode="w", dir=self.report_path.parent, delete=False
        ) as stream:
            temporary = stream.name
            try:
                os.chmod(temporary, 0o600)
                json.dump(self.report, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
                os.replace(temporary, self.report_path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)

    async def api(self, path="", *, method="GET", payload=None, key=None, gateway=False):
        config = self.settings
        base = config.gateway_url if gateway else config.bot_url
        token = config.gateway_token if gateway else config.bot_token
        headers = {
            "Authorization": "Bearer " + token.get_secret_value(),
            "X-SpotBot-Tenant": config.tenant_id,
        }
        if key:
            headers["Idempotency-Key"] = key
        response = await self.client.request(method, base + path, headers=headers, json=payload)
        if response.status_code >= 400:
            raise AcceptanceError(
                "gateway_http_" + str(response.status_code)
                if gateway
                else "bot_http_" + str(response.status_code)
            )
        return response.json()

    async def wait(self, operation, predicate, *, cleanup=False):
        deadline = time.monotonic() + (
            self.settings.cleanup_timeout_seconds
            if cleanup
            else self.settings.stage_timeout_seconds
        )
        while time.monotonic() < deadline:
            try:
                value = await operation()
            except httpx.HTTPError:
                await asyncio.sleep(self.settings.poll_seconds)
                continue
            except AcceptanceError as exc:
                if re.fullmatch(r"(?:bot|gateway)_http_(?:5[0-9]{2}|408|429)", str(exc)):
                    await asyncio.sleep(self.settings.poll_seconds)
                    continue
                raise
            if predicate(value):
                return value
            await asyncio.sleep(self.settings.poll_seconds)
        raise AcceptanceError("cleanup_timeout" if cleanup else "acceptance_stage_timeout")

    async def rental(self):
        return await self.api("/v1/rentals/" + self.rental_id)

    async def active(self, generation):
        def ready(value):
            if value["state"] in {"ACTION_REQUIRED", "NEEDS_RECONCILIATION", "ENDING", "CLOSED"}:
                raise AcceptanceError("rental_became_unavailable")
            return value["state"] == "ACTIVE" and value["generation"] >= generation

        return await self.wait(self.rental, ready)

    async def connection(self, generation):
        result = await self.wait(
            lambda: self.api(f"/v1/gateway/rentals/{self.rental_id}/connection", gateway=True),
            lambda d: d.get("ready") and d.get("generation") == generation,
        )
        ssh = result["ssh"]
        if (
            not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", ssh["host"])
            or ssh["user"] != self.request.rfq.ssh_user
            or type(ssh["port"]) is not int
            or not 1 <= ssh["port"] <= 65535
        ):
            raise AcceptanceError("invalid_gateway_ssh_connection")
        if self.request.rfq.http_port:
            url = result.get("http", "")
            from urllib.parse import urlsplit

            if (
                not safe_url(url)
                or urlsplit(url).path not in {"", "/"}
                or not result.get("http_access_token")
            ):
                raise AcceptanceError("invalid_gateway_http_connection")
            if self.http_endpoint and self.http_endpoint != url:
                raise AcceptanceError("gateway_http_endpoint_changed")
            path = url.rstrip("/") + self.request.rfq.http_health_path
            unauthorized = await self.client.get(path)
            response = await self.client.get(
                path, headers={"X-SpotBot-Access-Token": result["http_access_token"]}
            )
            if unauthorized.status_code != 401 or response.status_code != 200:
                raise AcceptanceError("gateway_http_access_check_failed")
            self.http_endpoint = url
            self.report["http_verified"] = True
        return ssh

    async def run_ssh(self, connection, script):
        config = self.settings
        config.known_hosts_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(config.known_hosts_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.close(fd)
        args = [
            "ssh",
            "-i",
            str(config.ssh_key_path),
            "-p",
            str(connection["port"]),
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "StrictHostKeyChecking=" + ("accept-new" if config.trust_new_host_keys else "yes"),
            "-o",
            "UserKnownHostsFile=" + json.dumps(str(config.known_hosts_path.resolve())),
            connection["user"] + "@" + connection["host"],
            "sudo -n python3 -",
        ]
        process = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(script.encode()), 60)
            if process.returncode or len(stdout) > 65536:
                raise AcceptanceError("ssh_validation_failed")
            return json.loads(stdout)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()

    def verify_files(self, result, previous=None):
        paths = [f"/var/lib/spotbot-acceptance/{self.run_id}/marker.dat"] + [
            f"/data/{d.device.rsplit('/', 1)[1]}/.spotbot-acceptance/{self.run_id}/marker.dat"
            for d in self.request.rfq.data_disks
        ]
        files = result["files"]
        if (
            len(files) != len(paths)
            or {f["path"] for f in files} != set(paths)
            or any(
                f["mode"] != 0o640
                or f["uid"] != 0
                or f["gid"] != 0
                or not re.fullmatch(r"[a-f0-9]{64}", f["sha256"])
                for f in files
            )
        ):
            raise AcceptanceError("file_inventory_or_permissions_invalid")
        gpu = [line.rsplit(",", 1) for line in result["gpu"].strip().splitlines()]
        rules = self.request.rfq
        if len(gpu) != rules.gpu_count or any(
            gpu_model(g[0]) != rules.gpu_model
            or int(g[1].strip()) < rules.min_gpu_memory_gib * 1024 * 0.98
            for g in gpu
        ):
            raise AcceptanceError("restored_gpu_validation_failed")
        if previous and sorted(files, key=lambda f: f["path"]) != sorted(
            previous["files"], key=lambda f: f["path"]
        ):
            raise AcceptanceError("restored_files_do_not_match")

    async def execute(self):
        validate_acceptance(self.request.rfq)
        if not self.settings.ssh_key_path.is_file():
            raise AcceptanceError("ssh_key_file_missing")
        if not self.settings.trust_new_host_keys and (
            not self.settings.known_hosts_path.is_file()
            or not self.settings.known_hosts_path.stat().st_size
        ):
            raise AcceptanceError("strict_ssh_requires_preverified_known_hosts")
        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        # Refuse to overwrite an earlier acceptance journal or hide unresolved cleanup.
        fd = os.open(self.report_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        self.checkpoint("planned")
        cleanup_needed = False
        try:
            try:
                await self.rental()
            except AcceptanceError as exc:
                if str(exc) != "bot_http_404":
                    raise
            else:
                self.report["cleanup"] = "preexisting_rental_untouched"
                raise AcceptanceError("acceptance_run_already_exists")
            cleanup_needed = True  # Persist intent before a POST whose result may be uncertain.
            self.report["cleanup"] = "required"
            self.checkpoint("submission_intent")
            replayed = False
            try:
                response = await self.api(
                    "/v1/rentals",
                    method="POST",
                    payload=self.request.model_dump(mode="json"),
                    key=self.key,
                )
            except httpx.HTTPError:
                replayed = True
                response = await self.api(
                    "/v1/rentals",
                    method="POST",
                    payload=self.request.model_dump(mode="json"),
                    key=self.key,
                )
            except AcceptanceError as exc:
                if str(exc).startswith("bot_http_4"):
                    cleanup_needed = False
                    self.report["cleanup"] = "not_created"
                raise
            if not response.get("created") and not replayed:
                cleanup_needed = False
                self.report["cleanup"] = "preexisting_rental_untouched"
                raise AcceptanceError("acceptance_run_already_exists")
            if response["rental"]["id"] != self.rental_id:
                raise AcceptanceError("rental_identity_mismatch")
            first = await self.active(1)
            connection = await self.connection(first["generation"])
            self.report["ssh"] = connection
            self.checkpoint("acquired")
            original = await self.ssh(
                connection, remote_script(self.request.rfq, self.run_id, True)
            )
            self.verify_files(original)
            self.report["original_files"] = original["files"]
            self.checkpoint("files_written")
            backup = await self.api(
                f"/v1/rentals/{self.rental_id}/backups", method="POST", key=self.key + ":backup"
            )

            def backup_ready(value):
                found = next((b for b in value["items"] if b["id"] == backup["id"]), None)
                if found and found["state"] in {"FAILED", "NEEDS_RECONCILIATION"}:
                    raise AcceptanceError("manual_backup_failed")
                return bool(found and found["state"] == "AVAILABLE")

            await self.wait(lambda: self.api(f"/v1/rentals/{self.rental_id}/backups"), backup_ready)
            self.checkpoint("manual_backup_verified")
            await self.api(f"/v1/rentals/{self.rental_id}/recover", method="POST", payload={})
            second = await self.active(first["generation"] + 1)
            replacement = await self.connection(second["generation"])
            if replacement != connection:
                raise AcceptanceError("gateway_endpoint_changed")
            restored = await self.ssh(
                replacement, remote_script(self.request.rfq, self.run_id, False)
            )
            self.verify_files(restored, original)
            self.report["restored_files"] = restored["files"]
            self.report["generation"] = second["generation"]
            self.checkpoint("restore_verified")
            self.report["status"] = "passed"
        except BaseException as exc:
            self.report["status"] = "failed"
            self.report["error"] = (
                str(exc) if isinstance(exc, AcceptanceError) else type(exc).__name__
            )
            raise
        finally:
            if cleanup_needed:
                try:
                    await self.wait(
                        lambda: self.api(f"/v1/rentals/{self.rental_id}/release", method="POST"),
                        lambda _: True,
                        cleanup=True,
                    )
                    self.checkpoint("release_requested")
                    await self.wait(self.rental, lambda r: r["state"] == "CLOSED", cleanup=True)
                    self.report["cleanup"] = "compute_closed"
                    self.report["retention_seconds"] = (
                        self.request.rfq.backup.final_retention_seconds
                    )
                    self.checkpoint("closed")

                    async def storage():
                        backups = await self.api(f"/v1/rentals/{self.rental_id}/backups")
                        generations = await self.api(f"/v1/rentals/{self.rental_id}/generations")
                        return storage_deletion_reported(backups["items"], generations["items"])

                    await self.wait(storage, bool, cleanup=True)
                    self.report["cleanup"] = "storage_deletion_reported"
                    self.checkpoint("storage_cleanup_verified")
                except BaseException as exc:
                    self.report.update(cleanup="unconfirmed", status="failed")
                    self.report["cleanup_error"] = (
                        str(exc) if isinstance(exc, AcceptanceError) else type(exc).__name__
                    )
            self.checkpoint()
        if self.report["cleanup"] != "storage_deletion_reported":
            raise AcceptanceError("cleanup_requires_operator_attention")
        return self.report

    async def close(self):
        if self.own_client:
            await self.client.aclose()
