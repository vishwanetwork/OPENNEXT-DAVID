# Single-host deployment

Use `compose.production.yaml` on a Linux host with an existing MySQL server and an HTTPS reverse proxy. The application listens on `127.0.0.1:18082`. Host networking lets the container reach host-local MySQL at `127.0.0.1:3306`; the application port must remain bound to loopback.

Create a dedicated database and user. Grant the user privileges only on the application database. When MySQL itself runs in a container with a published port, match the database user's host restriction to the source address MySQL observes after Docker forwarding.

Create a `.env` file with mode `600` in the deployment directory. Copy provider credentials securely outside Git and configure:

```dotenv
SPOTBOT_STORAGE_BACKEND=mysql
SPOTBOT_MYSQL_URL=mysql+pymysql://spotbot:URL_ENCODED_PASSWORD@127.0.0.1:3306/spot_order_bot?charset=utf8mb4
SPOTBOT_API_KEY=GENERATED_SERVICE_TOKEN
SPOTBOT_LIVE_ORDERS_ENABLED=false
SPOTBOT_ENABLED_PROVIDERS=lambda,vultr,shadeform
```

The storage adapter creates its own tables in the existing database. Switching from SQLite does not migrate historical records. Keep live ordering disabled until paid procurement has been validated and the upstream scheduler is configured.

```sh
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
```

Configure a separate reverse proxy virtual host with a certificate covering the selected domain. Redirect HTTP to HTTPS and forward HTTPS requests to `http://127.0.0.1:18082`, preserving `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`. Validate the proxy configuration before reloading it.

`/health` and `/docs` are public. All `/v1` endpoints require `Authorization: Bearer <SPOTBOT_API_KEY>`. Check public health, an unauthorized request returning HTTP 401, and authenticated catalog queries. Confirm fresh snapshots exist in MySQL and survive a service restart.

For updates, retain the old source release and image, build the new image, and recreate only the SpotOrderBot container. Never run two workers against the same database. A previous image can be restored if its storage schema remains compatible. Back up MySQL independently of container releases.

Inspect logs with `docker logs --tail 100 spot-order-bot`; Docker rotates them automatically. Do not print `.env` or connection strings into logs. Maintain DNS, certificate renewal, database backups, disk capacity, and monitoring through the host's existing operational tooling.

## Current installation

- EC2 instance: `i-0bc857258fd45966b`, `us-west-2`, public IP `44.248.155.24`.
- Public API: `https://spotbot.test.vishwalab.com`; interactive API documentation: `/docs`.
- Deployment root: `/opt/spot-order-bot`; `current` points to the active source release.
- Protected configuration: `/opt/spot-order-bot/.env`. A local `.env.production` contains the same service credentials and is excluded from Git.
- Container: `spot-order-bot`; Compose project: `spotbot`.
- MySQL database: `spot_order_bot` in the existing host's `1Panel-mysql-ej72` container. The application connects through `127.0.0.1:3306` as `spotbot`, restricted to Docker's observed source address `172.18.0.1` and this database.
- Reverse proxy configuration: `/opt/1panel/www/conf.d/spotbot.test.vishwalab.com.conf`, loaded by `1Panel-openresty-Wv3G`.
- DNS uses the existing wildcard record. HTTPS uses the existing `*.test.vishwalab.com` certificate in `/opt/1panel/www/sites/agent-cp.test.vishwalab.com/ssl/`. Keep its renewal and the proxy reload operational.

Run host maintenance commands with administrative privileges:

```sh
cd /opt/spot-order-bot/current
docker compose -p spotbot -f compose.production.yaml ps
docker compose -p spotbot -f compose.production.yaml restart spotbot
docker logs --tail 100 spot-order-bot
docker exec 1Panel-openresty-Wv3G nginx -t
docker exec 1Panel-openresty-Wv3G nginx -s reload
```

The installation collects AWS, Lambda, Vultr, and Shadeform prices automatically. TensorDock remains disabled. Live ordering is enabled and simulations are disabled. AWS uses the dedicated `SpotOrderBotEC2Role` attached to the deployment host. See [AWS integration](aws.md) for defaults, price limits, and quota behavior.

### Managed gateway and protected rentals

The managed gateway is co-located on the existing host and uses an independent
MySQL database, `spot_order_gateway`, and restricted `spotgateway` database user.
Its environment is `/opt/spot-order-bot/.env.gateway`, mode 600. The gateway uses
a delivery-only bot token, its own operator API key, and a separate webhook
signing secret. No provider credentials or operator SSH private keys are mounted.

- Gateway API: `https://gpu-gateway.test.vishwalab.com`; `/health` is public.
- Stable customer SSH host: `gpu-ssh.test.vishwalab.com`; assigned ports are
  TCP 22100–22109. Port 22001 belongs to an unrelated existing service.
- Customer HTTPS host: `r-<rental-id>.test.vishwalab.com`, using the existing
  wildcard DNS/TLS certificate. Customer requests require the rental HTTP token.
- Container: `spot-order-gateway`; Compose project `spotgateway`; HTTP binds
  only to `127.0.0.1:18084`.
- Reverse proxy: `/opt/1panel/www/conf.d/gpu-gateway.test.vishwalab.com.conf`.
- Dedicated security group: `sg-0e56b6b1929c55e9c` (`spotbot-gateway`), exposing
  only the assigned SSH port range. Existing host groups/rules were preserved.
- Credential isolation: gateway UID 10002 is blocked from IPv4/IPv6 IMDS by
  `spotbot-gateway-isolation.service`. Docker requires that unit on startup.
  Gateway IMDSv2 access was rejected while bot role credentials remained usable.

Protected rentals are enabled. The `spotbot-rental-recovery` CloudFormation
stack in `us-west-2` owns the encrypted interruption queue, dead-letter queue,
EventBridge rule, queue policies, DLQ alarm, and additive recovery IAM policy.
Cross-region image copies are disabled. `SPOTBOT_RENTAL_REGIONS=us-west-2`
enforces the recovery-ready Region boundary before paid rental procurement.
Only `us-west-2` interruption delivery is configured and checked. Existing
legacy ordering Regions and pricing collection remain independent.

The DLQ alarm has no SNS destination yet; monitor it in CloudWatch and configure
an operational destination before relying on unattended alerts. Keep the
existing wildcard certificate renewal and the persistent host/database backups
operational. See [gateway operations](gateway.md),
[recovery infrastructure](aws-recovery-deployment.md), and
[controlled acceptance](rental-acceptance.md).

The pre-upgrade MySQL dump and configuration were saved under
`/opt/spot-order-bot/backup-20261020T140706Z/`, restricted to root. Keep database
backup retention separate from GPU rental snapshot retention. Do not deploy a
second bot or gateway worker against either service's database.

### Staging validation boundary

Live validation on 2026-10-20 booted real T4 Spot servers and verified the managed
SSH endpoint, HTTP token enforcement, root/data disk capture, registered recovery
images, native EventBridge/SQS state-event delivery, and final storage cleanup.
An encrypted, administrator-enrolled Amazon Linux 2023 GPU base was tested with
a 30 GiB root disk and a 1 GiB data disk. It does not replace the shared Ubuntu
provider default. Temporary test base images are not a permanent image catalog.

The first cold Ubuntu capture exceeded the operator's 15-minute test deadline;
compute was terminated and the worker subsequently completed backup and cleanup.
Replacement T4 requests were rejected for capacity in every candidate zone.
Low-cost L4 attempts also reported insufficient capacity. Real replacement boot,
restored file checks, and restored gateway delivery remain unverified. An AWS
Spot interruption was not injected. Do not declare production recovery
acceptance complete until those cases pass with actual capacity.

Runtime test journals and independent AWS resource audits are kept outside Git.
CI continues to require Python 3.11/3.12 and real MySQL/DynamoDB Local contracts.
