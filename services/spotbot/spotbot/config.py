from decimal import Decimal
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", case_sensitive=False, hide_input_in_errors=True
    )

    lambda_api_key: SecretStr = SecretStr("")
    tensordock_api_key: SecretStr = SecretStr("")
    # Read-only Console pricing; this does not register a fulfillment provider.
    digitalocean_api_key: SecretStr = SecretStr("")
    spotbot_opennext_spot_markup_bps: int = Field(2000, ge=0, le=10000)
    vultr_api_key: SecretStr = SecretStr("")
    shadeform_api_key: SecretStr = SecretStr("")
    spotbot_api_key: SecretStr = SecretStr("")
    spotbot_enabled_providers: str = "lambda,vultr,shadeform"
    spotbot_live_orders_enabled: bool = False
    spotbot_dry_run_enabled: bool = True
    spotbot_aws_regions: str = "us-west-2"
    spotbot_aws_accounts: str = "{}"
    # OpenNext new purchases only; '*' aggregates all enrolled account routes.
    spotbot_opennext_aws_accounts: str = "*"
    # These settings are also used by validated, per-account provider copies.
    spotbot_aws_account_name: str = "default"
    spotbot_aws_profile: str = ""
    spotbot_aws_expected_account_id: str = ""
    spotbot_aws_instance_types: list[str] = Field(default_factory=list)
    # Extra Regions collected for price references only (no orders): current Spot, list prices
    # and history. Comma-separated; the order Regions above are always included.
    spotbot_aws_price_regions: str = ""
    # Separate, read-only current Spot reference identity; never used for rental resources.
    spotbot_aws_price_profile: str = ""
    spotbot_aws_reference_regions: str = ""
    spotbot_aws_price_region_interval_seconds: int = Field(3600, ge=600)
    spotbot_aws_vpc_id: str = ""
    spotbot_aws_security_group_ids: str = ""
    spotbot_aws_key_name: str = ""
    spotbot_aws_image_id: str = ""
    spotbot_aws_root_volume_gb: int = Field(30, ge=8, le=16384)
    spotbot_aws_public_ip: bool = True
    spotbot_aws_ssh_user: str = "ubuntu"
    spotbot_aws_capacity_backoff_seconds: int = Field(60, ge=15, le=3600)
    # AWS Price List (On-demand and Reserved). Requires pricing:GetProducts.
    spotbot_aws_list_prices_enabled: bool = True
    spotbot_aws_list_price_interval_seconds: int = Field(21600, ge=900)
    spotbot_aws_spot_history_enabled: bool = True
    spotbot_aws_spot_history_interval_seconds: int = Field(86400, ge=3600)
    spotbot_aws_list_history_enabled: bool = True
    spotbot_aws_list_history_interval_seconds: int = Field(86400, ge=3600)
    spotbot_database_path: Path = Path("data/spotbot.sqlite3")
    spotbot_storage_backend: Literal["sqlite", "mysql", "dynamodb"] = "sqlite"
    spotbot_mysql_url: SecretStr = SecretStr("")
    spotbot_dynamodb_table: str = Field("SpotOrderBot", pattern=r"^[A-Za-z0-9_.-]{3,255}$")
    spotbot_dynamodb_region: str | None = None
    spotbot_dynamodb_endpoint_url: str = ""
    spotbot_dynamodb_create_table: bool = False
    spotbot_background_enabled: bool = True
    spotbot_collect_interval_seconds: int = Field(300, ge=30)
    # Tiered retention of price collection snapshots (MySQL and SQLite; see
    # spotbot/price_retention.py): every collection for RAW days, one per provider and hour
    # up to HOURLY days, one per day up to DAILY days, none older. Off until enabled.
    spotbot_price_retention_enabled: bool = False
    spotbot_price_retention_raw_days: int = Field(3, ge=1, le=365)
    spotbot_price_retention_hourly_days: int = Field(30, ge=1, le=3650)
    spotbot_price_retention_daily_days: int = Field(90, ge=1, le=3650)
    # Collections removed per run (every ten minutes), to keep each run short.
    spotbot_price_retention_batch: int = Field(500, ge=1, le=10000)
    spotbot_worker_interval_seconds: int = Field(15, ge=12)
    spotbot_price_max_age_seconds: int = Field(600, ge=30)
    spotbot_http_timeout_seconds: int = Field(30, ge=1, le=120)
    spotbot_tensordock_vcpus: int = Field(4, ge=2)
    spotbot_tensordock_ram_gb: int = Field(8, ge=2)
    spotbot_tensordock_storage_gb: int = Field(100, ge=100, multiple_of=50)
    spotbot_gateway_webhook_url: str = ""
    spotbot_gateway_webhook_secret: SecretStr = SecretStr("")
    spotbot_rentals_enabled: bool = False
    # Empty retains the legacy order-region default; deployments should enroll
    # only Regions with validated recovery IAM, networking, and interruption queues.
    spotbot_rental_regions: str = ""
    # Region -> enrolled, account-owned encrypted base AMI used when an RFQ names none.
    # Its snapshots share lineage with rental disks, so the first capture is incremental.
    spotbot_rental_initial_images: str = "{}"
    spotbot_rental_public_url: str = ""
    spotbot_rental_tenant_tokens: SecretStr = SecretStr("{}")
    # Base64 of 32 random bytes sealing managed-task secrets (AES-256-GCM). Without it, tasks
    # without secrets still run and tasks with secrets are refused.
    spotbot_rental_task_key: SecretStr = SecretStr("")
    # Preset ID -> enabled, pinned HF revision/image digest, and validated GPU models.
    spotbot_inference_presets: str = "{}"
    # Applies only to explicitly accepted floating agreements, never historical purchases.
    spotbot_floating_enabled: bool = False
    spotbot_floating_worker_seconds: int = Field(30, ge=5, le=60)
    spotbot_floating_grant_seconds: int = Field(120, ge=60, le=300)
    # Existing OpenNEXT API that `spotbot opennext-api` forwards non-SpotOrderBot routes to.
    spotbot_opennext_legacy_origin: str = ""
    # Read-only transitional account/RFQ projection from the legacy backend's private volume.
    spotbot_opennext_legacy_data_dir: str = ""
    # Independent AES-256-GCM key for durable Console credentials; never use a cloud API key.
    spotbot_opennext_console_key: SecretStr = SecretStr("")
    # Bot API for the OpenNEXT Spot market (catalog, purchases, instances); empty disables it.
    # The adapter authenticates with SPOTBOT_API_KEY and keeps rentals in this tenant.
    spotbot_opennext_bot_url: str = ""
    spotbot_opennext_tenant: str = Field("opennext", pattern=r"^[A-Za-z0-9_.-]{1,100}$")
    # Optional gateway API for customer SSH entry points of running rentals.
    spotbot_opennext_gateway_url: str = ""
    spotbot_opennext_gateway_token: SecretStr = SecretStr("")
    # Customer order notices by email (delivered, replaced, ending soon, billed, refunded),
    # through the SMTP account the OpenNEXT API uses. Without a host, no email is sent; usage
    # is still billed. Port 465 or SECURE uses implicit TLS, otherwise STARTTLS is required
    # (plain SMTP only on loopback, for local testing).
    spotbot_opennext_smtp_host: str = ""
    spotbot_opennext_smtp_port: int = Field(587, ge=1, le=65535)
    spotbot_opennext_smtp_secure: bool = False
    spotbot_opennext_smtp_user: str = ""
    spotbot_opennext_smtp_password: SecretStr = SecretStr("")
    spotbot_opennext_smtp_from: str = ""
    # The Terminal's public origin for links in notices, e.g. https://opennext.example.
    spotbot_opennext_public_url: str = ""
    # Private directory for Buyer KYB documents (0700; files 0600), on a persistent volume.
    spotbot_opennext_files_dir: str = "data/opennext-kyb"
    # Base64 of 32 random bytes: documents are encrypted with AES-256-GCM. Without it,
    # uploads are refused. Generate with `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`.
    spotbot_opennext_files_key: SecretStr = SecretStr("")
    # ClamAV daemon (`host:port`) that scans every upload. Without it uploads are refused,
    # unless SPOTBOT_OPENNEXT_ALLOW_UNSCANNED is true (local testing only).
    spotbot_opennext_clamd: str = ""
    spotbot_opennext_allow_unscanned: bool = False
    # Days a decided case keeps its documents; unsubmitted uploads are deleted after a day.
    spotbot_opennext_kyb_retention_days: int = Field(365, ge=1, le=3650)
    spotbot_rental_gateway_token: SecretStr = SecretStr("")
    spotbot_rental_interruption_queues: str = "{}"
    spotbot_rental_worker_seconds: int = Field(5, ge=2, le=60)
    # Pools (instance type x zone) tried per acquisition attempt before waiting retry_seconds.
    spotbot_rental_pools_per_attempt: int = Field(8, ge=1, le=32)
    spotbot_rental_boot_timeout_seconds: int = Field(1200, ge=60, le=7200)
    # A handoff the gateway has not acknowledged by then needs an operator (e.g. no free port).
    spotbot_rental_delivery_timeout_seconds: int = Field(600, ge=60, le=86400)
    # Conservative budget reservation rate; not a provider invoice or published tariff.
    spotbot_rental_storage_reserve_usd_gib_month: Decimal = Field(Decimal("0.15"), gt=0)

    @property
    def rental_tenant_tokens(self):
        import json

        return json.loads(self.spotbot_rental_tenant_tokens.get_secret_value())

    @field_validator("spotbot_enabled_providers")
    @classmethod
    def valid_providers(cls, value: str) -> str:
        names = [name.strip() for name in value.split(",") if name.strip()]
        if set(names) - {"lambda", "tensordock", "vultr", "shadeform", "aws"}:
            raise ValueError("Unknown provider in SPOTBOT_ENABLED_PROVIDERS")
        return ",".join(dict.fromkeys(names))

    @property
    def aws_order_regions(self) -> list[str]:
        return list(
            dict.fromkeys(r.strip() for r in self.spotbot_aws_regions.split(",") if r.strip())
        )

    @property
    def aws_accounts(self):
        from spotbot.aws_accounts import parse_accounts

        return parse_accounts(self.spotbot_aws_accounts)

    @property
    def opennext_aws_accounts(self):
        import re

        value = self.spotbot_opennext_aws_accounts.strip()
        if value == "*":
            return None
        names = {v.strip() for v in value.split(",")}
        if not names or any(not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", v) for v in names):
            raise ValueError("OpenNext AWS accounts require '*' or explicit account aliases")
        return names

    @property
    def rental_regions(self) -> list[str]:
        value = self.spotbot_rental_regions or self.spotbot_aws_regions
        return list(dict.fromkeys(r.strip() for r in value.split(",") if r.strip()))

    @property
    def rental_initial_images(self) -> dict[str, str]:
        import json

        return json.loads(self.spotbot_rental_initial_images)

    @property
    def aws_price_regions(self) -> list[str]:
        """Every Region with price data: order Regions first, then price-only Regions."""
        extra = (r.strip() for r in self.spotbot_aws_price_regions.split(",") if r.strip())
        return list(dict.fromkeys([*self.aws_order_regions, *extra]))

    @property
    def aws_reference_regions(self) -> list[str]:
        return list(
            dict.fromkeys(
                r.strip() for r in self.spotbot_aws_reference_regions.split(",") if r.strip()
            )
        )

    def enabled(self, provider: str) -> bool:
        return provider in self.spotbot_enabled_providers.split(",")

    @model_validator(mode="after")
    def live_requires_auth(self):
        import json
        import re
        from urllib.parse import urlparse

        _ = self.aws_accounts
        _ = self.opennext_aws_accounts
        if not (
            self.spotbot_price_retention_raw_days
            <= self.spotbot_price_retention_hourly_days
            <= self.spotbot_price_retention_daily_days
        ):
            raise ValueError("Price retention days must satisfy raw <= hourly <= daily")
        from spotbot.inference import catalog

        catalog(self)

        if bool(self.spotbot_aws_price_profile.strip()) != bool(self.aws_reference_regions):
            raise ValueError("AWS price profile and reference Regions must be configured together")

        tokens = self.rental_tenant_tokens
        if (
            not isinstance(tokens, dict)
            or any(
                not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", k)
                or not isinstance(v, str)
                or len(v) < 32
                for k, v in tokens.items()
            )
            or len(set(tokens.values())) != len(tokens)
        ):
            raise ValueError("Rental tenant tokens require unique tokens of at least 32 characters")
        gateway = self.spotbot_rental_gateway_token.get_secret_value()
        if gateway and (
            len(gateway) < 32
            or gateway
            in {
                self.spotbot_api_key.get_secret_value(),
                self.spotbot_gateway_webhook_secret.get_secret_value(),
                *tokens.values(),
            }
        ):
            raise ValueError("Rental gateway token must be distinct and at least 32 characters")
        queues = json.loads(self.spotbot_rental_interruption_queues)
        images = json.loads(self.spotbot_rental_initial_images)
        if not isinstance(images, dict) or any(
            r not in self.rental_regions
            or not isinstance(v, str)
            or not re.fullmatch(r"ami-(?:[a-f0-9]{8}|[a-f0-9]{17})", v)
            for r, v in images.items()
        ):
            raise ValueError("Rental initial images must map rental Regions to AMI IDs")
        if (self.spotbot_rentals_enabled and not self.rental_regions) or set(
            self.rental_regions
        ) - set(self.aws_order_regions):
            raise ValueError("Rental Regions must be a nonempty subset of AWS order Regions")
        if not isinstance(queues, dict) or any(
            r not in self.rental_regions
            or not isinstance(u, str)
            or not u.startswith("https://sqs.")
            for r, u in queues.items()
        ):
            raise ValueError("Interruption queues must map enabled rental Regions to SQS URLs")
        if self.spotbot_rentals_enabled and set(self.rental_regions) - set(queues):
            raise ValueError("Every rental Region requires an interruption queue")
        if self.spotbot_rental_public_url:
            url = urlparse(self.spotbot_rental_public_url)
            if (
                (
                    url.scheme != "https"
                    and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1"})
                )
                or not url.hostname
                or url.username
                or url.query
                or url.fragment
            ):
                raise ValueError(
                    "Rental callback URL requires HTTPS; HTTP is only supported on loopback"
                )
        if (
            self.spotbot_storage_backend == "mysql"
            and not self.spotbot_mysql_url.get_secret_value()
        ):
            raise ValueError("MySQL storage requires SPOTBOT_MYSQL_URL")
        if self.spotbot_live_orders_enabled and not self.spotbot_api_key.get_secret_value():
            raise ValueError("Live ordering requires SPOTBOT_API_KEY")
        if (
            self.spotbot_gateway_webhook_url
            and not self.spotbot_gateway_webhook_secret.get_secret_value()
        ):
            raise ValueError("Gateway webhook requires SPOTBOT_GATEWAY_WEBHOOK_SECRET")
        if self.spotbot_tensordock_vcpus % 2:
            raise ValueError("TensorDock vCPUs must be even")
        return self

    def key(self, provider: str) -> str:
        return getattr(self, f"{provider}_api_key").get_secret_value()
