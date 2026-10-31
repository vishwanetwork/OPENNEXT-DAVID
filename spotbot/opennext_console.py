"""Protected, server-owned operations views and bounded maintenance jobs."""

import asyncio
import os
import uuid
from datetime import timedelta

import httpx
from fastapi import Request

from spotbot.models import timestamp, utcnow
from spotbot.opennext_console_data import (
    LegacySnapshots,
    order_rows,
    page,
    rental_summary,
    user_growth,
)
from spotbot.opennext_console_pricing import CollectorBridge
from spotbot.opennext_ops import KYB, TRANSFER, OperationError
from spotbot.rentals import at
from spotbot.storage.workflows import ConflictError


class ConsoleBackend:
    def __init__(self, ctx):
        self.ctx, self.db, self.market, self.ops = ctx, ctx.db, ctx.market, ctx.ops
        settings = ctx.settings
        self.snapshots = LegacySnapshots(
            (settings.spotbot_opennext_legacy_data_dir if settings else "")
            or os.environ.get("OPENNEXT_DATA_DIR", "")
        )
        self.bridge = CollectorBridge(
            self.db,
            settings.spotbot_opennext_console_key.get_secret_value() if settings else "",
            ctx.origin,
            ctx.client,
            ctx.headers,
        )
        self.lock = asyncio.Lock()
        self.worker_error = None

    async def documents(self, kind):
        return await asyncio.to_thread(self.db.list, kind)

    async def rentals(self):
        if self.market is None:
            raise OperationError(503, "The Spot Bot is not configured.")
        try:
            return await self.market.rentals()
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise OperationError(503, "The Spot Bot is temporarily unavailable.") from exc

    async def audit(self, actor, action, target, detail=""):
        doc = dict(
            id=str(uuid.uuid4()),
            kind="console_audit",
            tenant_id="operations",
            actor=actor,
            action=action,
            target=target,
            detail=detail,
            at=timestamp(),
        )
        await asyncio.to_thread(self.db.save, doc)

    async def activity(self):
        rows = await self.documents("console_audit")
        for kind in [TRANSFER, KYB]:
            for doc in await self.documents(kind):
                decision = doc.get("decision")
                if decision:
                    rows.append(
                        dict(
                            id=doc["id"],
                            at=decision["at"],
                            actor=decision.get("operator") or "Operations",
                            action=decision.get("decision", "Reviewed"),
                            target=doc["id"],
                            detail="Customer review decision",
                        )
                    )
        return sorted(rows, key=lambda row: (row["at"], row["id"]), reverse=True)

    async def read(self, section, request, cursor, limit, search, role, state):
        if section == "users":
            users = await asyncio.to_thread(self.snapshots.users)
            growth = user_growth(users)
            rows = sorted(users, key=lambda row: (row["joinedAt"], row["id"]), reverse=True)
            rows = [
                r
                for r in rows
                if (not role or r["role"] == role)
                and search.lower() in " ".join([r["name"], r["email"], r["company"] or ""]).lower()
            ]
            result, next_cursor = page(rows, cursor, limit)
            return dict(
                users=result,
                totalUsers=len(users),
                filteredTotal=len(rows),
                growth=growth,
                nextCursor=next_cursor,
            )
        if section == "orders":
            users = await asyncio.to_thread(self.snapshots.users)
            legacy = await asyncio.to_thread(self.snapshots.read, "marketplace.json")
            if not isinstance(legacy.get("orders"), list):
                raise OperationError(503, "The order snapshot has an unsupported format.")
            rows = order_rows(
                await self.rentals(),
                await self.documents("opennext_charge"),
                legacy["orders"],
                users,
            )
            kind = request.query_params.get("kind", "")
            if kind not in {"", "All", "Instance", "RFQ"}:
                raise OperationError(400, "Invalid order type.")
            rows = [
                r
                for r in rows
                if (not state or state == "all" or r["state"] == state)
                and (not kind or kind == "All" or r["kind"] == kind)
                and search.lower()
                in " ".join(
                    str(r[k]) for k in ["id", "email", "model", "country", "term", "status"]
                ).lower()
            ]
            result, next_cursor = page(rows, cursor, limit)
            return dict(orders=result, total=len(rows), nextCursor=next_cursor)
        if section == "activity":
            rows = await self.activity()
            rows = [
                r
                for r in rows
                if search.lower()
                in " ".join(
                    str(r.get(key) or "") for key in ["actor", "action", "target", "detail"]
                ).lower()
            ]
            result, next_cursor = page(rows, cursor, limit)
            return dict(events=result, total=len(rows), nextCursor=next_cursor)
        if section == "overview":
            transfers, cases, rentals = (
                await self.ops.transfers(),
                await self.ops.kyb_cases(),
                await self.rentals(),
            )
            return dict(
                metrics={
                    "pendingTopups": sum(
                        d["purpose"] == "topup"
                        and d["status"] in {"Awaiting transfer", "Awaiting payment confirmation"}
                        for d in transfers
                    ),
                    "pendingPayments": sum(
                        d["purpose"] == "order"
                        and d["status"] in {"Awaiting transfer", "Awaiting payment confirmation"}
                        for d in transfers
                    ),
                    "pendingKyb": sum(d.get("status") == "Reviewing" for d in cases),
                    "liveInstances": sum(
                        r["state"] == "ACTIVE" and not r.get("end_requested") for r in rentals
                    ),
                },
                events=(await self.activity())[:10],
            )
        if section == "agent":
            if self.market is None:
                raise OperationError(503, "The Spot Bot is not configured.")
            response = await self.market.bot("GET", "/health")
            response.raise_for_status()
            health = response.json()
            safe = {
                key: health.get(key)
                for key in [
                    "status",
                    "background_enabled",
                    "worker_running",
                    "live_orders_enabled",
                    "dry_run_enabled",
                    "rentals_enabled",
                    "rental_worker_running",
                    "rental_event_consumer_error",
                ]
            }
            jobs = sorted(
                await self.documents("console_job"), key=lambda d: d["createdAt"], reverse=True
            )
            return dict(
                health=safe,
                rentalStates=rental_summary(await self.rentals()),
                jobs=[self.job_view(j) for j in jobs[:50]],
                maintenanceError=self.worker_error,
                policy={"arbitraryCode": False, "runningOrdersChanged": False},
            )
        if section == "billing":
            rows = await self.documents("opennext_charge")
            return dict(
                currency="USD",
                billedCents=sum(r.get("billed_cents", 0) for r in rows if r["state"] == "billed"),
                heldCents=sum(r["cents"] for r in rows if r["state"] in {"held", "charged"}),
                releasedCents=sum(
                    r["cents"] if r["state"] == "refunded" else r.get("released_cents", 0)
                    for r in rows
                ),
                providerInvoiceCents=None,
                entries=[
                    dict(
                        id=r["id"],
                        rentalId=r.get("rental_id"),
                        state=r["state"],
                        heldCents=r["cents"],
                        billedCents=r.get("billed_cents"),
                        releasedCents=r["cents"]
                        if r["state"] == "refunded"
                        else r.get("released_cents"),
                        at=r.get("updated_at", ""),
                    )
                    for r in sorted(rows, key=lambda r: r.get("updated_at", ""), reverse=True)[:200]
                ],
            )
        raise OperationError(404, "Unknown operations view.")

    @staticmethod
    def job_view(doc):
        return {
            k: doc.get(k) for k in ["id", "action", "state", "createdAt", "finishedAt", "error"]
        }

    async def enqueue(self, actor, body):
        if (
            not isinstance(body, dict)
            or set(body) != {"action", "idempotencyKey"}
            or body.get("action") != "reconcile"
        ):
            raise OperationError(400, "Choose the supported reconciliation operation.")
        key = body.get("idempotencyKey")
        if not isinstance(key, str) or not 1 <= len(key) <= 100:
            raise OperationError(400, "A valid operation key is required.")
        if self.ctx.notifier is None:
            raise OperationError(503, "The reconciliation service is not configured.")
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, "console:" + actor + ":" + key))
        async with self.lock:
            doc = await asyncio.to_thread(self.db.get, "console_job", identity)
            if doc:
                return self.job_view(doc)
            pending = [
                d
                for d in await self.documents("console_job")
                if d["state"] in {"queued", "running"}
            ]
            if pending:
                raise OperationError(409, "A reconciliation is already queued or running.")
            doc = dict(
                id=identity,
                kind="console_job",
                tenant_id="operations",
                actor=actor,
                action="reconcile",
                state="queued",
                createdAt=timestamp(),
            )
            await asyncio.to_thread(self.db.save, doc)
            await self.audit(actor, "Reconciliation queued", identity)
            return self.job_view(doc)

    async def tick(self):
        async with self.lock:
            for doc in await self.documents("console_job"):
                stale = doc["state"] == "running" and utcnow() - at(doc["updated_at"]) > timedelta(
                    minutes=5
                )
                if doc["state"] != "queued" and not stale:
                    continue
                try:
                    version = doc["version"]
                    doc["state"] = "running"
                    await asyncio.to_thread(self.db.save, doc, version)
                except ConflictError:
                    continue
                try:
                    await self.ctx.notifier.tick()
                    doc.update(state="completed", error=None)
                except Exception:
                    doc.update(
                        state="failed",
                        error="Reconciliation failed. Inspect the service logs and retry.",
                    )
                doc["finishedAt"] = timestamp()
                await asyncio.to_thread(self.db.save, doc, doc["version"])
                await self.audit(doc["actor"], "Reconciliation " + doc["state"], doc["id"])

    async def run(self):
        while True:
            try:
                await self.bridge.restore()
                await self.tick()
                self.worker_error = None
            except Exception:
                # Never log upstream bodies or credential material.
                self.worker_error = "Console maintenance could not complete its last cycle."
            await asyncio.sleep(30)


def install(app, ctx):
    backend = ConsoleBackend(ctx)
    app.state.console_backend = backend

    async def guard(request, *, write=False):
        actor, failed = await ctx.admin_session(request)
        if failed:
            return None, failed
        if write and not ctx.same_origin(request):
            return None, ctx.error(403, "Use the Console's own origin.")
        return actor, None

    def endpoint(section):
        async def read(
            request: Request,
            cursor: str = "",
            limit: int = 50,
            search: str = "",
            role: str = "",
            state: str = "processing",
        ):
            _, failed = await guard(request)
            if failed:
                return failed
            try:
                if len(search) > 200 or state not in {
                    "processing",
                    "completed",
                    "cancelled",
                    "all",
                    "",
                }:
                    raise OperationError(400, "Invalid operations filter.")
                value = await backend.read(section, request, cursor, limit, search, role, state)
                return ctx.no_store(dict(value, asOf=timestamp()))
            except OperationError as exc:
                return ctx.error(exc.status, exc.message)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                return ctx.error(503, "The operations source is temporarily unavailable.")

        return read

    for section, path in [
        ("users", "/api/admin/users"),
        ("orders", "/api/admin/orders"),
        ("activity", "/api/admin/operations/activity"),
        ("overview", "/api/admin/overview"),
        ("agent", "/api/admin/agent"),
        ("billing", "/api/admin/agent/billing"),
    ]:
        app.add_api_route(path, endpoint(section), methods=["GET"])

    @app.post("/api/admin/agent/actions")
    async def action(request: Request):
        actor, failed = await guard(request, write=True)
        if failed:
            return failed
        try:
            value = await backend.enqueue(actor, await request.json())
            return ctx.no_store(value)
        except (ValueError, TypeError):
            return ctx.error(400, "Invalid operation request.")
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)

    @app.get("/api/admin/pricing/providers")
    async def providers(request: Request):
        _, failed = await guard(request)
        if failed:
            return failed
        try:
            return ctx.no_store(await backend.bridge.providers(request))
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)

    @app.api_route("/api/admin/pricing/providers/{provider}/{operation}", methods=["POST"])
    async def pricing_write(request: Request, provider: str, operation: str):
        actor, failed = await guard(request, write=True)
        if failed:
            return failed
        try:
            if (
                not provider.replace("-", "").isalnum()
                or len(provider) > 40
                or operation not in {"credential", "run", "test"}
            ):
                raise OperationError(400, "Invalid collector operation.")
            body = await request.json()
            value = (
                await backend.bridge.credential(request, provider, body.get("credential"))
                if operation == "credential"
                else await backend.bridge.call(
                    request, "POST", f"/api/admin/pricing/providers/{provider}/{operation}", {}
                )
            )
            await backend.audit(actor, "Price source " + operation, provider)
            return ctx.no_store(value)
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)
        except (ValueError, TypeError, AttributeError):
            return ctx.error(400, "Invalid collector request.")

    @app.patch("/api/admin/pricing/providers/{provider}")
    async def pricing_settings(request: Request, provider: str):
        actor, failed = await guard(request, write=True)
        if failed:
            return failed
        try:
            if not provider.replace("-", "").isalnum() or len(provider) > 40:
                raise OperationError(400, "Invalid source.")
            body = await request.json()
            if (
                set(body) != {"enabled", "intervalMinutes"}
                or type(body["enabled"]) is not bool
                or type(body["intervalMinutes"]) is not int
                or not 10 <= body["intervalMinutes"] <= 1440
            ):
                raise OperationError(400, "Use an interval between 10 and 1440 minutes.")
            value = await backend.bridge.call(
                request, "PATCH", f"/api/admin/pricing/providers/{provider}", body
            )
            await backend.audit(actor, "Price source settings updated", provider)
            return ctx.no_store(value)
        except OperationError as exc:
            return ctx.error(exc.status, exc.message)
        except (ValueError, TypeError):
            return ctx.error(400, "Invalid source settings.")

    return backend
