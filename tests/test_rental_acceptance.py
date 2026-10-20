"""No-cloud tests for the opt-in acceptance runner and cleanup guarantees."""

import asyncio
import copy
import json
import os
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest

from spotbot.models import utcnow
from spotbot.rental_acceptance import (
    Acceptance,
    AcceptanceError,
    AcceptanceSettings,
    plan,
    remote_script,
)
from spotbot.rental_models import RentalRequest

BOT_TOKEN = "staging-bot-token-" * 3
GATEWAY_TOKEN = "staging-gateway-token-" * 3


@pytest.fixture
def scenario(tmp_path):
    key = tmp_path / "dummy-test-key"
    key.write_text("test fixture, not an SSH key")
    settings = AcceptanceSettings(
        _env_file=None,
        bot_url="https://bot.example.com",
        gateway_url="https://gateway.example.com",
        bot_token=BOT_TOKEN,
        gateway_token=GATEWAY_TOKEN,
        tenant_id="staging",
        ssh_key_path=key,
        known_hosts_path=tmp_path / "known-hosts",
        trust_new_host_keys=True,
    ).model_copy(update={"poll_seconds": 0.001, "cleanup_timeout_seconds": 0.05})
    request = RentalRequest(
        rfq=dict(
            rfq_id="rfq",
            rfq_version=1,
            upstream_order_id="test-order",
            regions=["us-west-2"],
            gpu_model="H100",
            gpu_count=1,
            min_gpu_memory_gib=80,
            price_unit="instance_hour",
            max_price_hourly="3",
            budget_usd="30",
            ssh_key_name="customer",
            acquisition_deadline=utcnow() + timedelta(minutes=30),
            expires_at=utcnow() + timedelta(hours=2),
            data_disks=[dict(device="/dev/sdf", size_gib=10)],
            http_port=8000,
            backup=dict(final_retention_seconds=60),
        )
    )
    state = dict(
        created=False,
        generation=1,
        closed=False,
        create_keys=[],
        release=0,
        timeout_once=False,
        corrupt=False,
        ssh_failure=False,
        storage_deleted=True,
        cancel=False,
        api_calls=[],
    )
    run_id = str(uuid4())

    async def handler(http):
        path = http.url.path
        state["api_calls"].append((http.method, path))
        if http.url.host.startswith("r-"):
            return httpx.Response(
                200 if http.headers.get("x-spotbot-access-token") == "private-http-token" else 401
            )
        assert http.headers["x-spotbot-tenant"] == "staging"
        if path == "/v1/rentals" and http.method == "POST":
            state["create_keys"].append(http.headers["idempotency-key"])
            created = not state["created"]
            state["created"] = True
            if state["timeout_once"] and len(state["create_keys"]) == 1:
                raise httpx.ReadTimeout("simulated timeout", request=http)
            return httpx.Response(
                200, json={"created": created, "rental": {"id": runner.rental_id}}
            )
        if path.endswith("/release"):
            state.update(closed=True, release=state["release"] + 1)
            return httpx.Response(200, json={"state": "ENDING"})
        if path.endswith("/recover"):
            state["generation"] += 1
            return httpx.Response(200, json={"state": "RECOVERING"})
        if path.endswith("/backups"):
            if http.method == "POST":
                return httpx.Response(200, json={"id": "backup"})
            return httpx.Response(
                200,
                json={
                    "items": [
                        {"id": "backup", "state": "DELETED" if state["closed"] else "AVAILABLE"}
                    ]
                },
            )
        if path.endswith("/generations"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "volumes": [{"volume_id": "vol-root"}, {"volume_id": "vol-data"}],
                            "deleted_volumes": ["vol-root", "vol-data"]
                            if state["storage_deleted"]
                            else [],
                        }
                    ]
                },
            )
        if path.endswith("/connection"):
            assert http.headers["authorization"] == "Bearer " + GATEWAY_TOKEN
            return httpx.Response(
                200,
                json={
                    "ready": True,
                    "generation": state["generation"],
                    "ssh": {"host": "ssh.example.com", "port": 22000, "user": "ubuntu"},
                    "http": f"https://r-{run_id}.gpu.example.com",
                    "http_access_token": "private-http-token",
                },
            )
        assert http.headers["authorization"] == "Bearer " + BOT_TOKEN
        if not state["created"]:
            return httpx.Response(404)
        return httpx.Response(
            200,
            json={
                "state": "CLOSED" if state["closed"] else "ACTIVE",
                "generation": state["generation"],
            },
        )

    async def ssh(connection, script):
        compile(script, "guest-check", "exec")
        if state["cancel"]:
            raise asyncio.CancelledError()
        if state["ssh_failure"]:
            raise AcceptanceError("ssh_validation_failed")
        files = [
            dict(
                path=f"/var/lib/spotbot-acceptance/{run_id}/marker.dat",
                sha256="a" * 64,
                mode=0o640,
                uid=0,
                gid=0,
            ),
            dict(
                path=f"/data/sdf/.spotbot-acceptance/{run_id}/marker.dat",
                sha256="b" * 64,
                mode=0o640,
                uid=0,
                gid=0,
            ),
        ]
        if state["corrupt"] and state["generation"] > 1:
            files[1]["sha256"] = "c" * 64
        return dict(files=files, gpu="NVIDIA H100, 81559\n")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    runner = Acceptance(settings, request, run_id, tmp_path / "report.json", client=client, ssh=ssh)
    return runner, state, client


async def test_success_preserves_idempotency_and_verifies_final_cleanup(scenario):
    runner, state, client = scenario
    try:
        state["timeout_once"] = True
        result = await runner.execute()
        assert result["status"] == "passed" and result["cleanup"] == "storage_deletion_reported"
        assert result["generation"] == 2 and result["http_verified"]
        assert len(state["create_keys"]) == 2 and len(set(state["create_keys"])) == 1
        assert state["release"] == 1
        content = runner.report_path.read_text()
        assert (
            "private-http-token" not in content
            and BOT_TOKEN not in content
            and GATEWAY_TOKEN not in content
        )
        assert os.stat(runner.report_path).st_mode & 0o777 == 0o600
    finally:
        await client.aclose()


@pytest.mark.parametrize("fault", ["ssh_failure", "corrupt", "cancel"])
async def test_ssh_failure_corruption_and_cancellation_release_compute(scenario, fault):
    runner, state, client = scenario
    state[fault] = True
    try:
        with pytest.raises(asyncio.CancelledError if fault == "cancel" else AcceptanceError):
            await runner.execute()
        result = json.loads(runner.report_path.read_text())
        assert result["status"] == "failed" and result["cleanup"] == "storage_deletion_reported"
        assert state["closed"] and state["release"] == 1
    finally:
        await client.aclose()


async def test_incomplete_storage_cleanup_is_not_reported_as_success(scenario):
    runner, state, client = scenario
    state["storage_deleted"] = False
    try:
        with pytest.raises(AcceptanceError, match="cleanup_requires_operator"):
            await runner.execute()
        result = json.loads(runner.report_path.read_text())
        assert result["status"] == "failed" and result["cleanup"] == "unconfirmed"
        assert state["closed"]
    finally:
        await client.aclose()


async def test_existing_run_and_strict_key_failure_do_not_mutate_cloud(scenario):
    runner, state, client = scenario
    try:
        runner.settings.trust_new_host_keys = False
        with pytest.raises(AcceptanceError, match="preverified_known_hosts"):
            await runner.execute()
        assert state["api_calls"] == []
        runner.settings.trust_new_host_keys = True
        state["created"] = True
        with pytest.raises(AcceptanceError, match="already_exists"):
            await runner.execute()
        assert state["create_keys"] == [] and state["release"] == 0
    finally:
        await client.aclose()


async def test_plan_is_offline_and_rejects_long_retention(scenario):
    runner, state, client = scenario
    result = plan(runner.request, runner.run_id)
    assert not result["execution_enabled"] and not state["api_calls"]
    request = copy.deepcopy(runner.request)
    request.rfq.backup.final_retention_seconds = 604800
    with pytest.raises(AcceptanceError):
        plan(request, runner.run_id)
    await client.aclose()


async def test_guest_script_really_writes_and_reads_back_files(tmp_path, scenario, monkeypatch, capsys):
    import pathlib
    import subprocess
    import sys
    from types import SimpleNamespace

    runner, _, _ = scenario
    base = tmp_path / "guest"
    real_path = pathlib.Path
    # Isolate guest absolute paths inside the test directory; execute the script itself.
    module = SimpleNamespace(Path=lambda p: real_path(base, str(p).lstrip("/")))
    with monkeypatch.context() as patch:
        patch.setitem(sys.modules, "pathlib", module)
        patch.setattr(os.path, "ismount", lambda p: True)
        patch.setattr(os, "sync", lambda: None)
        patch.setattr(subprocess, "check_output", lambda *a, **k: b"NVIDIA H100, 81559\n")
        exec(remote_script(runner.request.rfq, runner.run_id, True), {})
        written = json.loads(capsys.readouterr().out)
        exec(remote_script(runner.request.rfq, runner.run_id, False), {})
        restored = json.loads(capsys.readouterr().out)
    assert written == restored
    assert len(written["files"]) == 2
    assert all(f["mode"] == 0o640 for f in written["files"])
    await scenario[2].aclose()
