"""Independent gateway configuration; never inherit the bot's database or cloud keys."""

import ipaddress
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def private_host(host):
    """Loopback, or a Kubernetes Service name, which only resolves inside the cluster."""
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(
        (".svc", ".svc.cluster.local")
    )


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SPOTBOT_GATEWAY_",
        env_file=".env.gateway",
        extra="ignore",
        hide_input_in_errors=True,
    )
    bot_url: str
    bot_token: SecretStr = Field(min_length=32)
    api_key: SecretStr = Field(min_length=32)
    webhook_secret: SecretStr = Field(min_length=32)
    # Customer HTTP tokens are derived from this key, never from operator credentials.
    http_token_secret: SecretStr = Field(min_length=32)
    public_ssh_host: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")
    public_http_domain: str = Field("", pattern=r"^$|^[a-z0-9][a-z0-9.-]{0,200}$")
    ssh_bind: str = "0.0.0.0"
    ssh_port_start: int = Field(22000, ge=1024, le=65535)
    ssh_port_end: int = Field(22999, ge=1024, le=65535)
    # A closed rental's port is reused only after this quarantine, so stale client settings
    # meet a retired listener rather than another tenant's server for a long while.
    ssh_port_reuse_after_seconds: int = Field(604800, ge=3600)
    poll_seconds: int = Field(5, ge=1, le=60)
    route_lease_seconds: int = Field(60, ge=10, le=600)
    inference_read_timeout_seconds: int = Field(600, ge=30, le=1800)
    # Public EC2 addresses by default. Private targets must be explicitly enrolled.
    allowed_target_cidrs: str = ""
    storage_backend: Literal["sqlite", "mysql", "dynamodb"] = "sqlite"
    database_path: Path = Path("data/gateway.sqlite3")
    mysql_url: SecretStr = SecretStr("")
    dynamodb_table: str = "SpotOrderGateway"
    dynamodb_region: str | None = None
    dynamodb_endpoint_url: str = ""
    dynamodb_create_table: bool = False

    @field_validator("bot_url")
    @classmethod
    def trusted_bot_url(cls, value):
        url = urlsplit(value)
        if (
            not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
            or (url.scheme != "https" and not (url.scheme == "http" and private_host(url.hostname)))
        ):
            raise ValueError("Bot URL requires HTTPS, or HTTP to loopback or a cluster Service")
        return value.rstrip("/")

    @field_validator("allowed_target_cidrs")
    @classmethod
    def valid_networks(cls, value):
        for item in value.split(","):
            if item.strip():
                ipaddress.ip_network(item.strip())
        return value

    @model_validator(mode="after")
    def deployment_contract(self):
        if self.ssh_port_end < self.ssh_port_start:
            raise ValueError("SSH port range is reversed")
        if self.route_lease_seconds < self.poll_seconds * 2:
            raise ValueError("Route lease must cover at least two polling cycles")
        if self.storage_backend == "mysql" and not self.mysql_url.get_secret_value():
            raise ValueError("Gateway MySQL storage requires its own database URL")
        if (
            len(
                {
                    self.api_key.get_secret_value(),
                    self.bot_token.get_secret_value(),
                    self.webhook_secret.get_secret_value(),
                    self.http_token_secret.get_secret_value(),
                }
            )
            != 4
        ):
            raise ValueError("Gateway API, bot, webhook, and HTTP token secrets must be distinct")
        return self

    def target_allowed(self, host):
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return False  # No DNS resolution or caller-controlled hostnames.
        networks = [
            ipaddress.ip_network(n.strip())
            for n in self.allowed_target_cidrs.split(",")
            if n.strip()
        ]
        if networks:
            return any(address in network for network in networks)
        return address.is_global and not address.is_multicast

    def storage_settings(self):
        from types import SimpleNamespace

        # Do not load the bot's environment a second time, even when co-located.
        return SimpleNamespace(
            spotbot_storage_backend=self.storage_backend,
            spotbot_database_path=self.database_path,
            spotbot_mysql_url=self.mysql_url,
            spotbot_dynamodb_table=self.dynamodb_table,
            spotbot_dynamodb_region=self.dynamodb_region,
            spotbot_dynamodb_endpoint_url=self.dynamodb_endpoint_url,
            spotbot_dynamodb_create_table=self.dynamodb_create_table,
        )
