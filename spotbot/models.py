import hashlib
import json
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProviderName = Literal["lambda", "tensordock", "vultr", "shadeform", "aws"]
Market = Literal["spot", "on_demand"]


def utcnow() -> datetime:
    return datetime.now(UTC)


def timestamp() -> str:
    return utcnow().isoformat()


def gpu_model(text: str) -> str:
    # Keep original description separately; exact model queries match this normalized field.
    t = text.upper().replace("_", " ")
    match = re.search(
        r"\b(MI\d{3}X|[ABHV]\d{2,3}|GH\d{3}|L\d{2}S?|T4G?|P\d{2}|RTX\s*(?:A)?\d{4}(?:\s*ADA)?)\b", t
    )
    return re.sub(r"\s+", " ", match.group(1)) if match else re.sub(r"\s+", " ", t).strip()


class Offer(BaseModel):
    provider: ProviderName
    cloud: str
    sku: str
    region: str
    availability_zone: str | None = None
    market: Market
    gpu_model: str
    gpu_description: str
    gpu_count: int = Field(ge=1)
    vcpus: int = Field(ge=0)
    memory_gb: Decimal = Field(ge=0)
    storage_gb: Decimal = Field(ge=0)
    memory_unit: Literal["GB", "GiB"] = "GB"
    storage_unit: Literal["GB", "GiB"] = "GB"
    price_hourly: Decimal = Field(ge=0, allow_inf_nan=False)
    currency: Literal["USD"] = "USD"
    price_unit: Literal["instance_hour"] = "instance_hour"
    price_kind: Literal["quoted", "estimated"] = "quoted"
    available: bool
    orderable: bool = True
    source_url: str
    observed_at: str = Field(default_factory=timestamp)
    details: dict = Field(default_factory=dict)

    @property
    def offer_id(self) -> str:
        identity = [
            self.provider,
            self.cloud,
            self.sku,
            self.region,
            self.market,
            self.gpu_count,
            self.vcpus,
            str(self.memory_gb),
            str(self.storage_gb),
            self.memory_unit,
            self.storage_unit,
        ]
        if self.availability_zone:
            identity.append(self.availability_zone)
        return hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]

    def public(self, max_age: int) -> dict:
        result = self.model_dump(mode="json")
        result["offer_id"] = self.offer_id
        result["price_per_gpu_hourly"] = str(self.price_hourly / self.gpu_count)
        result["stale"] = (
            utcnow() - datetime.fromisoformat(self.observed_at)
        ).total_seconds() > max_age
        return result


class LaunchOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ssh_key_names: list[str] = Field(default_factory=list)  # Lambda
    ssh_key_id: str | None = None  # Shadeform
    sshkey_ids: list[str] = Field(default_factory=list)  # Vultr
    ssh_public_key: str | None = None  # TensorDock
    ssh_user: str | None = None
    os_id: int | None = Field(None, gt=0)  # Vultr: obtain from /v2/os
    os: str | None = None
    cloud_init: str | None = Field(None, max_length=65536)  # Lambda, Vultr, Shadeform
    tensordock_cloud_init: dict | None = None
    image_id: str | None = None  # AWS; defaults to the catalog's resolved GPU image.
    subnet_id: str | None = None  # AWS; must match the offer's Availability Zone.
    security_group_ids: list[str] = Field(default_factory=list)  # AWS
    key_name: str | None = None  # AWS
    root_volume_gb: int | None = Field(None, ge=8, le=16384)  # AWS


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offer_id: str = Field(min_length=24, max_length=24, pattern=r"^[0-9a-f]+$")
    max_price_hourly: Decimal = Field(gt=0, allow_inf_nan=False)
    dry_run: bool = False
    wait_seconds: int = Field(900, ge=1, le=86400)
    max_attempts: int = Field(20, ge=1, le=500)
    launch: LaunchOptions = Field(default_factory=LaunchOptions)
    inference_port: int | None = Field(None, ge=1, le=65535)
    inference_path: str = "/v1"

    @field_validator("inference_path")
    @classmethod
    def valid_path(cls, value):
        if not re.fullmatch(r"/[A-Za-z0-9/_-]*", value):
            raise ValueError("inference_path must be a simple absolute path")
        return value


class ReconcileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instance_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")


class SFPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pool: str = Field(min_length=1, max_length=100)
    sku: str = Field(min_length=1, max_length=100)
    image: str = Field(min_length=1, max_length=200)
    node_count: int = Field(1, ge=1, le=1000)
    duration_hours: int = Field(1, ge=1, le=168)
    max_rate_per_node_hour: Decimal = Field(gt=0, allow_inf_nan=False)
    allow_standing: bool = True
