"""Managed launch: the customer's task runs on delivery and decides whether the server ends."""

import base64
import json
import os
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from spotbot import guest_agent
from spotbot import rental_tasks as tasks
from spotbot.api import create_app
from spotbot.rental_models import AgentReport, TaskReport, TaskRequest
from tests.test_rentals import cycle, deliver
from tests.test_rentals import rental_env as rental_env  # noqa: F401

KEY = base64.b64encode(os.urandom(32)).decode()


def task(**values):
    return TaskRequest(
        **{
            "script": "python train.py",
            "env": {"EPOCHS": "3"},
            "secrets": {"HF_TOKEN": "hf_secret_value"},
            "on_failure": "keep",
            **values,
        }
    )


def report(env, rental_id, **run):
    gen = env.engine.current(env.engine.get(rental_id, "tenant-a"))
    return AgentReport(
        rental_id=rental_id,
        generation=gen["generation"],
        instance_id=gen["instance_id"],
        token=gen["agent_token"],
        ssh_ready=True,
        task=TaskReport(**run) if run else None,
    )


@pytest.fixture
def env(rental_env):
    rental_env.engine.sealer = tasks.Sealer(KEY)
    return rental_env


def test_task_request_validation():
    with pytest.raises(ValidationError):
        TaskRequest(script="x")  # The failure choice has no default.
    for bad in (
        {"env": {"1BAD": "x"}},
        {"env": {"SPOTBOT_ATTEMPT": "x"}},
        {"env": {"A": "x"}, "secrets": {"A": "y"}},
        {"env": {"A": ""}},
        {"script": "a\0b"},
    ):
        with pytest.raises(ValidationError):
            task(**bad)


async def test_task_runs_on_delivery_and_success_ends_the_server(env):
    row, _ = env.engine.create(env.request, "tenant-a", "task-end")
    detail = await env.engine.set_task(row["id"], "tenant-a", task(on_success="end"))
    assert detail["summary"]["state"] == "waiting"
    assert detail["task"]["secret_names"] == ["HF_TOKEN"]
    stored = env.engine.get(row["id"], "tenant-a")["task"]
    assert "hf_secret_value" not in json.dumps(stored)
    row = await deliver(env, row["id"])
    instructions = await env.engine.agent_report(report(env, row["id"]))
    spec = instructions["task"]
    assert spec["attempt"] == row["generation"] and spec["resumed"] is False
    assert spec["secrets"] == {"HF_TOKEN": "hf_secret_value"} and spec["env"] == {"EPOCHS": "3"}
    await env.engine.agent_report(
        report(env, row["id"], version=1, attempt=spec["attempt"], state="running")
    )
    with pytest.raises(ValueError, match="task_started"):
        await env.engine.set_task(row["id"], "tenant-a", task())
    # A running task's log is read live from the server's report, without rewriting the rental.
    version = env.engine.get(row["id"], "tenant-a")["version"]
    await env.engine.agent_report(
        report(env, row["id"], version=1, attempt=spec["attempt"], state="running", log_tail="e1")
    )
    row = env.engine.get(row["id"], "tenant-a")
    assert row["version"] == version and env.engine.task(row)["log_tail"] == "e1"
    instructions = await env.engine.agent_report(
        report(
            env,
            row["id"],
            version=1,
            attempt=spec["attempt"],
            state="succeeded",
            exit_code=0,
            log_tail="done\n",
        )
    )
    assert instructions["task"] is None
    row = env.engine.get(row["id"], "tenant-a")
    assert row["end_requested"] and row["end_cause"] == "task_succeeded"
    assert row["task_outcome"]["action"] == "end" and row["task"]["secrets"] is None
    # The outcome is applied once: a repeated report changes nothing.
    await env.engine.agent_report(
        report(env, row["id"], version=1, attempt=spec["attempt"], state="failed", exit_code=1)
    )
    assert env.engine.get(row["id"], "tenant-a")["task_outcome"]["state"] == "succeeded"


async def test_failure_with_keep_leaves_the_server_running(env):
    row, _ = env.engine.create(env.request, "tenant-a", "task-keep")
    await env.engine.set_task(row["id"], "tenant-a", task(on_failure="keep"))
    row = await deliver(env, row["id"])
    await env.engine.agent_report(
        report(env, row["id"], version=1, attempt=1, state="failed", exit_code=2, log_tail="oom")
    )
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "ACTIVE" and not row["end_requested"]
    detail = env.engine.task(row)
    assert detail["summary"]["state"] == "failed"
    assert detail["summary"]["outcome"]["action"] == "keep" and detail["log_tail"] == "oom"


async def test_stop_before_the_first_run_cancels_it(env):
    row, _ = env.engine.create(env.request, "tenant-a", "task-stop")
    await env.engine.set_task(row["id"], "tenant-a", task())
    detail = await env.engine.stop_task(row["id"], "tenant-a")
    assert detail["summary"]["state"] == "stopped"
    row = await deliver(env, row["id"])
    assert (await env.engine.agent_report(report(env, row["id"])))["task"] is None
    with pytest.raises(ValueError, match="task_not_running"):
        await env.engine.stop_task(row["id"], "tenant-a")


async def test_stop_after_start_reaches_the_agent(env):
    row, _ = env.engine.create(env.request, "tenant-a", "task-stop-running")
    await env.engine.set_task(row["id"], "tenant-a", task())
    row = await deliver(env, row["id"])
    await env.engine.agent_report(report(env, row["id"], version=1, attempt=1, state="running"))
    await env.engine.stop_task(row["id"], "tenant-a")
    spec = (await env.engine.agent_report(report(env, row["id"])))["task"]
    assert spec["stop"] is True
    await env.engine.agent_report(report(env, row["id"], version=1, attempt=1, state="stopped"))
    row = env.engine.get(row["id"], "tenant-a")
    assert row["task_outcome"]["action"] == "none" and row["state"] == "ACTIVE"


async def test_dispatch_is_durable_before_first_agent_report(env, monkeypatch):
    row, _ = env.engine.create(env.request, "tenant-a", "dispatch-fence")
    await env.engine.set_task(row["id"], "tenant-a", task())
    row = await deliver(env, row["id"])
    first = (await env.engine.agent_report(report(env, row["id"])))["task"]
    stored = env.engine.get(row["id"], "tenant-a")
    assert stored["task_runs"][0]["state"] == "dispatched"
    assert tasks.summary(stored)["state"] == "waiting"
    # The response might be lost, or the bot restarted, before the first running report.
    for request in (None, task(script="echo replacement")):
        with pytest.raises(ValueError, match="task_started"):
            await env.engine.set_task(row["id"], "tenant-a", request)
    replay = (await env.engine.agent_report(report(env, row["id"])))["task"]
    assert replay == first
    assert len(env.engine.get(row["id"], "tenant-a")["task_runs"]) == 1
    await env.engine.stop_task(row["id"], "tenant-a")
    assert (await env.engine.agent_report(report(env, row["id"])))["task"]["stop"]
    await env.engine.agent_report(report(env, row["id"], version=1, attempt=1, state="stopped"))
    assert env.engine.task(env.engine.get(row["id"], "tenant-a"))["summary"]["state"] == "stopped"


async def test_failed_dispatch_commit_returns_no_instruction(env, monkeypatch):
    row, _ = env.engine.create(env.request, "tenant-a", "dispatch-failure")
    await env.engine.set_task(row["id"], "tenant-a", task())
    row = await deliver(env, row["id"])
    def fail(_row):
        raise RuntimeError("storage unavailable")
    monkeypatch.setattr(env.engine, "_save_task_run", fail)
    with pytest.raises(RuntimeError, match="storage unavailable"):
        await env.engine.agent_report(report(env, row["id"]))
    assert tasks.editable(env.engine.get(row["id"], "tenant-a"))


async def test_edits_keep_stored_secrets_and_need_a_key(env):
    row, _ = env.engine.create(env.request, "tenant-a", "task-edit")
    await env.engine.set_task(row["id"], "tenant-a", task())
    detail = await env.engine.set_task(
        row["id"], "tenant-a", task(script="echo again", secrets={"HF_TOKEN": None})
    )
    assert detail["task"]["version"] == 2 and detail["task"]["script"] == "echo again"
    with pytest.raises(ValueError, match="task_secret_not_found"):
        await env.engine.set_task(row["id"], "tenant-a", task(secrets={"OTHER": None}))
    env.engine.sealer = tasks.Sealer("")
    with pytest.raises(ValueError, match="task_secrets_unavailable"):
        await env.engine.set_task(row["id"], "tenant-a", task())
    # Without a key, a task without secrets is still accepted.
    assert (await env.engine.set_task(row["id"], "tenant-a", task(secrets={})))["task"]
    env.engine.sealer = tasks.Sealer(KEY)
    detail = await env.engine.set_task(row["id"], "tenant-a", task())
    row = await deliver(env, row["id"])
    spec = (await env.engine.agent_report(report(env, row["id"])))["task"]
    assert spec["version"] == detail["task"]["version"]
    assert spec["secrets"] == {"HF_TOKEN": "hf_secret_value"}


async def test_replacement_reruns_or_skips_the_task(env):
    for policy in ("rerun", "none"):
        row, _ = env.engine.create(env.request, "tenant-a", "task-replace-" + policy)
        await env.engine.set_task(row["id"], "tenant-a", task(on_replacement=policy))
        row = await deliver(env, row["id"])
        await env.engine.agent_report(report(env, row["id"], version=1, attempt=1, state="running"))
        await env.engine.recover(row["id"], "tenant-a", None)
        # A run that ends while the server is replaced is cut short, not failed.
        await env.engine.agent_report(
            report(env, row["id"], version=1, attempt=1, state="failed", exit_code=143)
        )
        assert env.engine.get(row["id"], "tenant-a")["task_runs"][0]["state"] == "interrupted"
        env.clock.advance(11)
        await cycle(env, 8)
        env.clock.advance(31)
        row = await deliver(env, row["id"])
        assert row["generation"] == 2
        spec = (await env.engine.agent_report(report(env, row["id"])))["task"]
        row = env.engine.get(row["id"], "tenant-a")
        if policy == "rerun":
            assert spec["attempt"] == 2 and spec["resumed"] is True
        else:
            assert spec is None and row["task_outcome"]["state"] == "interrupted"
            assert row["state"] == "ACTIVE"


async def test_closed_rentals_drop_secrets(env):
    row, _ = env.engine.create(env.request, "tenant-a", "task-close")
    await env.engine.set_task(row["id"], "tenant-a", task())
    row = await deliver(env, row["id"])
    await env.engine.release(row["id"], "tenant-a")
    env.clock.advance(61)
    await cycle(env, 15)
    row = env.engine.get(row["id"], "tenant-a")
    assert row["state"] == "CLOSED" and row["task"]["secrets"] is None


def test_task_api_never_returns_the_script_in_listings(env):
    client = TestClient(create_app(env.service.settings, env.service))
    headers = {"Authorization": "Bearer " + "a" * 32, "Idempotency-Key": "api-task"}
    rental = client.post("/v1/rentals", headers=headers, json=env.request.model_dump(mode="json"))
    path = "/v1/rentals/" + rental.json()["rental"]["id"]
    body = task().model_dump()
    put = client.put(path + "/task", headers=headers, json=body)
    assert put.status_code == 200 and "hf_secret_value" not in put.text
    assert client.put(path + "/task", headers=headers, json={"script": "x"}).status_code == 422
    for response in (client.get(path, headers=headers), client.get("/v1/rentals", headers=headers)):
        assert "python train.py" not in response.text and "hf_secret_value" not in response.text
    assert client.get(path, headers=headers).json()["task"]["state"] == "waiting"
    assert client.get(path + "/task", headers=headers).json()["task"]["script"] == "python train.py"
    other = {"Authorization": "Bearer " + "b" * 32}
    assert client.get(path + "/task", headers=other).status_code == 404
    assert client.delete(path + "/task", headers=headers).json()["task"] is None
    assert client.post(path + "/task/stop", headers=headers).status_code == 409


class Systemd:
    """A fake `systemctl`/`systemd-run` keeping one transient unit per name."""

    def __init__(self):
        self.units, self.calls = {}, []

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        out = b""
        if args[0] == "systemd-run":
            self.units[args[2]] = dict(
                LoadState="loaded", ActiveState="active", SubState="running", ExecMainCode="0"
            )
        elif args[:2] == ["systemctl", "show"]:
            unit = self.units.get(args[2], {"LoadState": "not-found"})
            out = "".join(f"{k}={v}\n" for k, v in unit.items()).encode()
        elif args[:2] == ["systemctl", "stop"]:
            self.units.pop(args[2], None)
        return SimpleNamespace(stdout=out, returncode=0)

    def exit(self, unit, code, *, killed=False):
        self.units[unit] = dict(
            LoadState="loaded",
            ActiveState="active" if code == 0 and not killed else "failed",
            SubState="exited" if code == 0 and not killed else "failed",
            ExecMainCode="2" if killed else "1",
            ExecMainStatus=str(code),
        )


@pytest.fixture
def guest(tmp_path, monkeypatch):
    systemd = Systemd()
    account = SimpleNamespace(pw_dir=str(tmp_path / "home"), pw_uid=-1, pw_gid=1000)
    monkeypatch.setattr(guest_agent.pwd, "getpwnam", lambda name: account)
    monkeypatch.setattr(guest_agent.os, "chown", lambda *args: None)
    monkeypatch.setattr(guest_agent.subprocess, "run", systemd)
    monkeypatch.setattr(guest_agent, "TASK_ROOT", tmp_path / "task")
    monkeypatch.setattr(guest_agent, "TASK_LOGS", tmp_path / "logs")
    return systemd


SPEC = dict(
    version=1,
    attempt=1,
    script="echo hi",
    env={"EPOCHS": "3"},
    secrets={"HF_TOKEN": "hf_secret_value"},
    max_minutes=30,
    resumed=False,
    stop=False,
)


def test_agent_starts_once_and_reports_the_exit(guest):
    first = guest_agent.step_task(SPEC, "ubuntu", False)
    assert first["state"] == "running"
    run = guest.calls[1]
    assert run[:3] == ["systemd-run", "--unit", "spotbot-task-1-1"]
    assert "RuntimeMaxSec=1800" in run and "--uid" in run
    # No secret ever appears on a command line.
    assert not any("hf_secret_value" in part for call in guest.calls for part in call)
    env_file = guest_agent.TASK_ROOT / "1-1" / "env.sh"
    assert oct(env_file.stat().st_mode & 0o777) == "0o600"
    guest_agent.step_task(SPEC, "ubuntu", False)
    assert sum(c[0] == "systemd-run" for c in guest.calls) == 1
    log = guest_agent.TASK_LOGS / "1-1.log"
    log.write_text("token hf_secret_value\x1b[31m\nok\n")
    guest.exit("spotbot-task-1-1", 0)
    done = guest_agent.step_task(SPEC, "ubuntu", False)
    assert done["state"] == "succeeded" and done["exit_code"] == 0
    assert done["log_tail"] == "token [redacted][31m\nok\n"
    assert not env_file.exists()
    # The result survives an agent restart and is not re-derived from the unit.
    guest.units.clear()
    assert guest_agent.step_task(SPEC, "ubuntu", False)["state"] == "succeeded"


def test_agent_reports_failures_stops_and_lost_runs(guest):
    guest_agent.step_task(SPEC, "ubuntu", False)
    guest.exit("spotbot-task-1-1", 9, killed=True)
    assert guest_agent.step_task(SPEC, "ubuntu", False)["exit_code"] == 137
    spec = dict(SPEC, attempt=2)
    guest_agent.step_task(spec, "ubuntu", False)
    stopped = guest_agent.step_task(dict(spec, stop=True), "ubuntu", False)
    assert stopped["state"] == "stopped"
    assert ["systemctl", "stop", "spotbot-task-1-2"] in guest.calls
    spec = dict(SPEC, attempt=3)
    guest_agent.step_task(spec, "ubuntu", False)
    guest.units.clear()  # The server rebooted: the transient unit is gone.
    assert guest_agent.step_task(spec, "ubuntu", False)["state"] == "stopped"
    # A stop before the run starts never starts it.
    assert guest_agent.step_task(dict(SPEC, attempt=4, stop=True), "ubuntu", False)["state"] == (
        "stopped"
    )
    assert not any("spotbot-task-1-4" in c for c in guest.calls if c[0] == "systemd-run")


def test_agent_forwards_the_spot_warning(guest):
    guest_agent.step_task(SPEC, "ubuntu", False)
    guest_agent.step_task(SPEC, "ubuntu", True)
    assert ["systemctl", "kill", "--signal=SIGTERM", "spotbot-task-1-1"] in guest.calls
    guest_agent.step_task(SPEC, "ubuntu", True)
    assert sum(c[:2] == ["systemctl", "kill"] for c in guest.calls) == 1
    guest.exit("spotbot-task-1-1", 143)
    assert guest_agent.step_task(SPEC, "ubuntu", False)["state"] == "interrupted"


def test_launcher_passes_values_verbatim(tmp_path):
    """The unit's command line, run for real: quoting survives any value."""
    values = {"A": 'it\'s $HOME `id` "q"', "B": "x;y|z", "C": "line\\n"}
    (tmp_path / "env.sh").write_text(
        "".join(f"{k}={guest_agent.shlex.quote(v)}\n" for k, v in values.items())
    )
    (tmp_path / "run.sh").write_text('printf "%s\\n" "$A" "$B" "$C"; env | grep -c "^A="')
    out = subprocess.run(
        [
            "/bin/bash",
            "-c",
            'set -a; . "$0"; set +a; exec /bin/bash "$1"',
            str(tmp_path / "env.sh"),
            str(tmp_path / "run.sh"),
        ],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.splitlines()
    assert out == [values["A"], values["B"], values["C"], "1"]
