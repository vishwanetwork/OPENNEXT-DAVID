# OpenNEXT production deployment

The directory name `depoly` is intentional. This package prepares a **new production
installation**, not a promotion of the testing database. It does not copy testing accounts,
sessions, Credit, orders, KYB files, provider credentials, gateway routes or cloud backups.
All operator output and documentation are English. No command runs until an operator invokes it.

## Images and data are separate

The same reviewed application image can run in testing and production with different runtime
configuration and storage. An image does not need to contain customer data. However, an old
`latest` image may not contain the Console account/review and paid-purchase functionality.

- The Bot/gateway source image is pinned to
  `ghcr.io/vishwanetwork/spot-order-bot:414707340ba9a59fd06fa312cee9e8f8d6e3e3f5`.
- Select a reviewed web image by full Git SHA or digest. It must include the new frontend and
  the adapter built using `SPOTBOT_SOURCE=image`. `lock-images` checks the adapter imports,
  Unicode PDF generation and frontend account/paid-purchase code before accepting it.
- Existing compatible images can be reused directly. Otherwise build from the approved
  checkout using the build-only command below. The existing GitHub `deploy.yml` workflow also
  upgrades a 1Panel container; **do not invoke that workflow merely to build a production image**.
- Before deployment, all three images, including MySQL, are resolved to digests in a private
  lock file. Subsequent starts use those digests, not changing registry tags.

The web image contains the Next.js application, legacy account API, Python adapter and ClamAV.
The same Bot image also runs the independent core Bot and gateway processes. These are three
application containers with separate database ownership, not three copies sharing one worker DB.

## Supported layout

Use a Linux x86-64 Docker host with Python 3.11+, Docker Compose 2.30+ and an HTTPS reverse proxy
running in the host network namespace. Use a dedicated production host or review subnet, port,
firewall and resource conflicts before sharing a host. Plan sufficient RAM for MySQL, Next.js,
Python and the ClamAV signature database; an otherwise idle 8 GiB host is a useful starting
point, then measure actual load. No GPU is needed on the control-plane host.

| Service       | Persistent data                                 | Default host listener                        |
| ------------- | ----------------------------------------------- | -------------------------------------------- |
| Web + adapter | New account directory + `opennext_prod_adapter` | `127.0.0.1:24188`                            |
| Core Bot      | `opennext_prod_bot`                             | `127.0.0.1:28082`                            |
| Gateway       | `opennext_prod_gateway`                         | API `127.0.0.1:28084`; SSH TCP `23100-23199` |
| MySQL 8.4     | New local production MySQL directory            | No published port                            |

The application uses a private Docker bridge. Database users have access only to their own
schema. All generated secrets are unrelated to testing secrets. The gateway has only its
delivery-scoped Bot token, never procurement credentials. Only the core Bot receives cloud
provider keys. The web adapter receives its trusted Bot control-plane credential; it does
not receive AWS provider keys. Keep one instance of each writer; do not scale replicas.

This package uses explicit, dedicated production AWS credentials or rotated STS credentials,
with instance metadata blocked for the entire bridge. It does not grant the gateway access
to the host's IAM role. Instance-role-only procurement requires a separately reviewed network/
credential layout; it is not enabled by simply omitting credentials here.

## Files

| File                                                       | Purpose                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `settings.example.json`                                    | Non-secret configuration schema and defaults                             |
| `production.py`, `config.py`, `operations.py`, `checks.py` | Initialize, validate, render, lock, start, check, back up and roll back  |
| `compose.yaml`                                             | Separate production services and persistent mounts                       |
| `bootstrap-empty.cjs`                                      | Create empty account/marketplace/Credit records; refuse existing records |
| `mysql-init.sh`                                            | Create three empty schemas and restricted users on a fresh MySQL volume  |
| `build-image.sh`                                           | Build the bundled image without triggering 1Panel deployment             |
| `nginx.conf.template`                                      | HTTPS routing for the sites, Bot, gateway and customer HTTP endpoints    |
| `metadata-isolation.sh`                                    | Deny the production bridge access to IPv4 EC2 metadata; IPv6 is disabled |
| `clamd.conf`                                               | Scan complete KYB packages, not only individual uploads                  |
| `rental-check.sh`                                          | Read-only AWS readiness check using a supplied RFQ                       |
| `aws/prepare-recovery.sh`                                  | Prepare a reviewable regional recovery change set without executing it   |
| `aws/recovery-template.json`                               | Recovery template copied from the matching Bot source repository         |

`private/`, `state/` and `backups/` are ignored by Git and excluded from the Docker build
context. Generated env files use Compose's raw format so literal `$`, `#` and quotes in SMTP
credentials survive parsing. The authoritative configuration is `private/settings.json`;
edit that file, not the generated service env files. Never print or attach these private files.
The Console login token is `secrets.admin_token`; retrieve it privately from that file.

## 1. Select the release and generate fresh configuration

Run from the approved repository checkout on the production host. Use a stable checkout path,
for example `/opt/opennext-code/OPENNEXT-DAVID`. Run installation/maintenance as root so the
private directories and service UID ownership can be created. On a build machine, only the
build commands require Docker; they do not start the application.

```sh
sudo -i
cd /opt/opennext-code/OPENNEXT-DAVID
PRODUCTION_WEB_IMAGE="ghcr.io/vishwanetwork/opennext-homepage:$(git rev-parse HEAD)"
python3 depoly/production.py init \
  --domain opennextlab.ai \
  --state-root /opt/opennext-production \
  --web-image "$PRODUCTION_WEB_IMAGE"
```

`init` generates a new deployment ID, project name, database passwords, auth signing secret,
Bot/gateway credentials and three independent encryption keys. It reads only the committed
template and refuses an existing private configuration. No account or database is read.

Edit `depoly/private/settings.json` with a private editor. At minimum supply:

- `images.web`: the approved full-SHA web image (or an existing verified digest).
- `domains` and `tls`: production DNS names and certificate paths as seen by the host proxy.
- `smtp`: a real service on 587/STARTTLS or 465/implicit TLS, sender, credentials and operations
  recipients. A Mailpit/localhost test inbox is not accepted for production readiness.
- `aws.access_key_id`, `secret_access_key` and optional `session_token`: independently scoped
  production credentials. Do not paste testing env files or mount `~/.aws` into every service.
- `aws.regions`: regions approved for procurement; `price_regions` may be broader.
  The default is one procurement region. Set that region's explicit `vpc_id` and
  `security_group_ids`, or provision the documented production default-VPC/`spotbot-gpu`
  discovery resources. A single global VPC/security-group ID cannot be reused across regions.
- `providers`: optional production Lambda, Vultr and Shadeform keys. Additional Console feeds
  can be configured after launch through the encrypted Price Source configuration.
- Optional paired Google/GitHub OAuth credentials. Register each callback at
  `https://terminal.YOUR_DOMAIN/api/auth/oauth/google/callback` or `/github/callback`.

Leave `procurement.live_orders` and `procurement.rentals` false initially. Simulation is also
disabled. This starts a pricing/operator setup environment, not an environment that buys GPUs.

If a compatible web image already exists, skip building. Otherwise:

```sh
docker login ghcr.io
bash depoly/build-image.sh --push
```

The build target must use the checked-out full Git SHA. Application source must be clean.
The script bundles the pinned adapter, supplies the production hostnames and records release
labels. It pushes a release image but does not upgrade any running container.

```sh
python3 depoly/production.py render
python3 depoly/production.py lock-images
python3 depoly/production.py check
```

`lock-images` needs a running Docker daemon and registry access. It runs feature probes without
network, data mounts or application startup. A plain/old web image is rejected. `check` validates
the private lock and Compose syntax without exposing the rendered configuration.

## 2. DNS, HTTPS and firewall

Point the site, Terminal, Console, Bot, gateway, SSH name and `*.gpu.YOUR_DOMAIN` at the
production host. Issue a certificate covering all HTTPS names, including the customer HTTP
wildcard; `*.YOUR_DOMAIN` alone does not cover `r-ID.gpu.YOUR_DOMAIN`. DNS challenge is normally
needed for a wildcard. Certificate provisioning and DNS changes remain explicit operator work.

Install the generated `depoly/private/nginx.conf` through the existing host proxy/1Panel.
Replace certificate paths in settings and render again if necessary. Validate with `nginx -t`
before reloading; for containerized 1Panel OpenResty, use its equivalent `docker exec` command.
The template assumes the proxy can access host loopback, not a separate bridge's loopback.
Preserve the generated Host/forwarding headers: application origin and administrator checks
depend on them. Keep customer traffic in maintenance mode until the empty-install check passes.

Open HTTPS/HTTP on 443/80 and the configured customer SSH port range in the host/cloud firewall.
Restrict operator access to the Console and administration SSH using the existing access policy.
Do not open 3306 or the three loopback application ports. GPU instance security groups must
permit SSH/application traffic only from the gateway's actual egress address or approved private
network. The package does not modify existing AWS security groups.
SSH stays encrypted end to end. Customer HTTP forwarding currently uses HTTP between gateway
and VM; enable it only with a suitable private network or protected tunnel for that segment.

Install the production-only metadata rule and its boot dependency. This adds a subnet-specific
deny rule and keeps existing Docker unit dependencies/rules. It does not restart Docker:

```sh
bash depoly/metadata-isolation.sh
install -m 644 depoly/private/opennext-production-isolation.service /etc/systemd/system/
mkdir -p /etc/systemd/system/docker.service.d
install -m 644 depoly/private/docker-isolation.conf \
  /etc/systemd/system/docker.service.d/20-opennext-production.conf
systemctl daemon-reload
systemctl enable --now opennext-production-isolation.service
```

The service creates the DOCKER-USER chain/rule before Docker starts on future boots. Keep the
checkout/private config at the stable path embedded in the generated unit. On Docker installations
using a different firewall backend, implement and review an equivalent metadata deny policy
before deploying; do not bypass the check. Also inspect VPC routes and existing Docker subnets.

## 3. Prepare empty storage, start and verify

```sh
python3 depoly/production.py prepare
python3 depoly/production.py up
python3 depoly/production.py status
python3 depoly/production.py smoke --expect-empty
```

`prepare` creates a dedicated state root, new local MySQL service, three schemas and empty
auth/marketplace/Credit JSON files. It refuses a foreign/nonempty customer directory and checks
that the production schemas have no application tables. It never drops an existing database.
The marker binds storage to this installation. On later upgrades use `up`, not `prepare`.

`up` checks the locked images, deployment marker and metadata denial, then starts the services.
The gateway health check requires production Bot DNS/TLS to work. ClamAV may need time to fetch
signatures on the first launch; repeat `smoke` once it is ready. Upload/export scanning fails
closed while definitions are unavailable.

`smoke --expect-empty` checks HTTPS, unsigned API rejection, operator capabilities, an anonymous
session and zero accounts, payments, KYB cases, Credit charges and rentals. It obtains an operator
session but never confirms payment, sends mail or purchases a GPU. After real registrations,
run `smoke` without the empty assertion. Verify real email delivery using a deliberately created
production staff account after this gate, then complete normal KYB. No local KYB bypass is present.

The existing product signup policy grants new Buyers welcome promotional Credit. Those new
grants are product behavior; the installation starts without any existing users or balances.
Public price history is recollected/backfilled from providers instead of importing a testing DB.

## 4. Enable real procurement after AWS readiness

Production AWS prerequisites are a dedicated restricted role/user with launch/release and
recovery permissions, sufficient GPU Spot quotas, approved networking/key pair, clean encrypted
base AMIs and new regional interruption queues. Use production queues; never let this Bot
consume a testing queue. Do not enroll a customer/test server snapshot as a shared factory image.

The bundled CloudFormation template adds regional recovery/queue permissions to an existing
role; it does not create that role, grant its initial launch policy, create networking or enroll an
AMI. It creates no GPU. To prepare a change set for review without executing it:

```sh
bash depoly/aws/prepare-recovery.sh PRODUCTION_AWS_PROFILE us-west-2 ProductionSpotBotRole
```

Review and execute the change set separately in the correct AWS account. Read its
`InterruptionQueueUrl` output. Fill `aws.initial_images` and `aws.interruption_queues` for every
enrolled region in settings. Quota is account-wide, and a valid quota/price preflight does not
guarantee Spot stock. See the matching Bot repository's `docs/aws.md` and
`docs/aws-recovery-deployment.md` for launch permissions and clean AMI preparation.

With procurement still disabled in the running service, render and recreate the Bot with the
new recovery settings, then run the read-only RFQ check:

```sh
python3 depoly/production.py render
python3 depoly/production.py up
bash depoly/rental-check.sh /absolute/path/to/reviewed-production-rfq.json
```

That command enables the flags only in its inspection process; it never submits an RFQ. It
checks AWS configuration using the supplied intended GPU/region/budget rules. Gateway HTTPS,
DNS and the customer network path still need the separate live delivery/recovery acceptance.
Start with `depoly/aws/rfq-preflight.example.json` and adjust the GPU, region and price limits
to the intended production offer. Only `AUTO` deadline values are replaced with future UTC
times for inspection; explicit RFQ terms are preserved. The example is never submitted as an order.

After those checks, set both procurement switches to true, run `up` and `smoke`, and perform
a deliberately budgeted first real purchase/recovery/release acceptance. This is a paid operator
action, not part of `prepare` or `smoke`. Direct Pay continues through provider preflight,
owner-bound paid redemption and the existing Agent. Failure releases the full receipt to Credit;
the original retail quote stays locked. New Spot retail markup defaults to 20%, followed by the
existing 5% usage/checkout service fee. Existing running orders keep their accepted terms.

## Maintenance, backup and rollback

```sh
python3 depoly/production.py status
python3 depoly/production.py logs
python3 depoly/production.py backup --recipient age1YOUR_PRODUCTION_BACKUP_PUBLIC_KEY
```

Install `age` first and retain its private decryption identity outside this host. Backup pauses
the three writers/gateway during a maintenance window, dumps only the three production schemas,
archives account/KYB data plus the production configuration/encryption keys, encrypts the archive,
then restarts the previously running services even if the attempt fails. ClamAV definitions are
excluded and can be downloaded again. Keep the resulting `.tar.age` off-host in production backup
storage with an explicit retention policy. Temporary plaintext files are private and removed.

Stopping a control plane does not terminate billable GPU instances; keep maintenance short and
monitor active rentals and interruptions. Back up before changing releases. Edit image references
in settings, lock images, then `up`. Do not replace production state or rotate encryption keys
as part of a release update. Do not run `docker compose down -v`.

For a reviewed, schema-compatible image rollback:

```sh
python3 depoly/production.py rollback \
  --web-image ghcr.io/vishwanetwork/opennext-homepage@sha256:PREVIOUS_VERIFIED_DIGEST \
  --bot-image ghcr.io/vishwanetwork/spot-order-bot@sha256:PREVIOUS_VERIFIED_DIGEST
```

Rollback preserves production data. A previous image must still satisfy the capability probes;
this is not a way to downgrade to an incompatible adapter. Database disaster recovery is a
separate operation: stop writers (`production.py stop`), decrypt a production backup into a
private directory, verify its manifest deployment ID and hashes/contents, and restore only this
installation's three schemas and data mounts with their matching keys. Reconcile cloud instances,
payment receipts and external side effects before resuming. Never restore testing data into this
installation. There is deliberately no generic import/reset/delete command.

## Validation and limits

```sh
python3 -m unittest discover -s depoly/tests -v
bash -n depoly/build-image.sh depoly/metadata-isolation.sh depoly/rental-check.sh depoly/aws/prepare-recovery.sh
sh -n depoly/mysql-init.sh
```

Tests generate isolated temporary configuration and empty fixtures, check no-overwrite behavior,
credential separation, raw-env rendering, private file modes, immutable releases and actual Compose
syntax. They do not use existing `.env`, cloud keys, SMTP accounts or customer data. Full container
boot and live cloud restoration require a running Docker daemon and production infrastructure;
syntax/unit tests alone do not establish that readiness.

The only persistent state migrated across production updates is this production installation's
own state. This package does not provide multi-host replication, automated bank reconciliation,
automatic TLS issuance, customer bank enrollment, cloud resource creation or a testing-data import.
New databases do not cancel existing testing rentals: leave their original controller responsible
for them until they have been explicitly retired.

Raw env-file behavior follows the [Docker Compose service reference](https://docs.docker.com/reference/compose-file/services/#env_file).
