"""Managed launch: a customer task the guest agent runs once the server is delivered.

The task lives on the rental row (`task`), with its secrets sealed by AES-256-GCM under
SPOTBOT_RENTAL_TASK_KEY and bound to the rental and task version. Each run is one `attempt`,
the generation it runs on, so a run on a replacement server is told apart from a retry on
the same one. When a run finishes on a delivered rental, the rental applies the customer's
choice exactly once (`task_outcome`): end the server, or keep it until it expires or the
customer ends it. Secrets are deleted once the outcome is set or the rental closes.
"""

import base64
import json
import logging
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from spotbot.models import timestamp

logger = logging.getLogger(__name__)

FINISHED = {"succeeded", "failed", "stopped"}
LOG_TAIL = 4096


class Sealer:
    def __init__(self, key_base64=""):
        key = base64.b64decode(key_base64) if key_base64 else b""
        self.aead = AESGCM(key) if len(key) == 32 else None

    def seal(self, values, aad):
        if not values:
            return None
        if self.aead is None:
            raise ValueError("task_secrets_unavailable")
        nonce = os.urandom(12)
        data = self.aead.encrypt(nonce, json.dumps(values).encode(), aad.encode())
        return base64.b64encode(nonce + data).decode()

    def open(self, sealed, aad):
        if not sealed:
            return {}
        if self.aead is None:
            raise ValueError("task_secrets_unavailable")
        raw = base64.b64decode(sealed)
        try:
            return json.loads(self.aead.decrypt(raw[:12], raw[12:], aad.encode()))
        except InvalidTag as exc:
            raise ValueError("task_secrets_unreadable") from exc


def aad(rental_id, version):
    return f"spotbot-task:{rental_id}:{version}"


def runs_of(row, version):
    return [r for r in row.get("task_runs") or [] if r["version"] == version]


def build(row, request, sealer):
    """The next task document for `request`; null secret values keep the stored ones."""
    old = row.get("task")
    version = row.get("task_seq", 0) + 1
    kept = {}
    if any(v is None for v in request.secrets.values()):
        if old is None:
            raise ValueError("task_secret_not_found")
        kept = sealer.open(old.get("secrets"), aad(row["id"], old["version"]))
    values = {}
    for name, value in request.secrets.items():
        if value is None:
            if name not in kept:
                raise ValueError("task_secret_not_found")
            value = kept[name]
        values[name] = value
    return dict(
        version=version,
        script=request.script,
        env=request.env,
        secrets=sealer.seal(values, aad(row["id"], version)),
        secret_names=sorted(values),
        on_success=request.on_success,
        on_failure=request.on_failure,
        on_replacement=request.on_replacement,
        max_minutes=request.max_minutes,
        stop=False,
        updated_at=timestamp(),
    )


def state(row):
    """`none`, `waiting`, `running`, `interrupted`, or the finished state."""
    task = row.get("task")
    outcome = row.get("task_outcome")
    if outcome and (not task or outcome["version"] == task["version"]):
        return outcome["state"]
    if not task:
        return "none"
    runs = runs_of(row, task["version"])
    if not runs:
        return "waiting"
    return "running" if runs[-1]["state"] == "running" else "interrupted"


def summary(row):
    """The task without its script or secrets, for rental listings."""
    task = row.get("task")
    if not task and not row.get("task_outcome"):
        return None
    runs = runs_of(row, task["version"]) if task else []
    last = runs[-1] if runs else None
    return dict(
        state=state(row),
        version=task["version"] if task else None,
        on_success=task and task["on_success"],
        on_failure=task and task["on_failure"],
        on_replacement=task and task["on_replacement"],
        max_minutes=task and task["max_minutes"],
        stop_requested=bool(task and task["stop"]),
        attempts=len(runs),
        started_at=last and last.get("started_at"),
        outcome=row.get("task_outcome"),
    )


def detail(row, live=None):
    """The task as its owner edits it: script and variables, secret names only.

    `live` is the current server's latest task report; it carries the running log tail.
    """
    task = row.get("task")
    runs = runs_of(row, task["version"]) if task else []
    running = (
        live
        and task
        and runs
        and runs[-1]["state"] == "running"
        and (live.get("version"), live.get("attempt")) == (task["version"], runs[-1]["attempt"])
    )
    return dict(
        task=None
        if not task
        else {k: task[k] for k in ("version", "script", "env", "secret_names")}
        | {k: task[k] for k in ("on_success", "on_failure", "on_replacement", "max_minutes")},
        summary=summary(row),
        log_tail=(live.get("log_tail") if running else None)
        or (runs[-1].get("log_tail") if runs else None)
        or (row.get("task_outcome") or {}).get("log_tail"),
    )


def public(row):
    """A rental row as the tenant API returns it: the task summary instead of the task."""
    value = {k: v for k, v in row.items() if k not in {"task", "task_runs", "task_outcome"}}
    value["task"] = summary(row)
    return value


def editable(row):
    """A task may change only until its first run starts."""
    task = row.get("task")
    return not task or (not runs_of(row, task["version"]) and not row.get("task_outcome"))


def instruction(row, gen, sealer):
    """The task for the agent on `gen`, or None when nothing should run there."""
    task = row.get("task")
    if (
        not task
        or row.get("task_outcome")
        or row["state"] != "ACTIVE"
        or row["end_requested"]
        or not gen.get("verified_at")
    ):
        return None
    attempt = gen["generation"]
    earlier = [r for r in runs_of(row, task["version"]) if r["attempt"] != attempt]
    if earlier and task["on_replacement"] != "rerun":
        return None
    try:
        secrets = sealer.open(task["secrets"], aad(row["id"], task["version"]))
    except ValueError:
        # Never let an unreadable task block the rest of the agent's instructions.
        logger.error("rental_task_secrets_unreadable rental=%s", row["id"])
        return None
    return dict(
        version=task["version"],
        attempt=attempt,
        script=task["script"],
        env=task["env"],
        secrets=secrets,
        max_minutes=task["max_minutes"],
        resumed=bool(earlier),
        stop=task["stop"],
    )


def record(row, gen, report):
    """Apply an agent's task report; returns `end` when the rental should end now."""
    task = row.get("task")
    if (
        not task
        or report.version != task["version"]
        or report.attempt != gen["generation"]
        or row.get("task_outcome")
    ):
        return None
    runs = row.setdefault("task_runs", [])
    run = next(
        (r for r in runs if (r["version"], r["attempt"]) == (task["version"], report.attempt)), None
    )
    if run is None:
        run = dict(version=task["version"], attempt=report.attempt)
        runs.append(run)
    elif run.get("state") == report.state:
        # A running task's log changes every report; the generation's report keeps the live
        # tail, so the rental is written only when the state changes.
        return None
    finished = report.state in FINISHED
    serving = row["state"] == "ACTIVE" and not row["end_requested"]
    # A run that ends while the server is being replaced or ended was cut short, not finished.
    run_state = (
        report.state if not finished or serving or report.state == "stopped" else "interrupted"
    )
    run.update(
        state=run_state,
        exit_code=report.exit_code,
        started_at=report.started_at and report.started_at.isoformat(),
        finished_at=report.finished_at and report.finished_at.isoformat(),
        log_tail=report.log_tail[-LOG_TAIL:],
    )
    if run_state not in FINISHED:
        return None
    if run_state == "stopped":
        action = "none"
    else:
        action = task["on_success"] if run_state == "succeeded" else task["on_failure"]
    row["task_outcome"] = dict(
        version=task["version"],
        attempt=report.attempt,
        state=run_state,
        exit_code=report.exit_code,
        action=action,
        finished_at=run["finished_at"] or timestamp(),
        log_tail=run["log_tail"],
    )
    task["secrets"] = None
    return "end" if action == "end" else None


def skip_replacement(row, gen):
    """With `on_replacement=none`, a run cut short by a replacement is not run again."""
    task = row.get("task")
    if not task or row.get("task_outcome") or task["on_replacement"] != "none":
        return False
    runs = runs_of(row, task["version"])
    if not runs or row["state"] != "ACTIVE" or any(r["attempt"] == gen["generation"] for r in runs):
        return False
    row["task_outcome"] = dict(
        version=task["version"],
        attempt=runs[-1]["attempt"],
        state="interrupted",
        exit_code=None,
        action="none",
        finished_at=timestamp(),
        log_tail=runs[-1].get("log_tail") or "",
    )
    task["secrets"] = None
    return True


def stop(row):
    """Stop the task: at once when no run has started, otherwise through the agent."""
    task = row.get("task")
    if not task or row.get("task_outcome"):
        raise ValueError("task_not_running")
    if runs_of(row, task["version"]):
        task["stop"] = True
        return
    row["task_outcome"] = dict(
        version=task["version"],
        attempt=None,
        state="stopped",
        exit_code=None,
        action="none",
        finished_at=timestamp(),
        log_tail="",
    )
    task["secrets"] = None


def scrub(row):
    """Delete sealed secrets once the rental has closed."""
    task = row.get("task")
    if task and task.get("secrets") and row["state"] == "CLOSED":
        task["secrets"] = None
