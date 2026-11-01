"""Versioned retail markup policies; procurement limits and provider history are separate."""

import asyncio
import re
from decimal import ROUND_CEILING, Decimal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from spotbot.models import gpu_model, timestamp
from spotbot.storage.workflows import ConflictError

IDENTITY = "spot-retail-pricing"
KIND = "opennext_pricing"
SERVICE_FEE_BPS = 0


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    gpuModel: str | None = Field(None, max_length=80)
    region: str | None = Field(None, max_length=64)
    provider: str | None = Field(None, max_length=32)
    markupBps: StrictInt = Field(ge=0, le=10000)

    @model_validator(mode="after")
    def selectors(self):
        for field in ("gpuModel", "region", "provider"):
            value = getattr(self, field)
            if value is not None:
                value = value.strip()
                if not value or not re.fullmatch(r"[a-zA-Z0-9 ._-]+", value):
                    raise ValueError("invalid_rule_selector")
                setattr(self, field, gpu_model(value) if field == "gpuModel" else value.lower())
        if not any([self.gpuModel, self.region, self.provider]):
            raise ValueError("a_rule_requires_a_selector")
        return self


class Update(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedVersion: StrictInt = Field(ge=0)
    defaultMarkupBps: StrictInt = Field(ge=0, le=10000)
    rules: list[Rule] = Field(max_length=20)

    @model_validator(mode="after")
    def unique_rules(self):
        keys = [(r.provider, r.gpuModel, r.region) for r in self.rules]
        if len({r.id for r in self.rules}) != len(self.rules) or len(set(keys)) != len(keys):
            raise ValueError("duplicate_pricing_rule")
        return self


def snapshot(raw, policy):
    """Select the first matching override and freeze exact integer retail cents."""
    selected = None
    for rule in policy["rules"]:
        if (
            (not rule.get("provider") or rule["provider"] == raw["provider"].lower())
            and (not rule.get("region") or rule["region"] == raw["region"].lower())
            and (not rule.get("gpuModel") or rule["gpuModel"] == gpu_model(raw["gpu_model"]))
        ):
            selected = rule
            break
    bps = selected["markupBps"] if selected else policy["defaultMarkupBps"]
    source = Decimal(str(raw["price_hourly"]))
    return dict(
        policyVersion=policy["version"],
        markupBps=bps,
        ruleId=selected["id"] if selected else None,
        serviceFeeBps=SERVICE_FEE_BPS,
        sourceHourly=str(source),
        sourceCents=int((source * 100).to_integral_value(ROUND_CEILING)),
        retailCents=int((source * 100 * (10000 + bps) / 10000).to_integral_value(ROUND_CEILING)),
    )


class PricingPolicy:
    def __init__(self, db, default_markup_bps=2000):
        self.db, self.default_markup_bps = db, default_markup_bps

    async def get(self):
        doc = await asyncio.to_thread(self.db.get, KIND, IDENTITY)
        return doc or dict(
            id=IDENTITY,
            kind=KIND,
            tenant_id="operations",
            version=0,
            defaultMarkupBps=self.default_markup_bps,
            rules=[],
            changedBy=None,
            changedAt=None,
            history=[],
        )

    async def view(self, doc=None):
        doc = doc if doc is not None else await self.get()
        return {
            k: doc[k]
            for k in ["version", "defaultMarkupBps", "rules", "changedBy", "changedAt", "history"]
        } | dict(
            serviceFeeBps=SERVICE_FEE_BPS,
            procurementToleranceBps=2000,
            scope="executable_spot_offers",
        )

    async def update(self, body, actor):
        update = Update.model_validate(body)
        doc = await self.get()
        if update.expectedVersion != doc["version"]:
            raise ConflictError()
        previous = {
            k: doc[k] for k in ["version", "defaultMarkupBps", "rules", "changedBy", "changedAt"]
        }
        doc.update(
            defaultMarkupBps=update.defaultMarkupBps,
            rules=[r.model_dump() for r in update.rules],
            changedBy=actor,
            changedAt=timestamp(),
            history=[previous] + doc["history"][:9],
        )
        await asyncio.to_thread(self.db.save, doc, update.expectedVersion)
        return await self.view(doc)
