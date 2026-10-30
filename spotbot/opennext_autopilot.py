"""Autopilot routes: the task a customer leaves for their Spot server.

The bot keeps the task on the rental and the guest agent runs it once the server is
delivered; these routes only check that the instance is the signed-in customer's and translate
between the Terminal's camelCase payloads and the bot's task API.
"""

from typing import Literal

import httpx
from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from spotbot.rental_models import TaskRequest

MESSAGES = {
    "rental_ended": (409, "This instance has ended; its autopilot can no longer change."),
    "task_started": (
        409,
        "The task has already started and can no longer change. Stop it instead.",
    ),
    "task_not_running": (409, "There is no task to stop."),
    "task_secret_not_found": (400, "A kept secret no longer exists. Enter its value again."),
    "task_secrets_unavailable": (
        503,
        "Secrets cannot be stored right now. Remove them or try again later.",
    ),
}


class AutopilotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    script: str
    env: dict[str, str] = Field(default_factory=dict)
    # A null value keeps the stored secret of that name.
    secrets: dict[str, str | None] = Field(default_factory=dict)
    onSuccess: Literal["end", "keep"] = "end"
    onFailure: Literal["end", "keep"]
    onReplacement: Literal["rerun", "none"] = "rerun"
    maxMinutes: int | None = None

    def task(self):
        return TaskRequest(
            script=self.script,
            env=self.env,
            secrets=self.secrets,
            on_success=self.onSuccess,
            on_failure=self.onFailure,
            on_replacement=self.onReplacement,
            max_minutes=self.maxMinutes,
        )


def outcome_view(outcome):
    if not outcome:
        return None
    return {
        "state": outcome["state"],
        "exitCode": outcome.get("exit_code"),
        "action": outcome["action"],
        "finishedAt": outcome.get("finished_at"),
    }


def summary_view(summary):
    """The task state shown on an instance row, or None without a task."""
    if not summary:
        return None
    return {
        "state": summary["state"],
        "onSuccess": summary.get("on_success"),
        "onFailure": summary.get("on_failure"),
        "startedAt": summary.get("started_at"),
        "stopRequested": summary.get("stop_requested", False),
        "outcome": outcome_view(summary.get("outcome")),
    }


def detail_view(detail):
    task = detail.get("task")
    return {
        "task": None
        if not task
        else {
            "version": task["version"],
            "script": task["script"],
            "env": task["env"],
            "secretNames": task["secret_names"],
            "onSuccess": task["on_success"],
            "onFailure": task["on_failure"],
            "onReplacement": task["on_replacement"],
            "maxMinutes": task["max_minutes"],
        },
        "status": summary_view(detail.get("summary")),
        "logTail": detail.get("log_tail") or "",
    }


def install(app, ctx):
    """Register the routes; `ctx` carries the adapter's market, `error`, `no_store` and
    `own_rental` helpers."""
    market, error, no_store, own_rental = ctx.market, ctx.error, ctx.no_store, ctx.own_rental

    async def call(method, rental_id, suffix="", body=None):
        response = await market.bot(
            method, f"/v1/rentals/{rental_id}/task{suffix}", **({"json": body} if body else {})
        )
        if response.status_code in {400, 409}:
            detail = response.json().get("detail")
            status, message = MESSAGES.get(detail, (409, "The autopilot could not be changed."))
            return error(status, message, code=str(detail).upper())
        response.raise_for_status()
        return no_store(detail_view(response.json()))

    path = "/api/marketplace/instances/{rental_id}/autopilot"

    @app.get(path)
    async def get_autopilot(request: Request, rental_id: str):
        _, rental, failed = await own_rental(request, rental_id, write=False)
        if failed:
            return failed
        try:
            return await call("GET", rental["id"])
        except httpx.HTTPError:
            return error(503, "The autopilot is temporarily unavailable.")

    @app.api_route(path, methods=["PUT", "POST"])
    async def set_autopilot(request: Request, rental_id: str):
        _, rental, failed = await own_rental(request, rental_id, write=True)
        if failed:
            return failed
        try:
            body = AutopilotRequest.model_validate_json(await request.body()).task()
        except ValidationError:
            return error(
                400,
                "Check the script, variable names (letters, digits and underscores) and the "
                "choices for success and failure.",
                code="INVALID_AUTOPILOT",
            )
        try:
            return await call("PUT", rental["id"], body=body.model_dump())
        except httpx.HTTPError:
            return error(503, "The autopilot could not be saved. Please try again.")

    @app.delete(path)
    async def remove_autopilot(request: Request, rental_id: str):
        _, rental, failed = await own_rental(request, rental_id, write=True)
        if failed:
            return failed
        try:
            return await call("DELETE", rental["id"])
        except httpx.HTTPError:
            return error(503, "The autopilot could not be removed. Please try again.")

    @app.post(path + "/stop")
    async def stop_autopilot(request: Request, rental_id: str):
        _, rental, failed = await own_rental(request, rental_id, write=True)
        if failed:
            return failed
        try:
            return await call("POST", rental["id"], "/stop")
        except httpx.HTTPError:
            return error(503, "The task could not be stopped. Please try again.")
