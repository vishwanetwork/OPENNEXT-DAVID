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

PUBLIC_KEY_TYPES = {
    "ssh-ed25519",
    "ssh-rsa",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
    "sk-ssh-ed25519@openssh.com",
    "sk-ecdsa-sha2-nistp256@openssh.com",
}


def valid_public_key(value):
    """One OpenSSH public key line whose encoded blob names the same key type."""
    import base64
    import re
    import struct

    match = re.fullmatch(r"(\S+) ([A-Za-z0-9+/]+={0,3})(?: [ -~]{0,200})?", value.strip())
    if not match or match.group(1) not in PUBLIC_KEY_TYPES:
        return False
    try:
        blob = base64.b64decode(match.group(2), validate=True)
        (length,) = struct.unpack(">I", blob[:4])
        return blob[4 : 4 + length].decode() == match.group(1)
    except (ValueError, struct.error, UnicodeDecodeError):
        return False


class RulesModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DiskRule(RulesModel):
    device: str = Field(pattern=r"^/dev/sd[f-p]$")
    size_gib: int = Field(ge=1, le=16384)


def gpu_memory_sufficient(mib, minimum):
    """Compare reported GPU memory (MiB, as clouds and drivers report it) with an RFQ minimum.

    The RFQ states the GPU's nominal size as marketed, in decimal gigabytes: a "24 GB" L4 is
    reported as 22888 MiB by AWS, an "80 GB" H100 as 81559 MiB by nvidia-smi. Comparing
    against GiB would never match such a GPU, so allow 2% below the decimal size.
    """
    return mib >= minimum * 1e9 / 2**20 * 0.98


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
    # Nominal per-GPU memory in GB as marketed (see gpu_memory_sufficient); name kept for API.
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
    # An EC2 key pair registered in every RFQ Region, a customer public key installed for
    # ssh_user at boot, both, or neither: keys can be set later (`PUT .../ssh-keys`).
    ssh_key_name: str | None = Field(None, min_length=1, max_length=255)
    ssh_public_key: str | None = Field(None, max_length=4096)
    ssh_user: str = Field("ubuntu", pattern=r"^[a-z_][a-z0-9_-]{0,31}$")
    # Opaque upstream customer reference, so an upstream can list one customer's rentals.
    customer_ref: str | None = Field(None, min_length=1, max_length=200)
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

    @field_validator("ssh_public_key")
    @classmethod
    def openssh_public_key(cls, value):
        if value is None:
            return value
        if not valid_public_key(value):
            raise ValueError("ssh_public_key_must_be_one_openssh_public_key")
        return value.strip()

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


class SshKeysRequest(RulesModel):
    """Customer public keys the guest agent keeps in ssh_user's authorized_keys."""

    keys: list[str] = Field(max_length=20)

    @field_validator("keys")
    @classmethod
    def public_keys(cls, values):
        keys = [v.strip() for v in values]
        if any(len(k) > 4096 or not valid_public_key(k) for k in keys):
            raise ValueError("invalid_ssh_public_key")
        return list(dict.fromkeys(keys))


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
    # Version of the managed customer key set the agent last installed.
    ssh_keys_version: int | None = Field(None, ge=0)
