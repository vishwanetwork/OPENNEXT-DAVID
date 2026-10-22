"""Strict execution rules supplied by the upstream RFQ platform."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

from spotbot.models import gpu_model


class RulesModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DiskRule(RulesModel):
    device: str = Field(pattern=r"^/dev/sd[f-p]$")
    size_gib: int = Field(ge=1, le=16384)


class BackupRule(RulesModel):
    interval_seconds: int = Field(900, ge=60, le=86400)
    keep: int = Field(3, ge=1, le=50)
    final_retention_seconds: int = Field(604800, ge=0, le=2592000)
    consistency: Literal["crash_consistent"] = "crash_consistent"


class RFQ(RulesModel):
    rfq_id: str = Field(min_length=1, max_length=100)
    rfq_version: int = Field(ge=1)
    upstream_order_id: str = Field(min_length=1, max_length=100)
    server_count: Literal[1] = 1
    providers: list[Literal["aws"]] = Field(default_factory=lambda: ["aws"], min_length=1)
    account: Literal["default"] = "default"
    regions: list[str] = Field(min_length=1, max_length=32)
    instance_types: list[str] = Field(default_factory=list, max_length=50)
    market: Literal["spot"] = "spot"
    gpu_model: str = Field(min_length=1, max_length=50)
    gpu_count: int = Field(ge=1, le=64)
    min_gpu_memory_gib: int = Field(ge=1, le=1024)
    min_vcpus: int = Field(1, ge=1)
    min_memory_gib: int = Field(1, ge=1)
    architecture: Literal["x86_64", "arm64"] = "x86_64"
    # Explicit per-rental initial images; replacements always use owned backups.
    initial_image_ids: dict[str, str] = Field(default_factory=dict, max_length=32)
    root_volume_gib: int = Field(50, ge=8, le=16384)
    data_disks: list[DiskRule] = Field(default_factory=list, max_length=16)
    currency: Literal["USD"] = "USD"
    price_unit: Literal["instance_hour"]
    max_price_hourly: Decimal = Field(gt=0)
    budget_usd: Decimal = Field(gt=0)
    not_before: AwareDatetime | None = None
    acquisition_deadline: AwareDatetime
    expires_at: AwareDatetime
    max_attempts: int = Field(50, ge=1, le=1000)
    retry_seconds: int = Field(30, ge=5, le=3600)
    max_recovery_seconds: int = Field(3600, ge=30, le=86400)
    selection: Literal["lowest_price", "region_order"] = "lowest_price"
    allow_older_backup: bool = False
    allow_cross_region: bool = False
    backup: BackupRule = Field(default_factory=BackupRule)
    ssh_key_name: str = Field(min_length=1, max_length=255)
    ssh_user: str = Field("ubuntu", pattern=r"^[a-z_][a-z0-9_-]{0,31}$")
    http_port: int | None = Field(None, ge=1, le=65535)
    http_health_path: str = Field("/health", pattern=r"^/[A-Za-z0-9/_-]*$")
    require_gateway_ack: bool = True

    @field_validator("gpu_model")
    @classmethod
    def canonical_gpu(cls, value):
        return gpu_model(value)

    @field_validator("regions")
    @classmethod
    def regions_valid(cls, value):
        import re

        if any(not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", r) for r in value):
            raise ValueError("invalid_aws_region")
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def compatible_times_and_disks(self):
        import re

        if self.initial_image_ids and (
            set(self.initial_image_ids) != set(self.regions)
            or any(not re.fullmatch(r"ami-(?:[a-f0-9]{8}|[a-f0-9]{17})", v) for v in self.initial_image_ids.values())
        ):
            raise ValueError("initial_images_must_cover_rfq_regions_with_valid_ami_ids")
        if self.acquisition_deadline >= self.expires_at:
            raise ValueError("acquisition_deadline_must_precede_expiry")
        if self.not_before and self.not_before >= self.acquisition_deadline:
            raise ValueError("start_must_precede_acquisition_deadline")
        if len({d.device for d in self.data_disks}) != len(self.data_disks):
            raise ValueError("duplicate_disk_device")
        return self


class RentalRequest(RulesModel):
    rfq: RFQ


class RevisionRequest(RulesModel):
    expected_version: int = Field(ge=1)
    rfq: RFQ


class BackupRequest(RulesModel):
    pass


class RecoveryRequest(RulesModel):
    backup_id: str | None = Field(None, pattern=r"^[a-f0-9-]{36}$")


class GatewayAck(RulesModel):
    generation: int = Field(ge=1)
    accepted: bool


class AgentReport(RulesModel):
    rental_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    generation: int = Field(ge=1)
    instance_id: str = Field(pattern=r"^i-[a-f0-9]+$")
    token: SecretStr = Field(min_length=32, max_length=200)
    gpu_model: str = Field(default="", max_length=100)
    gpu_count: int = Field(0, ge=0, le=128)
    gpu_memory_mib: int = Field(0, ge=0)
    ssh_ready: bool = False
    mounts: list[str] = Field(default_factory=list, max_length=256)
    volume_ids: list[str] = Field(default_factory=list, max_length=128)
    interruption: bool = False
    interruption_at: datetime | None = None
    flushed_command: str | None = Field(None, max_length=36)
    freeze_supported: bool = False
    frozen_command: str | None = Field(None, max_length=36)
    thawed_command: str | None = Field(None, max_length=36)
    canaries: dict[str, str] = Field(default_factory=dict, max_length=128)
