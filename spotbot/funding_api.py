"""Authenticated, uncached, customer-scoped floating Spot contracts."""

import logging

import httpx
from fastapi import Request
from pydantic import ValidationError

from spotbot.funding_math import envelope, order_view
from spotbot.funding_models import AcceptRequest, QuoteRequest, ReplenishmentRequest
from spotbot.opennext_ops import OperationError
from spotbot.storage.workflows import ConflictError

logger = logging.getLogger(__name__)


def install(app, service):
    ctx = service.ctx

    async def run(request, action, *, write=False, model=None):
        user, failed = await ctx.customer(request, write=write)
        if failed:
            return failed
        try:
            if user.get("role") != "buyer":
                raise OperationError(403, "A buyer account is required.")
            if write and (not user.get("email") or not await ctx.ops.kyb_approved(user["id"])):
                raise OperationError(403, "Complete company verification before purchasing.", "KYB_REQUIRED")
            body = model.model_validate_json(await request.body()) if model else None
            return ctx.no_store(await action(user, body))
        except ValidationError:
            return ctx.error(400, "The request is invalid.", code="INVALID_REQUEST")
        except OperationError as exc:
            return ctx.error(exc.status, exc.message, code=exc.code)
        except LookupError:
            return ctx.error(404, "Funding order not found.")
        except ConflictError:
            return ctx.error(409, "Your balance or order changed. Refresh and retry.", code="CREDIT_CHANGED")
        except ValueError:
            return ctx.error(409, "Your request could not be applied. Check your funds and agreed limits.")
        except (httpx.HTTPError, KeyError, TypeError):
            logger.exception("spot_funding_request_unavailable")
            return ctx.error(503, "Spot funding is temporarily unavailable. Please retry.")

    @app.get("/api/billing/spot-funding/capabilities")
    async def capabilities(request: Request):
        async def action(user, _):
            return dict(accountId=user["id"], confirmed=True, demo=False, **await service.capabilities())
        return await run(request, action)

    @app.post("/api/billing/spot-quotes")
    async def quote(request: Request):
        return await run(request, service.quote, write=True, model=QuoteRequest)

    @app.post("/api/billing/spot-purchases")
    async def purchase(request: Request):
        return await run(request, lambda user, body: service.accept(user, body, request),
                         write=True, model=AcceptRequest)

    @app.get("/api/billing/spot-funding")
    async def account(request: Request):
        async def action(user, _):
            from spotbot.funding_worker import account_view

            rows = await service.call(service.ledger.orders, user["id"])
            return await account_view(service, user["id"], rows)
        return await run(request, action)

    @app.get("/api/billing/spot-orders/{order_id}/funding")
    async def order(request: Request, order_id: str, cursor: int = 0):
        async def action(user, _):
            row = await service.call(service.ledger.order, user["id"], order_id)
            entries = await service.call(service.ledger.entries, row)
            start = max(0, cursor)
            page = entries[start:start + 100]
            return dict(**envelope(user["id"]), order=order_view(row), ledger=dict(
                totalCents=sum(e["total_cents"] for e in entries), entries=[dict(
                id=e["id"], entryKind=e["entry_kind"], startedAt=e["started_at"], endedAt=e["ended_at"],
                billableSeconds=e["billable_seconds"], hourlyCents=e["hourly_cents"],
                computeCents=e["compute_cents"], adjustmentCents=e["adjustment_cents"],
                totalCents=e["total_cents"], explanation=e.get("explanation"),
            ) for e in page], nextCursor=str(start + len(page)) if start + len(page) < len(entries) else None,
                complete=start == 0 and len(page) == len(entries)))
        return await run(request, action)

    @app.post("/api/billing/spot-orders/{order_id}/replenishments")
    async def replenish(request: Request, order_id: str):
        return await run(request, lambda user, body: service.replenish(user, order_id, body),
                         write=True, model=ReplenishmentRequest)
