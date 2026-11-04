"""Customer-owned model quotes and service controls for the Terminal."""

import asyncio
from typing import Literal

import httpx
from fastapi import Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from spotbot.opennext_market import checkout_totals


class Quote(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    offerId: str = Field(min_length=1, max_length=200)
    inferencePresetId: str | None = Field(None, max_length=100)
    durationHours: float = Field(ge=1, le=720)


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["retry", "stop", "rotate_key"]
    expectedVersion: int = Field(ge=0)


def install(app, ctx):
    market, error, no_store = ctx.market, ctx.error, ctx.no_store

    @app.get("/api/marketplace/inference-presets")
    async def presets(offerId: str):
        try:
            async with asyncio.timeout(8):
                offer = (await market.offers(with_quota=False)).get(offerId) if market else None
                if not offer:
                    return error(404, "This offer is unavailable.")
                return no_store(await market.inference_presets(offer))
        except (httpx.HTTPError, ValueError, KeyError, TimeoutError):
            return error(
                503,
                "Model options are temporarily unavailable. You can purchase a GPU without preinstallation.",
            )

    @app.post("/api/marketplace/inference-quote")
    async def quote(request: Request):
        try:
            body = Quote.model_validate_json(await request.body())
            offer = (await market.offers(with_quota=False)).get(body.offerId) if market else None
            if not offer:
                return error(404, "This offer is unavailable.")
            offer = await market.prepare_offer(offer, body.inferencePresetId)
            return no_store(
                dict(
                    pricing=checkout_totals(offer.instance_hourly, body.durationHours),
                    modelStorageHourlyCents=offer.pricing.get("modelStorageHourlyCents", 0),
                    inferencePresetId=body.inferencePresetId,
                    modelGpuCount=(offer.pricing.get("inference") or {}).get("tensor_parallel"),
                    billingStart="gpu_delivery",
                )
            )
        except (ValidationError, ValueError, KeyError, httpx.HTTPError):
            return error(
                409,
                "This model could not be quoted for the selected server. Refresh the model options.",
            )

    async def view(rental):
        value = dict(status=rental.get("inference"), connection=None)
        if (
            value["status"]
            and value["status"].get("state") == "ready"
            and rental["state"] == "ACTIVE"
        ):
            response = await market.client.get(
                f"{market.gateway_url}/v1/gateway/rentals/{rental['id']}/connection",
                headers={
                    "Authorization": "Bearer " + market.gateway_token,
                    "X-SpotBot-Tenant": market.tenant,
                },
                timeout=5,
            )
            response.raise_for_status()
            body = response.json()
            if (
                body.get("ready")
                and body.get("http_access_token")
                and (body.get("inference") or {}).get("state") == "ready"
            ):
                value["connection"] = dict(
                    baseUrl=body["inference"]["base_url"],
                    model=body["inference"]["model"],
                    apiKey=body["http_access_token"],
                    keyVersion=body["http_key_version"],
                )
        return value

    path = "/api/marketplace/instances/{rental_id}/inference"

    @app.get(path)
    async def detail(request: Request, rental_id: str):
        _, rental, failed = await ctx.own_rental(request, rental_id, write=False)
        if failed:
            return failed
        try:
            return no_store(await view(rental))
        except (httpx.HTTPError, ValueError, KeyError):
            return no_store(dict(status=rental.get("inference"), connection=None))

    @app.post(path)
    async def action(request: Request, rental_id: str):
        _, rental, failed = await ctx.own_rental(request, rental_id, write=True)
        if failed:
            return failed
        try:
            body = Action.model_validate_json(await request.body())
            if body.action == "rotate_key":
                response = await market.client.post(
                    f"{market.gateway_url}/v1/gateway/rentals/{rental_id}/inference-key",
                    headers={
                        "Authorization": "Bearer " + market.gateway_token,
                        "X-SpotBot-Tenant": market.tenant,
                    },
                    json=dict(expected_version=body.expectedVersion),
                    timeout=5,
                )
            else:
                response = await market.bot(
                    "POST",
                    f"/v1/rentals/{rental_id}/inference",
                    json=dict(action=body.action, expected_version=body.expectedVersion),
                )
            if response.status_code == 409:
                return error(
                    409, "The model service changed. Refresh its status before trying again."
                )
            response.raise_for_status()
            # Read by the same owner helper; never derive an identity from an untrusted URL.
            _, refreshed, failed = await ctx.own_rental(request, rental_id, write=False)
            return failed if failed else no_store(await view(refreshed))
        except ValidationError:
            return error(400, "Invalid model service action.")
        except (httpx.HTTPError, ValueError, KeyError):
            return error(
                503, "The model service could not be changed. Refresh its status before retrying."
            )
