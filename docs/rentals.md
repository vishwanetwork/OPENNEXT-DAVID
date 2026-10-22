# RFQ-driven protected GPU servers

## Scope

The agent accepts an authorized structured RFQ and manages procurement, disk
backup, recovery, gateway handoff, and final release. Quote creation, checkout,
payment verification, customer invoices, and refunds remain upstream.

The current execution backend supports one AWS Linux GPU Spot VM per rental,
with encrypted EBS root and data volumes. It fails validation for other markets,
providers, or multi-server atomic allocation. The existing price collectors
and `/v1/orders` API remain available independently.

Recovery restores files and bootable server software from a complete disk set.
RAM, GPU memory, running process state, and open connections are not preserved.
Consistency is explicitly `crash_consistent`; customers can install a bounded
`/etc/spotbot/pre-backup` hook to flush their applications. The guest runs that
hook and `sync` before every initial, scheduled and manual capture, not only on
stop or recovery. The bot waits up to 30 seconds for the acknowledgement; each
backup records `consistency` as `guest_flushed`, or `crash_consistent` when the
guest did not confirm in time. Whole-disk backup does not require model
checkpoints or a separate S3 model store.

Snapshots are incremental only within one EBS lineage. Launch and restore keep
each source snapshot's KMS key, so restored disks continue the lineage. A public
AMI (such as the default Deep Learning AMI) is re-encrypted at launch, so the
first backup copies the whole root disk before delivery (about 70 minutes for
75 GiB in staging). Set `SPOTBOT_RENTAL_INITIAL_IMAGES` to an enrolled,
account-owned encrypted base per Region (see
[recovery infrastructure](aws-recovery-deployment.md#encrypted-initial-base-image));
RFQ `initial_image_ids` still override it. `rental-check --aws` warns with
`initial_image_incremental_first_backup` when the selected image cannot keep the
lineage.

## Deployment

1. Install the existing AWS optional dependencies and configure order Regions,
   the GPU key pair, network, and base Ubuntu GPU image as described in [AWS](aws.md).
2. Provision the additional IAM permissions below. The previous launch-only
   role is insufficient for protected rentals.
3. Set `SPOTBOT_RENTALS_ENABLED=true`, `SPOTBOT_LIVE_ORDERS_ENABLED=true`, the
   existing service authentication key, and `SPOTBOT_RENTAL_PUBLIC_URL` to the
   externally reachable HTTPS service base URL.
   Set `SPOTBOT_RENTAL_REGIONS` to the recovery-ready subset of AWS order Regions.
   Empty preserves the existing order-region default for compatibility. Enroll
   a Region only after its recovery IAM, network, images, and queue checks pass.
   Requests outside this list fail before procurement. Removing an enrolled
   Region also halts new acquisitions for already queued RFQs without preventing
   existing instances from being monitored and safely released. Legacy orders
   and price collection keep their own Region settings.
4. Configure `SPOTBOT_RENTAL_TENANT_TOKENS` as a JSON object mapping tenant IDs
   to unique random tokens of at least 32 characters. Keep them in the upstream
   service. A service administrator may instead use `SPOTBOT_API_KEY` with the
   `X-SpotBot-Tenant` header; tenant tokens cannot impersonate another tenant.
5. Enable the background worker. A separate rental task runs every five seconds;
   price history tasks do not own the rental lifecycle. Use one application
   worker per configured database, matching the existing store lock contract.
6. Configure the existing gateway webhook URL and signing secret, or poll the
   rental API. The outbox also carries rental lifecycle events.
7. Provision an SQS queue and DLQ for each recovery Region. Route EC2 Spot
   interruption warnings and EC2 termination/state notifications to it with
   EventBridge. Restrict the queue policy to those rules/account. Configure the
   Region-to-queue JSON in `SPOTBOT_RENTAL_INTERRUPTION_QUEUES`. Every rental
   Region requires a queue: startup fails otherwise, and a request or queued RFQ
   naming a Region without one stops before procurement with
   `interruption_queue_not_configured`. Guest IMDS polling and cloud inspection
   are fallbacks that also detect interruption/loss. `rental-check --aws` fails
   when any RFQ Region's interruption delivery or other deployment check fails;
   only a Region with no currently affordable offer is tolerated.

The guest agent has no procurement IAM role. It needs Python 3, systemd,
cloud-init, `lsblk`, `blkid`, mount tools, ext4 utilities for new data disks, and
`nvidia-smi`. The default Ubuntu GPU profile supplies the GPU environment.
Maintain the managed agent and cloud-init services when customizing the server.
An RFQ may set `initial_image_ids`, for example
`{"us-west-2":"ami-0123456789abcdef0"}`, to use a different initial image without
changing the shared catalog or other rentals. If supplied, the map must cover
every RFQ Region. Use the image's actual `ssh_user` and a sufficient root volume
size. The image must be available, architecture-compatible, Linux, EBS-backed,
and free of Marketplace product codes, and must supply the guest prerequisites.
Custom images must be public or enrolled by an administrator with both
`spotbot-managed=true` and `spotbot-initial-image=true`. The configured provider
default is already an operator-approved image. Never enroll tenant backups or
images containing customer data as shared initial images. Tenants cannot set
these enrollment tags through the rental API. A private backup is authorized
for its owning rental's recovery only, regardless of whether its AMI ID is known.
This choice is immutable after creation. Recovery always selects the rental's
owned backup image instead. The default remains the configured provider image.
Initial images cannot add EBS devices absent from the RFQ. Custom images must
also fit the requested root/data sizes; a large source image cannot silently
expand the customer's disk allocation. The configured provider default retains
its existing minimum-root-size expansion behavior.
Initial encrypted snapshots may take substantially longer than VM boot; budget
acceptance time for the full disk capture rather than assuming a fixed duration.
Guests need outbound HTTPS to the callback and access to IMDSv2. Network rules
must allow the gateway to reach SSH and any requested HTTP port.

The agent initializes only explicitly enrolled, empty, unpartitioned data disks
on first launch and mounts them under `/data/<device-name>`. It never formats
restored disks. Keep the generated `.spotbot-restore-canary` files intact: their
hashes and the previous mount layout participate in restore validation.
Instance-store scratch disks are not durable backup storage.

### Additional AWS permissions

The reviewable [regional infrastructure template](aws-recovery-deployment.md)
provides interruption delivery and optional additive policies for the existing
bot role. It does not apply changes automatically or replace launch restrictions.

Use a dedicated control-plane role and existing approved order Regions. Grant
read actions for instances, instance types, volumes, images, snapshots, zonal
Spot prices, and Service Quotas. Continue using the original scoped
`RunInstances`, `TerminateInstances`, and launch tagging permissions.

Add the appropriate actions for `ModifyInstanceAttribute`, `CreateSnapshots`,
`CreateSnapshot`, `RegisterImage`, `CopyImage`, `DeregisterImage`, `DeleteSnapshot`,
and `DeleteVolume`, plus the necessary tagging and KMS permissions for encrypted
snapshot/image operations. Include `ReceiveMessage` and `DeleteMessage` on the
configured queues. Exact IAM resources/conditions differ by action: review the
policy with the actual account, VPC, KMS keys, and recovery Regions rather than
granting broad administrator permissions. Guest instances must not inherit this
role. Image copy must be allowed in each configured destination Region.

The code verifies management/rental ownership before using or deleting private
resources. SQL deployments create a `workflow_records` table alongside the
existing event outbox. DynamoDB uses `WF#rental`, `WF#generation`, and `WF#backup`
partitions in the existing table. No additional SQLite database is used when
MySQL or DynamoDB is configured.

## API contract

Before enabling a deployment, generate a current request and run the read-only
preflight. `rental-check` does not open the application database, consume queue
messages, modify IAM, or create/delete cloud resources:

```sh
python examples/rental_request.py --ssh-key customer-key > /tmp/rental.json
spotbot rental-check --rfq /tmp/rental.json
spotbot rental-check --rfq /tmp/rental.json --aws --gateway
```

The first command checks bot settings and deadlines locally. `--aws` reads live
regional catalogs, current account quota usage, prices, the RFQ SSH key, Linux/EBS
image and VPC resource relationships. It also checks configured queue encryption,
redrive policy, account-bound EventBridge grants and enabled rule targets.
`--gateway` loads `.env.gateway` and verifies matching restricted gateway/signing credentials,
HTTP domain configuration, and a separate gateway database/table.

The JSON reports `configuration_ready` and `cloud_preflight_passed` separately;
the latter is null without `--aws`. Exit 1 means a required check failed (or the
input/configuration could not be loaded). At least one permitted Region must
pass cloud checks; individual regional failures remain visible. Inspect all
configured recovery Regions before approving cross-region failover. A pass
never guarantees capacity, mutation/KMS permissions, network reachability,
budget sufficiency over the rental lifetime, or successful guest restoration.
`live_launch_verified` and `mutation_permissions_verified` remain false. Run
this with the deployment role for representative results; a developer's AWS
account or credentials may have different permissions and quotas. Reports do
not contain configured secrets, database URLs, or raw SDK error messages.

Rental execution endpoints require a tenant execution token, or the service token
plus `X-SpotBot-Tenant`. The upstream must authorize the request before calling
this API. Tokens are not end-customer browser credentials.
The independent gateway instead uses `SPOTBOT_RENTAL_GATEWAY_TOKEN`, scoped to
delivery reads and positive acknowledgement of a known rental. A rejection
(`accepted=false`) ends the rental, so this token receives HTTP 403 for it; only
tenant or administrator credentials can reject a handoff. Its delivery response omits
RFQ commercial terms/accounting. It cannot execute procurement, recovery, backup,
policy, renewal or release commands, or list inventory. Keep this token distinct
from all execution and signing secrets.

Generate a sample with fresh UTC deadlines:

```sh
python examples/rental_request.py --ssh-key registered-key > /tmp/rental.json
```

Submit that JSON to `POST /v1/rentals` with an `Idempotency-Key` header. This is a
live procurement request when the rental and live-order flags are enabled.
The response contains `created` and `rental`, including the normalized RFQ.

Important RFQ fields:

| Field | Meaning |
|---|---|
| `rfq_id`, `rfq_version`, `upstream_order_id` | Stable upstream identity and accepted rule version |
| `gpu_model`, `gpu_count`, `min_gpu_memory_gib` | Exact GPU class/count and catalog VRAM requirement |
| `regions`, `instance_types`, `architecture` | Hard placement and machine constraints |
| `price_unit` | Must be explicitly `instance_hour` |
| `max_price_hourly`, `budget_usd` | USD per-instance compute ceiling and conservative operating budget |
| `acquisition_deadline`, `expires_at` | Absolute UTC acquisition deadline and lifecycle end |
| `not_before` | Optional earliest acquisition time |
| `root_volume_gib`, `data_disks` | Root minimum and protected data disks; root may grow to the AMI minimum |
| `selection` | `lowest_price` or `region_order` within hard constraints |
| `max_attempts`, `retry_seconds` | Lifetime cap on acquisition sweeps, and the wait after a sweep in which every pool was rejected |
| `max_recovery_seconds`, `allow_cross_region` | Recovery deadline and permitted regional image copies |
| `allow_older_backup` | Explicit permission for a potentially older recovery point |
| `backup` | Interval, completed-point count, final retention, and consistency |
| `ssh_key_name`, `ssh_user` | Already registered regional key name and image login user |
| `http_port`, `http_health_path` | Optional HTTP readiness probe; no model service is installed automatically |
| `require_gateway_ack` | Default true: gateway must acknowledge a candidate handoff |

Each acquisition attempt sweeps the eligible pools (instance type x zone), up to
`SPOTBOT_RENTAL_POOLS_PER_ATTEMPT` (default 8), starting after the pool where the
previous sweep stopped, and launches in the first that has capacity. A sweep
counts as one attempt toward `max_attempts`, however many pools it tries. An ambiguous create stops the sweep for
reconciliation, so a second server is never bought while one may exist. Within
a sweep, account quota usage and instance specifications are read once per
Region; each pool's Spot price is always refreshed. A sweep emits one
`rental.provisioning` and, if every pool is rejected, one
`rental.acquisition_failed` event.

Both initial and replacement acquisition use the same accepted rules. No
automatic on-demand conversion or cross-provider AMI restore is implemented.
AWS account quota usage and the selected zonal price are refreshed before
creation. Runtime GPU telemetry allows a two-percent device-memory reporting
margin; the catalog VRAM constraint itself is strict.

| Endpoint | Operation |
|---|---|
| `GET /v1/rentals` | List this tenant's rentals |
| `GET /v1/rentals/{id}` | Effective rules, state, generation, error, estimated cost |
| `GET /v1/rentals/{id}/connection` | Candidate/current SSH and optional HTTP endpoint |
| `GET /v1/rentals/{id}/generations` | Redacted machine and disk history |
| `POST /v1/rentals/{id}/gateway-ack` | Accept/reject `{"generation": 1, "accepted": true}` |
| `POST /v1/rentals/{id}/backups` | Manual whole-server backup; requires `Idempotency-Key` |
| `GET /v1/rentals/{id}/backups` | Recovery points, snapshots, consistency, validation timestamps |
| `POST /v1/rentals/{id}/recover` | Recover from the latest final disk state; `{}` is sufficient |
| `POST /v1/rentals/{id}/policy-revisions` | New RFQ plus `expected_version` of the accepted RFQ |
| `POST /v1/rentals/{id}/renew` | Same revision envelope, with an extended expiry |
| `POST /v1/rentals/{id}/release` | Stop the lifecycle, preserve disks, and capture final backup |
| `POST /v1/rentals/{id}/reconcile` | Resolve an uncertain creation; optionally `confirm_absent` |
| `POST /v1/rentals/{id}/backups/{backup_id}/reconcile` | Adopt tagged snapshot/image results after uncertainty |
| `GET /v1/rentals/{id}/events` | Durable lifecycle events |

Policy revisions require the same upstream identity and a greater RFQ version.
Hardware/layout/login changes require a new rental. Tightening price or
placement constraints on a live server can trigger recovery. Cancellation and
expiry override late creation results. Confirming an uncertain operation absent
is an explicit operator decision after inspecting the cloud; do not use it as a
blind retry button.

## Delivery and recovery

The default flow is `QUEUED`, `PROVISIONING`, `VERIFYING`, `DELIVERING`, then
`ACTIVE`. Before handoff, the bot verifies cloud ownership, disk preservation,
guest identity, disk presence, GPU/SSH health, and an initial complete recovery
point. A recovery also verifies canary hashes and the original mount layout.

`rental.handoff` contains the candidate connection and generation. The gateway
checks reachability, registers the candidate, and calls `gateway-ack` for that
generation. `rental.active` indicates acknowledgement. A rejection by a tenant or
administrator credential starts release. Receivers must verify the existing webhook HMAC, deduplicate event IDs,
and reject older generations/state versions. On recovering/unavailable/ending
events, revoke the prior route. `rental.degraded` and `rental.healthy` do not
change the route (see below). Use these events in the upstream notification
service to inform the customer. Notification transport itself remains upstream.
The project includes an independent [managed gateway](gateway.md) for stable
SSH/HTTP entry points. Configure its signed event receiver before submitting
rentals that require acknowledgement; the bot does not start the gateway process.
`resource_type` identifies the event's record. Only rental-record events advance
the rental `state_version`; backup events have a separate `resource_version`
and a null `state_version` and must not advance the gateway's routing watermark.

During recovery of a verified server whose guest reports `freeze_supported`,
the bot first asks the guest to run its pre-backup hook, sync, and `fsfreeze`
every protected filesystem (root last). Only after the guest confirms does it
snapshot the still-running server (`consistency=guest_frozen`); it terminates
the server as soon as the snapshots exist and never thaws it, so no write can
follow the recovery point. The replacement then starts without waiting the
roughly six minutes AWS needs to finish shutting a GPU server down; cleanup
marks the old generation stopped and releases its disks later. The guest thaws
itself only after 900 seconds, and the bot abandons the frozen snapshot unless
it terminates within 300 seconds of the confirmation, so a thaw can never follow
a snapshot that is used. Without a confirmation within 45 seconds, for older
agents, unresponsive guests, recoveries to a named older backup, a failed
capture, or a reported thaw, the bot uses the ordinary path: the old writer is
terminated after a short flush window; its EBS disks have already been
configured to survive. The final recovery point is captured from those
retained, unchanged disks. Releases always use the ordinary path. The
replacement still needs Spot quota while the old server shuts down. A replacement waits for the
complete snapshot set and boot image. Same-region recovery can use another AZ;
cross-region recovery first copies the image. Failure to obtain the final point
preserves the source disks and requires action unless older rollback was
explicitly accepted. The two-minute warning is not a restore-time guarantee.

Boot and restore validation have a deadline (`SPOTBOT_RENTAL_BOOT_TIMEOUT_SECONDS`)
only until a generation first passes verification. After that, a missing
heartbeat (none for 60 seconds) or a failed self-check (for example, `nvidia-smi`
timing out) does not prove the server stopped while the cloud still reports it
running. The rental keeps its state, generation and connection, records
`degraded` (`guest_heartbeat_lost` or `guest_check_failed`) and emits one
`rental.degraded` event. A later passing report clears it and emits
`rental.healthy`. A control-plane or callback outage therefore never replaces or
ends running servers. Interruption warnings and cloud-reported termination still
start recovery.

Snapshot and image requests that AWS rejects (for example, throttling) create
nothing and are retried automatically on the next cycle. Retryable read failures
resume the same backup stage. Only an uncertain mutation result enters
`NEEDS_RECONCILIATION`.

Cloud snapshot completion means `AVAILABLE`; it does not prove a test boot.
`restore_verified_at` is recorded only after a replacement passes validation.
If a guest is unreachable, the control plane retains disk-level recovery;
application buffers and unflushed GPU/RAM state remain outside the backup.

## Expiry, accounting, and cleanup

Expiry and explicit release revoke the connection, stop compute, capture a
final recovery point, and retain storage for the RFQ retention period. A closed
rental may still have billable retained storage. Cleanup retries cloud failures
and exposes errors instead of treating resource deletion as successful early.

Usage records and `estimated_cost_usd` are conservative operating estimates,
using the submitted compute ceiling and provisioned disk/snapshot capacity.
`SPOTBOT_RENTAL_STORAGE_RESERVE_USD_GIB_MONTH` is an operator-supplied budgeting
rate, not a live AWS tariff. Actual invoices, IPv4, transfer, taxes, and provider
minimums can differ. Upstream billing must use provider billing data for final
settlement. Snapshot retention and storage remain explicit expenses.

Run `ruff check spotbot tests examples` and `pytest -q`. The acceptance tests
simulate disk contents, multi-volume snapshots, replacement, expiry, unknown
mutations, cross-region copying, tenant isolation, and transactional outbox
rollback. AWS requests are additionally validated against botocore schemas.
Real boot, network reachability, IAM policies, and performance require a
controlled AWS integration run with an agreed spending limit.
The [staging acceptance tool](rental-acceptance.md) provides an opt-in end-to-end
run with file validation, generation switching, release and cleanup reporting.
