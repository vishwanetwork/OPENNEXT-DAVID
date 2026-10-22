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
  TCP 22100–22199 (widened from 22100–22109 on 2026-10-22, in both
  `.env.gateway` and the gateway security group). Port 22001 belongs to an
  unrelated existing service. A closed rental's port is reusable after a
  seven-day quarantine, and a handoff left unacknowledged for 10 minutes moves
  to `ACTION_REQUIRED` instead of waiting in `DELIVERING`.
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

Release `a6003b6` was deployed on 2026-10-21; the gateway environment gained
`SPOTBOT_GATEWAY_HTTP_TOKEN_SECRET` (previous environment files are kept as
`.env*.before-a6003b6b4131`).

On 2026-10-22 `us-east-1` and `us-east-2` were enrolled as rental Regions.
Each has a `spotbot-rental-recovery-use1`/`-use2` stack (managed IAM policies),
a `spotbot-gpu` security group admitting only the gateway host, the `test` key
pair, and a copied base (`ami-04c76bc9122c872ef`, `ami-0099e22a9f3c26549`). The
launch policy gained the `us-east-2` resources. `rental-check --aws` passed in
both Regions, including incremental first backups and interruption delivery.
Recovery acceptance passed in `us-east-1` and `us-east-2`. An unannounced loss
in `us-east-1` (instance terminated through EC2 without telling the bot) was
detected in 2 seconds; the restored server held a file written after the last
routine backup, and delivery resumed 13m37s after the loss (6m32s of that was
the old instance shutting down). Rental estimates totalled about USD 1.23; only
the three base images remain. GPU Spot quota is 32 vCPU in `us-west-2` and 8 in
both `us-east` Regions while increases to 32 are pending.

Further live checks on 2026-10-22 (release `56169cb`): stopping the bot for
84 seconds made the gateway stop forwarding SSH once its 60-second lease
lapsed, and forwarding resumed 8 seconds after the bot restarted; the
API-requested recovery that followed took the frozen fast switch
(`guest_frozen` final backup) and restored the test files. A FIS interruption
in `us-east-2` reached the bot through that Region's EventBridge/SQS queue; its
first replacement was then reclaimed by AWS itself
(`instance-terminated-no-capacity`) about 90 seconds after launch, the bot
recovered again from the retained disks, and no further capacity appeared
within the 60-minute recovery window, so the rental moved to `ACTION_REQUIRED`
and was released and cleaned up. A rental left to reach its RFQ expiry entered
`ENDING` within 15 seconds of expiry without a release request, took a final
backup and closed with its storage deleted. Before these runs all ten original
gateway ports were consumed by closed test rentals; one run waited in
`DELIVERING` until it was released.

Release `56169cb` adds the frozen fast switch. In a second FIS run in
`us-west-2` (`g6.2xlarge`), the bot entered recovery 18 seconds after the
warning, the guest confirmed all filesystems frozen 17 seconds later, the
snapshot started 6 seconds after that and the server was terminated 9 seconds
later. The `guest_frozen` final backup was ready 2 minutes after the warning
while the old server was still shutting down, versus 7m45s on the ordinary path.
The replacement then waited about 4 minutes for capacity and was delivered 9m40s
after the warning, with the late file intact.

A real Spot interruption was injected with AWS FIS in `us-east-1` on
2026-10-22. The bot entered recovery 18 seconds after the warning (the
EventBridge/SQS queue received it), flushed and terminated the server itself
within the two-minute window, and delivered the restored replacement 12m18s
after the warning; the file written after the last routine backup survived. The
FIS role `SpotBotFisSpotInterruption` may only send interruptions to
`spotbot-managed=true` instances; each experiment template is deleted after use.
The remaining fixed cost in every recovery is about 6.5 minutes for AWS to
finish shutting down the old GPU instance before its disks can be captured.

Release `15a197a` adds the enrolled encrypted base
`ami-0f6ea1802493b4f74` (built on `t3.medium` from the 75 GiB Ubuntu Deep
Learning AMI) as `SPOTBOT_RENTAL_INITIAL_IMAGES` for `us-west-2`, guest flushes
before routine backups, pinned snapshot keys, and per-attempt pool sweeps. A
second L4 recovery acceptance passed with it: boot to guest-ready took 2m17s,
the first backup completed in 1m42s instead of about 70 minutes, and every
routine backup recorded `guest_flushed`. Recovery took 6m43s for the old Spot
server to terminate, 59s for the final backup, about 14 minutes of capacity
sweeps (eight pools per attempt), 2m17s to boot and 1m59s for the restored
baseline before delivery. The base image and its snapshot are the only retained
resources; the rental estimate was about USD 0.47.

On 2026-10-21 the controlled acceptance passed a full requested recovery on L4
(`g6.2xlarge`, us-west-2c) using the default 75 GiB Ubuntu Deep Learning AMI and
a 1 GiB data disk. The replacement needed 94 capacity attempts in total; it
restored the root and data test files with identical SHA-256, mode and owner,
kept the gateway SSH port and HTTP endpoint, and presented the original SSH host
key. Release closed the rental and deleted every managed instance, volume,
snapshot and image; no Spot request remained open. Application cost estimates
for the day's runs total about USD 2.86. The re-encrypted public AMI root took
about 70 minutes for its first full snapshot; staging used a stand-in HTTP
service on port 8000 because the AMI runs none. An AWS Spot interruption was not
injected; the recovery was requested through the bot API.

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
