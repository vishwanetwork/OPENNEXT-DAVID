import asyncio
import secrets
import shlex
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from spotbot.config import Settings
from spotbot.models import (
    Market,
    OrderRequest,
    ProviderName,
    ReconcileRequest,
    SFPlanRequest,
    gpu_model,
)
from spotbot.providers import ProviderError
from spotbot.service import Service, order_public, sanitized_plan


def create_app(settings: Settings | None = None, service: Service | None = None) -> FastAPI:
    config = settings or Settings()
    svc = service or Service(config)

    @asynccontextmanager
    async def lifespan(app):
        task = None
        history_task = None
        list_history_task = None
        rental_task = None
        try:
            svc.acquire()
            if config.spotbot_background_enabled:
                if config.spotbot_rentals_enabled:
                    rental_task = asyncio.create_task(svc.rentals.run())
                task = asyncio.create_task(svc.run())
                if config.enabled("aws") and config.spotbot_aws_spot_history_enabled:
                    history_task = asyncio.create_task(svc.run_history())
                if config.enabled("aws") and config.spotbot_aws_list_history_enabled:
                    list_history_task = asyncio.create_task(svc.run_list_history())
            app.state.worker_task = task
            app.state.rental_task = rental_task
            yield
        finally:
            if rental_task:
                rental_task.cancel()
                with suppress(asyncio.CancelledError):
                    await rental_task
            if list_history_task:
                list_history_task.cancel()
                with suppress(asyncio.CancelledError):
                    await list_history_task
            if history_task:
                history_task.cancel()
                with suppress(asyncio.CancelledError):
                    await history_task
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            await svc.close()

    app = FastAPI(
        title="SpotOrderBot",
        version="0.1.0",
        lifespan=lifespan,
        description="GPU price history, capacity orders and SSH/HTTP gateway handoff",
    )
    # Catalog pages are ~1 MB of repetitive JSON; compression keeps slow links within timeouts.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.state.service = svc
    from spotbot.rental_api import install

    install(app, svc)
    bearer = HTTPBearer(auto_error=False)

    def authenticate(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        key = config.spotbot_api_key.get_secret_value()
        if key and (not credentials or not secrets.compare_digest(credentials.credentials, key)):
            raise HTTPException(401, "invalid_api_token", headers={"WWW-Authenticate": "Bearer"})

    auth = [Depends(authenticate)]

    def get_order(order_id):
        order = svc.store.get_order(order_id)
        if not order:
            raise HTTPException(404, "order_not_found")
        return order

    def handle_value_error(exc):
        code = str(exc)
        status = (
            409
            if code
            in {
                "idempotency_key_conflict",
                "price_exceeds_limit",
                "live_orders_disabled",
                "dry_run_disabled",
            }
            else 400
        )
        raise HTTPException(status, code) from exc

    @app.get("/health")
    def health():
        task = getattr(app.state, "worker_task", None)
        rental_task = getattr(app.state, "rental_task", None)
        return {
            "status": "ok",
            "background_enabled": config.spotbot_background_enabled,
            "worker_running": bool(task and not task.done()),
            "live_orders_enabled": config.spotbot_live_orders_enabled,
            "dry_run_enabled": config.spotbot_dry_run_enabled,
            "rentals_enabled": config.spotbot_rentals_enabled,
            "rental_worker_running": bool(rental_task and not rental_task.done()),
            "rental_event_consumer_error": getattr(svc.rentals, "event_consumer_error", None),
        }

    @app.get("/v1/providers", dependencies=auth)
    def provider_status():
        capabilities = {
            "aws": {
                "spot_catalog": True,
                "spot_orders": True,
                "on_demand_orders": False,
                "native_spot_price_limit": True,
                "list_prices": "On-demand and Reserved from the AWS Price List (reference only)",
                "limitation": "Capacity is confirmed only by a launch attempt; regional quotas apply",
            },
            "lambda": {"spot_catalog": False, "spot_orders": False, "on_demand_orders": True},
            "tensordock": {
                "spot_catalog": False,
                "spot_orders": False,
                "on_demand_orders": True,
                "limitation": "v2 location-based, dedicated IP only; v2 spot schema pending verification",
            },
            "vultr": {
                "spot_catalog": True,
                "spot_orders": False,
                "on_demand_orders": True,
                "limitation": "preemptible create schema pending verification",
            },
            "shadeform": {"spot_catalog": True, "spot_orders": True, "on_demand_orders": True},
        }
        collections = {r["provider"]: r for r in svc.store.collection_status()}
        return {
            "providers": [
                {
                    "provider": name,
                    "enabled": config.enabled(name),
                    "configured": p.configured,
                    "public_catalog": name == "vultr",
                    "capabilities": capabilities[name],
                    "last_collection": collections.get(name),
                    **(
                        {
                            "last_list_price_collection": collections.get("aws_list"),
                            "last_price_region_collection": collections.get("aws_regions"),
                            "price_regions": config.aws_price_regions,
                        }
                        if name == "aws"
                        else {}
                    ),
                }
                for name, p in svc.providers.items()
            ]
        }

    @app.post("/v1/collections", dependencies=auth)
    async def collect(provider: ProviderName | None = None):
        return {"results": await svc.collect(provider)}

    def latest_offers(
        provider=None,
        cloud=None,
        market=None,
        model=None,
        available_only=False,
        can_attempt_only=False,
    ):
        offers = svc.store.latest(
            provider=provider,
            cloud=cloud,
            market=market,
            gpu_model=gpu_model(model) if model else None,
        )
        rows = [
            svc.providers[o.provider].public_offer(o, config.spotbot_price_max_age_seconds)
            for o in offers
            if config.enabled(o.provider)
        ]
        if available_only:
            rows = [o for o in rows if o["available"] and not o["stale"]]
        if can_attempt_only:
            rows = [o for o in rows if o["can_attempt"]]
        return rows

    @app.get("/v1/prices/latest", dependencies=auth)
    def latest(
        provider: ProviderName | None = None,
        cloud: str | None = None,
        market: Market | None = None,
        gpu: str | None = None,
        available_only: bool = False,
        can_attempt_only: bool = False,
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ):
        rows = latest_offers(provider, cloud, market, gpu, available_only, can_attempt_only)
        selected = rows[offset : offset + limit]
        groups = [
            {"provider": name, "offers": [o for o in selected if o["provider"] == name]}
            for name in svc.providers
            if any(o["provider"] == name for o in selected)
        ]
        return {"total": len(rows), "limit": limit, "offset": offset, "groups": groups}

    @app.get("/v1/prices/aws-list-history", dependencies=auth)
    def aws_list_history(
        region: str = Query(..., min_length=1, max_length=64),
        sku: str = Query(..., min_length=1, max_length=128),
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = Query(1000, ge=1, le=5000),
        offset: int = Query(0, ge=0),
    ):
        from spotbot.spot_history import iso

        if any(value and value.tzinfo is None for value in (since, until)):
            raise HTTPException(400, "timestamps_require_timezone")
        end = (until or datetime.now(UTC)).astimezone(UTC)
        start = (since or end - timedelta(days=90)).astimezone(UTC)
        if start >= end or end - start > timedelta(days=90):
            raise HTTPException(400, "history_window_must_be_between_zero_and_90_days")
        data = svc.list_history.query(region, sku, iso(start), iso(end))
        rows = data.pop("items")
        return {
            "provider": "aws", "region": region, "sku": sku,
            "kind": "published_price_intervals", "unit": "USD / instance-hour",
            "commitment": {"months": 12, "payment": "no_upfront"},
            **data, "total": len(rows), "limit": limit, "offset": offset,
            "items": rows[offset:offset + limit],
        }

    @app.get("/v1/prices/aws-spot-history", dependencies=auth)
    def aws_spot_history(
        region: str = Query(..., min_length=1, max_length=64),
        sku: str = Query(..., min_length=1, max_length=128),
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = Query(1000, ge=1, le=5000),
        offset: int = Query(0, ge=0),
    ):
        from spotbot.spot_history import iso

        if any(value and value.tzinfo is None for value in (since, until)):
            raise HTTPException(400, "timestamps_require_timezone")
        end = (until or datetime.now(UTC)).astimezone(UTC)
        start = (since or end - timedelta(days=90)).astimezone(UTC)
        if start >= end or end - start > timedelta(days=90):
            raise HTTPException(400, "history_window_must_be_between_zero_and_90_days")
        coverage = svc.spot_history.coverage(region, sku)
        rows = svc.spot_history.read(region, sku, iso(start), iso(end)) if coverage else []
        return {
            "provider": "aws", "market": "spot", "region": region, "sku": sku,
            "kind": "price_change_events", "unit": "USD / instance-hour",
            "coverage": coverage, "total": len(rows), "limit": limit, "offset": offset,
            "items": rows[offset:offset + limit],
        }

    @app.get("/v1/prices/history", dependencies=auth)
    def history(
        provider: ProviderName | None = None,
        sku: str | None = None,
        cloud: str | None = None,
        region: str | None = None,
        market: Market | None = None,
        offer_id: str | None = None,
        gpu: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ):
        for value in [since, until]:
            if value and value.tzinfo is None:
                raise HTTPException(400, "timestamps_require_timezone")
        if since and until and since > until:
            raise HTTPException(400, "since_must_precede_until")
        total, rows = svc.store.history(
            provider=provider,
            sku=sku,
            cloud=cloud,
            region=region,
            market=market,
            offer_id=offer_id,
            gpu_model=gpu_model(gpu) if gpu else None,
            since=since.astimezone(UTC).isoformat() if since else None,
            until=until.astimezone(UTC).isoformat() if until else None,
            limit=limit,
            offset=offset,
        )
        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": [
                dict(o.public(config.spotbot_price_max_age_seconds), snapshot_id=i) for i, o in rows
            ],
        }

    @app.get("/v1/gpus", dependencies=auth)
    def gpus(
        model: str | None = None,
        provider: ProviderName | None = None,
        market: Market | None = None,
        available_only: bool = True,
        can_attempt_only: bool = False,
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ):
        rows = latest_offers(
            provider=provider,
            market=market,
            model=model,
            available_only=available_only,
            can_attempt_only=can_attempt_only,
        )
        models = sorted({o["gpu_model"] for o in rows})
        groups = [
            {
                "model": m,
                "providers": sorted({o["provider"] for o in rows if o["gpu_model"] == m}),
                "offers": [o for o in rows if o["gpu_model"] == m],
            }
            for m in models
        ]
        return {
            "total": len(groups),
            "limit": limit,
            "offset": offset,
            "gpus": groups[offset : offset + limit],
        }

    @app.get("/v1/offers/{offer_id}", dependencies=auth)
    def offer_details(offer_id: str):
        offer = svc.store.get_offer(offer_id)
        if not offer:
            raise HTTPException(404, "offer_not_found")
        return svc.providers[offer.provider].public_offer(offer, config.spotbot_price_max_age_seconds)

    @app.post("/v1/orders", dependencies=auth)
    def order_create(
        request: OrderRequest, idempotency_key: Annotated[str, Header(min_length=1, max_length=200)]
    ):
        try:
            order, created = svc.create_order(request, idempotency_key)
        except ValueError as exc:
            handle_value_error(exc)
        return {"created": created, "order": order}

    @app.get("/v1/orders", dependencies=auth)
    def order_list(limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
        return {
            "limit": limit,
            "offset": offset,
            "orders": [order_public(o) for o in svc.store.orders(limit, offset)],
        }

    @app.get("/v1/orders/{order_id}", dependencies=auth)
    def order_details(order_id: str):
        return order_public(get_order(order_id))

    @app.get("/v1/orders/{order_id}/plan", dependencies=auth)
    def order_plan(order_id: str):
        order = get_order(order_id)
        from spotbot.models import Offer

        request = OrderRequest.model_validate(order["request"])
        offer = Offer.model_validate(order["offer"])
        plan = svc.providers[offer.provider].plan(
            offer, request.launch, "spotbot-" + order_id, max_price_hourly=request.max_price_hourly
        )
        return {
            "order_id": order_id,
            "executed": bool(order["instance_id"]),
            "plan": sanitized_plan(plan),
        }

    @app.post("/v1/orders/{order_id}/cancel", dependencies=auth)
    async def order_cancel(order_id: str):
        get_order(order_id)
        async with svc.worker_lock:
            try:
                return svc.cancel(order_id)
            except ValueError as exc:
                handle_value_error(exc)

    @app.post("/v1/orders/{order_id}/release", dependencies=auth)
    async def order_release(order_id: str):
        get_order(order_id)
        async with svc.worker_lock:
            try:
                return svc.release(order_id)
            except ValueError as exc:
                handle_value_error(exc)

    @app.post("/v1/orders/{order_id}/reconcile", dependencies=auth)
    async def order_reconcile(order_id: str, request: ReconcileRequest):
        get_order(order_id)
        try:
            return await svc.reconcile(order_id, request.instance_id)
        except ValueError as exc:
            handle_value_error(exc)
        except ProviderError as exc:
            raise HTTPException(502, exc.code) from exc

    @app.get("/v1/orders/{order_id}/handoff", dependencies=auth)
    def handoff(order_id: str):
        order = get_order(order_id)
        if order["state"] != "ready" or not order["handoff"]:
            raise HTTPException(409, {"code": "instance_not_ready", "state": order["state"]})
        return order["handoff"]

    @app.get("/v1/orders/{order_id}/events", dependencies=auth)
    def order_events(
        order_id: str, limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)
    ):
        get_order(order_id)
        return {
            "limit": limit,
            "offset": offset,
            "events": svc.store.events(order_id, limit=limit, offset=offset),
        }

    @app.post("/v1/worker/tick", dependencies=auth)
    async def worker_tick():
        await svc.tick()
        return {"status": "ok"}

    @app.post("/v1/sfcompute/plan", dependencies=auth)
    def sf_plan(request: SFPlanRequest):
        buy = [
            "sf",
            "orders",
            "create",
            "--pool",
            request.pool,
            "--side",
            "buy",
            "--count",
            str(request.node_count),
            "--sku",
            request.sku,
            "--start",
            "now",
            "--duration",
            f"{request.duration_hours}h",
            "--max-rate",
            str(request.max_rate_per_node_hour),
            "--no-input",
        ]
        if request.allow_standing:
            buy.append("--allow-standing")
        commands = [
            {
                "step": "create_pool_if_needed",
                "argv": ["sf", "pools", "create", "--name", request.pool],
            },
            {"step": "buy_compute_time", "argv": buy},
            {"step": "wait_for_full_fill", "argv": ["sf", "orders", "list"]},
            {
                "step": "create_each_instance_after_fill",
                "argv": [
                    "sf",
                    "instances",
                    "create",
                    "--pool",
                    request.pool,
                    "--sku",
                    request.sku,
                    "--image",
                    request.image,
                    "--cloud-init",
                    "./startup.sh",
                ],
            },
        ]
        return {
            "mode": "plan_only",
            "executed": False,
            "unit": "8_gpu_node_hour",
            "maximum_compute_cost_usd": str(
                request.max_rate_per_node_hour * request.node_count * request.duration_hours
            ),
            "instances_to_create": request.node_count,
            "commands": [dict(c, command=shlex.join(c["argv"])) for c in commands],
            "source": "https://docs.sfcompute.com/preview/quick-start",
        }

    return app
