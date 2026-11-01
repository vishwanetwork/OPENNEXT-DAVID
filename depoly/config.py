"""Production-only configuration generation. Never read a testing .env or database."""

import base64
import ipaddress
import json
import os
import re
import secrets
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
SECRET_NAMES = (
    "admin_token",
    "auth_session",
    "bot_api",
    "tenant_api",
    "delivery_api",
    "gateway_api",
    "webhook",
    "http_token",
    "mysql_root",
    "bot_db",
    "gateway_db",
    "adapter_db",
    "task_key",
    "files_key",
    "console_key",
)
DATABASES = ("opennext_prod_bot", "opennext_prod_gateway", "opennext_prod_adapter")


class Invalid(ValueError):
    pass


def write_private(path, text):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise Invalid("Refusing a symlink in the private configuration directory.")
    temporary = path.with_name(path.name + ".tmp-" + secrets.token_hex(4))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def immutable(image):
    return bool(
        re.fullmatch(
            r"[a-z0-9][a-z0-9./_-]*(?::[0-9]+)?(?:/[a-z0-9._-]+)*(?:@sha256:[a-f0-9]{64}|:[a-f0-9]{40})",
            image,
        )
    )


def initialize(private, domain, web_image, state_root):
    private = Path(private)
    if private.exists() and any(private.iterdir()):
        raise Invalid("Private configuration already exists; it will not be overwritten.")
    config = json.loads((HERE / "settings.example.json").read_text())
    config["deployment_id"] = uuid.uuid4().hex
    config["project_name"] = "opennext-prod-" + config["deployment_id"][:8]
    config["state_root"], config["images"]["web"] = str(state_root), web_image
    prefixes = dict(
        site="",
        terminal="terminal.",
        admin="admin.",
        bot="spotbot.",
        gateway="gpu-gateway.",
        ssh="gpu-ssh.",
        http="gpu.",
    )
    config["domains"] = {key: prefix + domain for key, prefix in prefixes.items()}
    config["smtp"]["from"] = f"OpenNEXT <noreply@{domain}>"
    config["secrets"] = {
        name: (
            base64.b64encode(secrets.token_bytes(32)).decode()
            if name.endswith("_key")
            else secrets.token_hex(32)
        )
        for name in SECRET_NAMES
    }
    validate(config)
    private.mkdir(parents=True, mode=0o700, exist_ok=True)
    private.chmod(0o700)
    write_private(private / "settings.json", json.dumps(config, indent=2) + "\n")
    return config


def load(private):
    path = Path(private) / "settings.json"
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise Invalid("settings.json must be a private regular file (mode 600).")
    config = json.loads(path.read_text())
    validate(config)
    return config


def validate(config, *, ready=False):
    identity = config["deployment_id"]
    if (
        not re.fullmatch(r"[a-f0-9]{32}", identity)
        or config["project_name"] != "opennext-prod-" + identity[:8]
    ):
        raise Invalid("A new, matching production deployment identity is required.")
    state = config["state_root"]
    if (
        not re.fullmatch(r"/[A-Za-z0-9_./-]+", state)
        or ".." in Path(state).parts
        or state in {"/", "/opt", "/tmp", "/app", "/var", "/home"}
    ):
        raise Invalid("Choose a dedicated absolute production state directory.")
    if any(part in {"test", "testing", ".opennext-data", "legacy"} for part in Path(state).parts):
        raise Invalid("A testing/legacy data directory cannot be used for production.")
    host_pattern = r"(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}"
    domains = config["domains"]
    for host in domains.values():
        if not re.fullmatch(host_pattern, host) or any(
            x in host.split(".") for x in ("test", "localhost", "invalid")
        ):
            raise Invalid(
                "Use distinct production DNS names, without a URL, port or testing suffix."
            )
    if len(set(domains.values())) != 7:
        raise Invalid("Site, Terminal, Console, Bot, gateway, SSH and HTTP names must be distinct.")
    ports = config["ports"]
    if any(type(p) is not int or not 1024 <= p <= 65535 for p in ports.values()):
        raise Invalid("Production service ports must be integers from 1024 to 65535.")
    start, end = ports["ssh_start"], ports["ssh_end"]
    http_ports = [ports[k] for k in ("web", "bot", "gateway")]
    if (
        end < start
        or end - start > 999
        or len(set(http_ports)) != 3
        or any(start <= p <= end for p in http_ports)
    ):
        raise Invalid("Service ports and the SSH range must not overlap.")
    network = ipaddress.ip_network(config["network_cidr"])
    if network.version != 4 or not network.is_private or not 24 <= network.prefixlen <= 28:
        raise Invalid("Use a private IPv4 Docker subnet with a /24 through /28 prefix.")
    for path in config["tls"].values():
        if not re.fullmatch(r"/[A-Za-z0-9_./-]+", path) or ".." in Path(path).parts:
            raise Invalid("TLS files need safe absolute paths on the proxy host.")
    values = config["secrets"]
    if set(values) != set(SECRET_NAMES) or len(set(values.values())) != len(values):
        raise Invalid("Production secrets must be complete, unique and independently generated.")
    for name, value in values.items():
        if name.endswith("_key"):
            try:
                valid = len(base64.b64decode(value, validate=True)) == 32
            except ValueError:
                valid = False
        else:
            valid = bool(re.fullmatch(r"[a-f0-9]{64}", value))
        if not valid:
            raise Invalid("A production credential has an invalid format; no value was logged.")
    for image in (config["images"]["bot"], config["images"]["web"]):
        if image and not immutable(image):
            raise Invalid(
                "Application images must use a full Git commit tag or sha256 digest, never latest."
            )
    for enabled in config["procurement"].values():
        if type(enabled) is not bool:
            raise Invalid("Procurement switches must be JSON booleans.")
    if config["procurement"]["live_orders"] != config["procurement"]["rentals"]:
        raise Invalid("Enable or disable live orders and protected rentals together.")
    aws = config["aws"]
    if not aws["regions"] or any(
        not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", r)
        for r in aws["regions"] + aws["price_regions"]
    ):
        raise Invalid("Configure valid AWS regions.")
    for field in ("initial_images", "interruption_queues"):
        if set(aws[field]) - set(aws["regions"]):
            raise Invalid("Recovery configuration may only name enrolled order regions.")
    for region, url in aws["interruption_queues"].items():
        if (
            not re.fullmatch(
                r"https://sqs\." + re.escape(region) + r"\.amazonaws\.com/\d{12}/[A-Za-z0-9_-]+",
                url,
            )
            or "test" in url.lower()
        ):
            raise Invalid("Use dedicated production SQS queues in their matching region.")
    for ami in aws["initial_images"].values():
        if not re.fullmatch(r"ami-(?:[a-f0-9]{8}|[a-f0-9]{17})", ami):
            raise Invalid("Initial images must be reviewed, clean production AMI IDs.")
    smtp = config["smtp"]
    if (
        type(smtp["port"]) is not int
        or smtp["port"] not in {465, 587}
        or type(smtp["secure"]) is not bool
        or smtp["secure"] != (smtp["port"] == 465)
    ):
        raise Invalid("Use SMTP 465 with implicit TLS, or 587 with STARTTLS.")
    oauth = config["oauth"]
    for provider in ("google", "github"):
        if bool(oauth[provider + "_id"]) != bool(oauth[provider + "_secret"]):
            raise Invalid("OAuth client ID and secret must be configured together.")

    # Raw env_file values preserve literal $, # and quotes. Multiline values are not supported.
    def check_strings(value):
        if isinstance(value, dict):
            for item in value.values():
                check_strings(item)
        elif isinstance(value, list):
            for item in value:
                check_strings(item)
        elif isinstance(value, str) and any(ord(c) < 32 for c in value):
            raise Invalid("Configuration strings must be single-line values.")

    check_strings(config)
    if ready:
        if not config["images"]["web"]:
            raise Invalid("Set the reviewed production web image before deploying.")
        if (
            not smtp["host"]
            or smtp["host"] in {"localhost", "127.0.0.1", "mailpit"}
            or not smtp["from"]
            or not smtp["operations_to"]
        ):
            raise Invalid(
                "Configure production SMTP and operations recipients; no test mail inbox is allowed."
            )
        if not aws["access_key_id"] or not aws["secret_access_key"]:
            raise Invalid(
                "This isolated bridge deployment requires dedicated AWS credentials in the Bot only."
            )
        if config["procurement"]["live_orders"] and (
            set(aws["initial_images"]) != set(aws["regions"])
            or set(aws["interruption_queues"]) != set(aws["regions"])
        ):
            raise Invalid(
                "Live procurement requires a clean initial AMI and production interruption queue for every region."
            )


def env_text(values):
    def value(v):
        if isinstance(v, bool):
            return str(v).lower()
        if isinstance(v, (dict, list)):
            return json.dumps(v, separators=(",", ":"))
        return str(v)

    return "".join(f"{key}={value(v)}\n" for key, v in values.items())


def render(config, private, *, locked=None):
    validate(config)
    private = Path(private).resolve()
    s, d, aws, smtp = (config[k] for k in ("secrets", "domains", "aws", "smtp"))
    tenant = config["project_name"]

    def db(user, password, name):
        return f"mysql+pymysql://{user}:{s[password]}@mysql:3306/{name}?charset=utf8mb4"

    no_aws = dict(
        AWS_EC2_METADATA_DISABLED=True,
        AWS_SHARED_CREDENTIALS_FILE="/nonexistent",
        AWS_CONFIG_FILE="/nonexistent",
    )
    mysql = dict(
        MYSQL_ROOT_PASSWORD=s["mysql_root"],
        BOT_DB_PASSWORD=s["bot_db"],
        GATEWAY_DB_PASSWORD=s["gateway_db"],
        ADAPTER_DB_PASSWORD=s["adapter_db"],
    )
    bot = dict(
        **no_aws,
        PYTHONDONTWRITEBYTECODE=1,
        SPOTBOT_API_KEY=s["bot_api"],
        SPOTBOT_STORAGE_BACKEND="mysql",
        SPOTBOT_MYSQL_URL=db("onx_bot", "bot_db", DATABASES[0]),
        SPOTBOT_ENABLED_PROVIDERS=",".join(
            ["aws", *[k for k, v in config["providers"].items() if v]]
        ),
        SPOTBOT_LIVE_ORDERS_ENABLED=config["procurement"]["live_orders"],
        SPOTBOT_DRY_RUN_ENABLED=False,
        SPOTBOT_RENTALS_ENABLED=config["procurement"]["rentals"],
        SPOTBOT_BACKGROUND_ENABLED=True,
        SPOTBOT_AWS_REGIONS=",".join(aws["regions"]),
        SPOTBOT_AWS_PRICE_REGIONS=",".join(aws["price_regions"]),
        SPOTBOT_RENTAL_REGIONS=",".join(aws["regions"]),
        SPOTBOT_RENTAL_INITIAL_IMAGES=aws["initial_images"],
        SPOTBOT_RENTAL_INTERRUPTION_QUEUES=aws["interruption_queues"],
        SPOTBOT_RENTAL_PUBLIC_URL="https://" + d["bot"],
        SPOTBOT_RENTAL_TASK_KEY=s["task_key"],
        SPOTBOT_RENTAL_TENANT_TOKENS={tenant: s["tenant_api"]},
        SPOTBOT_RENTAL_GATEWAY_TOKEN=s["delivery_api"],
        SPOTBOT_GATEWAY_WEBHOOK_SECRET=s["webhook"],
        SPOTBOT_GATEWAY_WEBHOOK_URL="http://gateway:8000/v1/gateway/events",
        AWS_DEFAULT_REGION=aws["regions"][0],
        AWS_ACCESS_KEY_ID=aws["access_key_id"],
        AWS_SECRET_ACCESS_KEY=aws["secret_access_key"],
        AWS_SESSION_TOKEN=aws["session_token"],
        SPOTBOT_AWS_VPC_ID=aws["vpc_id"],
        SPOTBOT_AWS_SECURITY_GROUP_IDS=aws["security_group_ids"],
        SPOTBOT_AWS_KEY_NAME=aws["key_name"],
        LAMBDA_API_KEY=config["providers"]["lambda"],
        VULTR_API_KEY=config["providers"]["vultr"],
        SHADEFORM_API_KEY=config["providers"]["shadeform"],
    )
    gateway = dict(
        **no_aws,
        PYTHONDONTWRITEBYTECODE=1,
        SPOTBOT_GATEWAY_BOT_URL="https://" + d["bot"],
        SPOTBOT_GATEWAY_BOT_TOKEN=s["delivery_api"],
        SPOTBOT_GATEWAY_API_KEY=s["gateway_api"],
        SPOTBOT_GATEWAY_WEBHOOK_SECRET=s["webhook"],
        SPOTBOT_GATEWAY_HTTP_TOKEN_SECRET=s["http_token"],
        SPOTBOT_GATEWAY_STORAGE_BACKEND="mysql",
        SPOTBOT_GATEWAY_MYSQL_URL=db("onx_gateway", "gateway_db", DATABASES[1]),
        SPOTBOT_GATEWAY_PUBLIC_SSH_HOST=d["ssh"],
        SPOTBOT_GATEWAY_PUBLIC_HTTP_DOMAIN=d["http"],
        SPOTBOT_GATEWAY_SSH_PORT_START=config["ports"]["ssh_start"],
        SPOTBOT_GATEWAY_SSH_PORT_END=config["ports"]["ssh_end"],
        SPOTBOT_GATEWAY_ALLOWED_TARGET_CIDRS=config["gateway_target_cidrs"],
    )
    web = dict(
        SITE_HOST=d["site"],
        TERMINAL_HOST=d["terminal"],
        ADMIN_HOST=d["admin"],
        OPENNEXT_DATA_DIR="/app/.opennext-data",
        OPENNEXT_PRICING_DATA_DIR="/app/.opennext-data",
        OPENNEXT_ADMIN_TOKEN=s["admin_token"],
        OPENNEXT_AUTH_SESSION_SECRET=s["auth_session"],
        OPENNEXT_TRUST_PROXY=1,
        OPENNEXT_REFERENCE_CATALOG_ENABLED=0,
        OPENNEXT_AWS_SPOT_ENABLED=0,
        OPENNEXT_SPOTBOT_URL="https://" + d["bot"],
        OPENNEXT_SPOTBOT_API_KEY=s["bot_api"],
        OPENNEXT_CAPACITY_REGIONS=",".join(aws["price_regions"]),
        OPENNEXT_ADMIN_URL="https://" + d["admin"] + "/",
        SMTP_HOST=smtp["host"],
        SMTP_PORT=smtp["port"],
        SMTP_SECURE=int(smtp["secure"]),
        SMTP_USER=smtp["user"],
        SMTP_PASS=smtp["password"],
        SMTP_FROM=smtp["from"],
        OPENNEXT_RFQ_NOTIFY_TO=smtp["operations_to"],
        GOOGLE_CLIENT_ID=config["oauth"]["google_id"],
        GOOGLE_CLIENT_SECRET=config["oauth"]["google_secret"],
        GITHUB_CLIENT_ID=config["oauth"]["github_id"],
        GITHUB_CLIENT_SECRET=config["oauth"]["github_secret"],
        SPOTBOT_STORAGE_BACKEND="mysql",
        SPOTBOT_MYSQL_URL=db("onx_adapter", "adapter_db", DATABASES[2]),
        SPOTBOT_API_KEY=s["bot_api"],
        SPOTBOT_OPENNEXT_BOT_URL="http://bot:8000",
        SPOTBOT_OPENNEXT_TENANT=tenant,
        SPOTBOT_OPENNEXT_GATEWAY_URL="https://" + d["gateway"],
        SPOTBOT_OPENNEXT_GATEWAY_TOKEN=s["gateway_api"],
        SPOTBOT_OPENNEXT_PUBLIC_URL="https://" + d["terminal"],
        SPOTBOT_OPENNEXT_FILES_KEY=s["files_key"],
        SPOTBOT_OPENNEXT_CONSOLE_KEY=s["console_key"],
        SPOTBOT_OPENNEXT_LEGACY_DATA_DIR="/app/.opennext-data",
        SPOTBOT_OPENNEXT_SPOT_MARKUP_BPS=2000,
        SPOTBOT_OPENNEXT_SMTP_HOST=smtp["host"],
        SPOTBOT_OPENNEXT_SMTP_PORT=smtp["port"],
        SPOTBOT_OPENNEXT_SMTP_SECURE=smtp["secure"],
        SPOTBOT_OPENNEXT_SMTP_USER=smtp["user"],
        SPOTBOT_OPENNEXT_SMTP_PASSWORD=smtp["password"],
        SPOTBOT_OPENNEXT_SMTP_FROM=smtp["from"],
        SPOTBOT_AWS_REGIONS=",".join(aws["regions"]),
        SPOTBOT_RENTAL_REGIONS=",".join(aws["regions"]),
    )
    for name, values in (("mysql", mysql), ("bot", bot), ("gateway", gateway), ("web", web)):
        write_private(private / (name + ".env"), env_text(values))
    images = locked or config["images"]
    compose = dict(
        PROJECT_NAME=tenant,
        STATE_ROOT=config["state_root"],
        PRIVATE_DIR=str(private),
        WEB_IMAGE=images["web"],
        BOT_IMAGE=images["bot"],
        MYSQL_IMAGE=images["mysql"],
        NETWORK_CIDR=config["network_cidr"],
        WEB_PORT=config["ports"]["web"],
        BOT_PORT=config["ports"]["bot"],
        GATEWAY_PORT=config["ports"]["gateway"],
        SSH_START=config["ports"]["ssh_start"],
        SSH_END=config["ports"]["ssh_end"],
    )
    write_private(private / "compose.env", env_text(compose))
    replacements = {key.upper() + "_HOST": value for key, value in d.items()}
    replacements.update(
        HTTP_DOMAIN=d["http"],
        CERTIFICATE=config["tls"]["certificate"],
        PRIVATE_KEY=config["tls"]["private_key"],
        **{key.upper() + "_PORT": str(config["ports"][key]) for key in ("web", "bot", "gateway")},
    )
    nginx = (HERE / "nginx.conf.template").read_text()
    for key, value in replacements.items():
        nginx = nginx.replace("@" + key + "@", value)
    if re.search(r"@[A-Z_]+@", nginx):
        raise Invalid("An HTTPS proxy template parameter is missing.")
    write_private(private / "nginx.conf", nginx)
    unit = f"""[Unit]
Description=Block production containers from EC2 instance metadata
Before=docker.service
After=network-pre.target

[Service]
Type=oneshot
ExecStart=/usr/bin/bash {json.dumps(str(HERE / "metadata-isolation.sh"))} {json.dumps(str(private))}
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
"""
    write_private(private / "opennext-production-isolation.service", unit)
    write_private(
        private / "docker-isolation.conf",
        "[Unit]\nRequires=opennext-production-isolation.service\nAfter=opennext-production-isolation.service\n",
    )
