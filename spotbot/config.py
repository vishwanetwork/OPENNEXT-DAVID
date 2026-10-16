from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    lambda_api_key: SecretStr = SecretStr("")
    tensordock_api_key: SecretStr = SecretStr("")
    vultr_api_key: SecretStr = SecretStr("")
    shadeform_api_key: SecretStr = SecretStr("")
    spotbot_api_key: SecretStr = SecretStr("")
    spotbot_enabled_providers: str = "lambda,vultr,shadeform"
    spotbot_live_orders_enabled: bool = False
    spotbot_dry_run_enabled: bool = True
    spotbot_aws_regions: str = "us-west-2"
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
    spotbot_worker_interval_seconds: int = Field(15, ge=12)
    spotbot_price_max_age_seconds: int = Field(600, ge=30)
    spotbot_http_timeout_seconds: int = Field(30, ge=1, le=120)
    spotbot_tensordock_vcpus: int = Field(4, ge=2)
    spotbot_tensordock_ram_gb: int = Field(8, ge=2)
    spotbot_tensordock_storage_gb: int = Field(100, ge=100, multiple_of=50)
    spotbot_gateway_webhook_url: str = ""
    spotbot_gateway_webhook_secret: SecretStr = SecretStr("")

    @field_validator("spotbot_enabled_providers")
    @classmethod
    def valid_providers(cls, value: str) -> str:
        names = [name.strip() for name in value.split(",") if name.strip()]
        if set(names) - {"lambda", "tensordock", "vultr", "shadeform", "aws"}:
            raise ValueError("Unknown provider in SPOTBOT_ENABLED_PROVIDERS")
        return ",".join(dict.fromkeys(names))

    def enabled(self, provider: str) -> bool:
        return provider in self.spotbot_enabled_providers.split(",")

    @model_validator(mode="after")
    def live_requires_auth(self):
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
