"""Tenant-scoped execution API. Payment and RFQ authoring remain upstream."""

import secrets
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from spotbot.rental_models import (
    AgentReport,
    GatewayAck,
    RecoveryRequest,
    RentalRequest,
    RevisionRequest,
    RulesModel,
    SshKeysRequest,
    TaskRequest,
)
from spotbot.rental_tasks import public
from spotbot.rentals import identity


class Reconciliation(RulesModel):
    confirm_absent: bool = False


@dataclass(frozen=True)
class DeliveryPrincipal:
    tenant: str
    gateway: bool = False


def delivery_view(row, principal):
    if not principal.gateway:
        return public(row)
    return {
        "authorization_scope": "gateway_delivery",
        **{
            k: row[k]
            for k in (
                "id",
                "tenant_id",
                "version",
                "generation",
                "state",
                "end_requested",
                "connection",
            )
        },
        "rfq": {
            k: row["rfq"][k] for k in ("expires_at", "ssh_user", "http_port", "http_health_path")
        },
    }


def install(app, service):
    engine, config = service.rentals, service.settings
    router = APIRouter(prefix="/v1/rentals", tags=["Protected server rentals"])
    bearer = HTTPBearer(auto_error=False)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        if request.url.path.startswith(("/v1/rentals", "/v1/agents")):
            # Pydantic's default input field can echo an agent bearer token.
            return JSONResponse(
                status_code=422,
                content={
                    "detail": [
                        {k: item[k] for k in ("type", "loc", "msg") if k in item}
                        for item in exc.errors()
                    ]
                },
            )
        return await request_validation_exception_handler(request, exc)

    def authenticate(credentials, x_spotbot_tenant, *, allow_gateway=False):
        if not config.spotbot_rentals_enabled:
            raise HTTPException(409, "rentals_disabled")
        token = credentials.credentials if credentials else ""
        gateway = config.spotbot_rental_gateway_token.get_secret_value()
        if gateway and secrets.compare_digest(token.encode(), gateway.encode()):
            if allow_gateway and x_spotbot_tenant:
                return DeliveryPrincipal(x_spotbot_tenant, gateway=True)
            raise HTTPException(401, "gateway_token_scope_denied")
        for owner, key in config.rental_tenant_tokens.items():
            if secrets.compare_digest(token.encode(), key.encode()):
                if x_spotbot_tenant and owner != x_spotbot_tenant:
                    raise HTTPException(403, "tenant_mismatch")
                return owner
        admin = config.spotbot_api_key.get_secret_value()
        if admin and secrets.compare_digest(token.encode(), admin.encode()) and x_spotbot_tenant:
            return x_spotbot_tenant
        raise HTTPException(401, "invalid_rental_token")

    def tenant(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
        x_spotbot_tenant: Annotated[str | None, Header(pattern=r"^[A-Za-z0-9_.-]{1,100}$")] = None,
    ):
        return authenticate(credentials, x_spotbot_tenant)

    def delivery_tenant(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
        x_spotbot_tenant: Annotated[str | None, Header(pattern=r"^[A-Za-z0-9_.-]{1,100}$")] = None,
    ):
        owner = authenticate(credentials, x_spotbot_tenant, allow_gateway=True)
        return owner if isinstance(owner, DeliveryPrincipal) else DeliveryPrincipal(owner)

    def guard(fn):
        try:
            return fn()
        except LookupError as exc:
            raise HTTPException(404, "rental_not_found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    async def async_guard(fn):
        try:
            return await fn()
        except LookupError as exc:
            raise HTTPException(404, "rental_not_found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.post("")
    async def create(
        request: RentalRequest,
        owner: Annotated[str, Depends(tenant)],
        idempotency_key: Annotated[str, Header(min_length=1, max_length=200)],
    ):
        value, created = guard(lambda: engine.create(request, owner, idempotency_key))
        return {"created": created, "rental": public(value)}

    @router.get("")
    def listing(
        owner: Annotated[str, Depends(tenant)],
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        customer_ref: str | None = Query(None, max_length=200),
        upstream_order_id: str | None = Query(None, max_length=200),
    ):
        if upstream_order_id is not None and customer_ref is None:
            raise HTTPException(422, "customer_ref_required_for_order_lookup")
        page = engine.db.rental_directory.page(
            owner, customer_ref, upstream_order_id, limit=limit, offset=offset
        )
        return {"query_version": 1, "total": page["total"], "items": [public(v) for v in page["items"]]}

    @router.get("/{rental_id}")
    def get(rental_id: str, owner: Annotated[DeliveryPrincipal, Depends(delivery_tenant)]):
        return delivery_view(guard(lambda: engine.get(rental_id, owner.tenant)), owner)

    @router.get("/{rental_id}/connection")
    def connection(rental_id: str, owner: Annotated[DeliveryPrincipal, Depends(delivery_tenant)]):
        row = guard(lambda: engine.get(rental_id, owner.tenant))
        return {
            "state": row["state"],
            "generation": row["generation"],
            "connection": row["connection"],
        }

    @router.get("/{rental_id}/generations")
    def generations(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        row = guard(lambda: engine.get(rental_id, owner))
        allowed = {
            "id",
            "generation",
            "region",
            "state",
            "instance_id",
            "volumes",
            "created_at",
            "started_at",
            "ended_at",
            "verified_at",
            "error",
            "deleted_volumes",
            "deleted_volume_times",
        }
        return {
            "items": [{k: v for k, v in g.items() if k in allowed} for g in engine.generations(row)]
        }

    @router.get("/{rental_id}/ssh-keys")
    def get_ssh_keys(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        return engine.ssh_keys(guard(lambda: engine.get(rental_id, owner)))

    @router.put("/{rental_id}/ssh-keys")
    async def put_ssh_keys(
        rental_id: str, request: SshKeysRequest, owner: Annotated[str, Depends(tenant)]
    ):
        return await async_guard(lambda: engine.set_ssh_keys(rental_id, owner, request.keys))

    @router.get("/{rental_id}/task")
    def get_task(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        return engine.task(guard(lambda: engine.get(rental_id, owner)))

    @router.put("/{rental_id}/task")
    async def put_task(
        rental_id: str, request: TaskRequest, owner: Annotated[str, Depends(tenant)]
    ):
        return await async_guard(lambda: engine.set_task(rental_id, owner, request))

    @router.delete("/{rental_id}/task")
    async def delete_task(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        return await async_guard(lambda: engine.set_task(rental_id, owner, None))

    @router.post("/{rental_id}/task/stop")
    async def stop_task(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        return await async_guard(lambda: engine.stop_task(rental_id, owner))

    @router.post("/{rental_id}/release")
    async def release(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        return public(await async_guard(lambda: engine.release(rental_id, owner)))

    @router.post("/{rental_id}/recover")
    async def recover(
        rental_id: str, request: RecoveryRequest, owner: Annotated[str, Depends(tenant)]
    ):
        return public(
            await async_guard(lambda: engine.recover(rental_id, owner, request.backup_id))
        )

    @router.post("/{rental_id}/gateway-ack")
    async def ack(
        rental_id: str,
        request: GatewayAck,
        owner: Annotated[DeliveryPrincipal, Depends(delivery_tenant)],
    ):
        if owner.gateway and not request.accepted:
            # A rejection ends the rental; the gateway credential cannot release servers.
            raise HTTPException(403, "gateway_token_scope_denied")
        return delivery_view(
            await async_guard(lambda: engine.gateway_ack(rental_id, owner.tenant, request)), owner
        )

    @router.post("/{rental_id}/policy-revisions")
    async def revise(
        rental_id: str, request: RevisionRequest, owner: Annotated[str, Depends(tenant)]
    ):
        return public(await async_guard(lambda: engine.revise(rental_id, owner, request)))

    @router.post("/{rental_id}/renew")
    async def renew(
        rental_id: str, request: RevisionRequest, owner: Annotated[str, Depends(tenant)]
    ):
        return public(
            await async_guard(lambda: engine.revise(rental_id, owner, request, renewal=True))
        )

    @router.post("/{rental_id}/reconcile")
    async def reconcile(
        rental_id: str, request: Reconciliation, owner: Annotated[str, Depends(tenant)]
    ):
        return public(
            await async_guard(
                lambda: engine.reconcile(rental_id, owner, confirm_absent=request.confirm_absent)
            )
        )

    @router.post("/{rental_id}/backups")
    async def backup(
        rental_id: str,
        owner: Annotated[str, Depends(tenant)],
        idempotency_key: Annotated[str, Header(min_length=1, max_length=200)],
    ):
        async with engine.row_lock(rental_id):
            row = guard(lambda: engine.get(rental_id, owner))
            previous = engine.db.get(
                "backup", identity("manual-backup", row["id"], idempotency_key)
            )
            if previous:
                return previous
            if row["state"] != "ACTIVE":
                raise HTTPException(409, "rental_not_active")
            return guard(lambda: engine.request_backup(row, idempotency_key, manual=True))

    @router.get("/{rental_id}/backups")
    def backups(rental_id: str, owner: Annotated[str, Depends(tenant)]):
        return {"items": engine.backups(guard(lambda: engine.get(rental_id, owner)))}

    @router.post("/{rental_id}/backups/{backup_id}/reconcile")
    async def reconcile_backup(
        rental_id: str,
        backup_id: str,
        request: Reconciliation,
        owner: Annotated[str, Depends(tenant)],
    ):
        return await async_guard(
            lambda: engine.reconcile_backup(
                rental_id, owner, backup_id, confirm_absent=request.confirm_absent
            )
        )

    @router.get("/{rental_id}/events")
    def events(
        rental_id: str,
        owner: Annotated[str, Depends(tenant)],
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ):
        guard(lambda: engine.get(rental_id, owner))
        return {"items": service.store.events(order_id=rental_id, limit=limit, offset=offset)}

    app.include_router(router)

    @app.post("/v1/agents/report", tags=["Protected server guest agent"])
    async def report(request: AgentReport):
        if not config.spotbot_rentals_enabled:
            raise HTTPException(409, "rentals_disabled")
        try:
            return await engine.agent_report(request)
        except PermissionError as exc:
            raise HTTPException(401, "invalid_agent_identity") from exc
