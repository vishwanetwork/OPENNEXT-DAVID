"""Strict, versioned customer authorization for floating whole-instance Spot rates."""

from decimal import Decimal
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

VERSION = "spot-hourly-v1"
RETENTION_SECONDS = 7 * 86400
MAX_CENTS = 10_000_000


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, hide_input_in_errors=True)


class QuoteRequest(Strict):
    offerId: str = Field(min_length=1, max_length=200)
    durationHours: Decimal = Field(ge=1, le=720, decimal_places=2)
    paymentMethod: Literal["Credit", "Direct Pay"]
    maxHourlyCents: StrictInt = Field(gt=0, le=MAX_CENTS)
    maxTotalCents: StrictInt = Field(gt=0, le=MAX_CENTS)
    inferencePresetId: str | None = Field(None, max_length=100)


class AcceptRequest(Strict):
    pricingVersion: Literal["spot-hourly-v1"]
    quoteId: str = Field(min_length=1, max_length=100)
    idempotencyKey: str = Field(min_length=1, max_length=100)
    consent: Literal[True]
    storageRetentionAcknowledged: Literal[True]
    inferenceBillingAcknowledged: bool = False
    sshPublicKey: str | None = Field(None, max_length=4096)

    @field_validator("consent", "storageRetentionAcknowledged", mode="before")
    @classmethod
    def explicit_boolean(cls, value):
        if value is not True:
            raise ValueError("explicit_consent_required")
        return value

    @model_validator(mode="after")
    def key_is_public(self):
        from spotbot.rental_models import valid_public_key

        if self.sshPublicKey and not valid_public_key(self.sshPublicKey):
            raise ValueError("invalid_ssh_public_key")
        return self


class ReplenishmentRequest(Strict):
    amountCents: StrictInt = Field(gt=0, le=MAX_CENTS)
    idempotencyKey: str = Field(min_length=1, max_length=100)


class ExecutionPolicy(Strict):
    pricing_version: Literal["spot-hourly-v1"] = VERSION
    purchased_seconds: StrictInt = Field(ge=3600, le=720 * 3600)
    retention_seconds: Literal[604800] = RETENTION_SECONDS
    max_retail_hourly_cents: StrictInt = Field(gt=0, le=MAX_CENTS)
    max_total_cents: StrictInt = Field(gt=0, le=MAX_CENTS)
    storage_reserve_cents: StrictInt = Field(ge=0, le=MAX_CENTS)
    grant_expires_at: AwareDatetime


class ExecutionGrant(Strict):
    idempotency_key: str = Field(min_length=1, max_length=150)
    expires_at: AwareDatetime
    action: Literal["continue", "pause", "resume"]


def storage_reserve(gib: int, monthly_rate: Decimal) -> int:
    """Conservative protected-storage reserve, in exact whole cents for seven days."""
    from decimal import ROUND_CEILING

    if gib <= 0 or not monthly_rate.is_finite() or monthly_rate <= 0:
        raise ValueError("invalid_storage_rate")
    return int(
        (Decimal(gib) * monthly_rate * RETENTION_SECONDS * 100 / Decimal(2592000))
        .to_integral_value(rounding=ROUND_CEILING)
    )
