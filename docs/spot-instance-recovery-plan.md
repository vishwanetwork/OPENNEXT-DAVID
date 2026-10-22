# GPU Server Procurement, Backup, and Recovery Plan

Status: The AWS protected rental API and managed gateway in section 8A are
deployed on the existing staging host. Live checks verified GPU boot, fixed SSH
and authenticated HTTP delivery, complete disk-set snapshot/image creation,
native state-event delivery, and resource cleanup. On 2026-10-21 a requested
whole-server recovery passed live acceptance on L4 Spot capacity: the replacement
restored root and data files with identical hashes, modes and owners behind the
same gateway SSH/HTTP endpoints and SSH host key. On 2026-10-22 an unannounced
instance loss and a real Spot interruption injected with AWS FIS also passed in
`us-east-1`, each restoring a file written after the last routine backup. Do not treat unit tests or a successful snapshot as
proof of a restored GPU server. See `rentals.md`, `gateway.md`, and
`deployment.md` for the current capabilities, limits, and deployment state.
Date: 2026-10-20
Code baseline reviewed: `70f308c`.

## 1. Goal and service contract

Complete the workflow starting at the procurement agent: accept an authorized
execution request containing RFQ rules, procure capacity, deliver the server,
monitor it, handle interruptions, back up the whole server, procure a
replacement, restore it, update connections, and release resources at expiry.

RFQ authoring, quoting, customer checkout, payment verification, refunds, and
commercial settlement belong to the upstream platform and are outside this
implementation. The agent consumes the authorized RFQ as an execution contract
and returns lifecycle, usage, failure, and connection events to that platform.

The product delivers a GPU server with SSH access and optional HTTP gateway
access. Customer applications are not required to implement model checkpoints
for disk-level server recovery. Recovery includes the operating system,
installed software, and files stored on all enrolled persistent disks at the
selected recovery point. Model files can remain on those disks and are included
in the backup. A separate model store in S3 is optional.

Recovery boots a new server. Running processes, RAM, GPU memory, live TCP
connections, and application state that has not reached persistent disk are
outside this contract. Customer-configured boot services can restart; arbitrary
interactive programs do not automatically continue from their previous
instruction. Application-consistent recovery requires optional application
quiesce hooks. Without these hooks, label the backup as crash-consistent.

Downtime is acceptable. Do not promise a replacement within two minutes or
zero data loss for arbitrary customer applications. Report the selected recovery
point, its consistency level, actual data gap, and elapsed recovery time.

The first complete implementation targets AWS EC2 Linux GPU Spot instances with
EBS-backed root and data volumes. Multi-cloud procurement and pricing remain
supported independently. Other providers become eligible for this recovery
product only after their snapshot, persistence, image restore, and interruption
capabilities pass the same tests. An AWS AMI is not a portable multi-cloud
server backup.

## 2. Current implementation and required changes

| Area | Current baseline | Required addition |
|---|---|---|
| Pricing | Provider catalogs and price history | Candidate selection within an order's placement policy |
| Procurement | One offer and one VM per order; retries and price check | A durable rental spanning multiple acquisition attempts and VM generations |
| AWS creation | Deterministic client token; configured catalog image | Verified restore-image selection, full disk mappings, persistent protected volumes |
| Root disk | `DeleteOnTermination=true` in the AWS launch plan | `false` for every enrolled root/data volume, checked before delivery |
| Readiness | Provider reports active instance and IP | OS, SSH, disk, GPU, and optional HTTP readiness gates |
| Interruption | Polling detects preempted/lost instances | Event ingestion, guest warning detection, backup and replacement workflow |
| Recovery | Scheduler receives an event; no automatic replacement | Durable recovery coordinator and backup service |
| Gateway | Handoff metadata and signed event outbox | Gateway acknowledgement, generation-aware update, customer notification |
| Lifetime | Explicit release API; acquisition deadline only | Rental expiry, cancellation, final backup, and resource garbage collection |
| Authorization | Shared service authentication | Trusted tenant identity and tenant-scoped resource access |
| Persistence | SQLite, MySQL, DynamoDB | Portable records for rentals, generations, backups, operations, and usage |

Do not treat the current `wait_seconds` acquisition deadline as a server expiry
timer. Preserve existing API behavior and introduce the rental workflow through
additive endpoints.

## 3. Components and ownership

- **Upstream platform (external):** supplies authenticated execution commands,
  customer/business identity, versioned RFQ rules, renewals, and cancellations;
  consumes lifecycle events and presents customer notifications.
- **Bot control plane:** rental policy, budget checks, acquisition attempts,
  lifetime enforcement, recovery coordination, and durable event delivery.
- **Provider adapters:** query eligibility, create/inspect/release resources,
  inventory disks, preserve disks, snapshot, copy images, and restore.
- **Backup worker:** capture complete recovery points, validate snapshot sets,
  register restore images, maintain manifests, and enforce retention.
- **Interruption consumer:** AWS EventBridge to SQS, with duplicate-safe event
  processing and a dead-letter queue; provider polling is the fallback.
- **Guest agent:** heartbeat, IMDSv2 interruption checks, disk inventory,
  bounded quiesce hooks, readiness reports, and restore bootstrap.
- **Gateway:** stable logical server identity, SSH proxy or direct connection
  metadata, optional HTTP routing, and acknowledgement of endpoint changes.
- **Storage:** MySQL in the existing deployment, encrypted EBS volumes and
  snapshots, optional S3 for manifests and model artifacts.

The control plane, database, gateway, and recovery workers run independently of
the customer's Spot server. Loss of that server must not stop recovery.

Use the existing native AWS adapter for the initial recovery implementation.
SkyPilot may later implement a provisioning backend, but each rental must have
exactly one lifecycle owner. Two controllers must never independently create
replacement machines for the same interruption.

Long-running snapshot, copy, and bootstrap operations are asynchronous jobs.
They must not block price collection, interruption ingestion, or expiry checks.
Keep the initial worker topology simple, while persisting progress and using
conditional state changes so a restart can safely resume work.

## 4. RFQ execution contract and initial delivery

### Input boundary

The upstream platform calls `POST /v1/rentals` with an authenticated execution
request and a business idempotency key. It supplies a structured RFQ or an RFQ
ID/version that the agent resolves through a configured, authenticated upstream
interface. An RFQ ID alone is insufficient when its rules cannot be retrieved.
The agent does not accept arbitrary caller-supplied URLs for RFQ retrieval.

Validate the contract before creating any cloud resource. Persist the original
RFQ reference, version, normalized rules, and content hash. A repeated request
with the same key and content returns the same rental; a changed request with
the same key is a conflict. RFQ identity does not replace caller authorization.

### Required rule groups

| Rule group | Required meaning |
|---|---|
| Identity | Upstream order ID, RFQ ID/version, tenant, execution request ID |
| Hardware | GPU model/count/VRAM, CPU architecture, minimum CPU/RAM, protected root/data disks |
| Initial image | Optional per-Region initial AMIs, public or explicitly enrolled clean factory images; private tenant backups are never shared initial images |
| Quantity | Server count, GPUs per server, and any co-location/network constraints; reject unsupported multi-server requests |
| Placement | Allowed providers/accounts/regions, allowed markets, residency restrictions |
| Price and spend | Currency, price unit, per-instance hourly ceiling, aggregate acquisition/spend limits, storage/backup allowance |
| Time | Earliest start, initial acquisition deadline, and either absolute expiry or duration plus an explicit start rule |
| Selection | Hard requirements, allowed substitutions, and preference ordering such as lowest price or preferred region |
| Retry | Attempt/wait limits, retry backoff, and response when capacity is exhausted |
| Recovery | Replacement wait limit, compatible fallback locations/types, older-backup rollback policy, optional on-demand permission |
| Backup | Protected disk coverage, schedule, retention, consistency requirement, final-backup policy |
| Delivery | OS profile, SSH public-key references, gateway profile, optional HTTP port/health check |

Price units must be explicit: a per-GPU price cannot be used as a per-instance
limit without normalization. Resource count and budget apply to the whole
request, including temporary overlap during replacement. Provider credentials
are resolved server-side from approved account references.

Start with one server per rental, matching the existing procurement primitive.
If the RFQ requests a cluster or atomic delivery of multiple servers, reject
that unsupported requirement explicitly; do not silently provision one server.

### Rule enforcement

1. Separate hard constraints from preferences. Rank only candidates that satisfy
   all hard constraints and the required backup/restore capabilities.
2. Validate price freshness, account eligibility/quota, and applicable restore
   compatibility immediately before each create request.
3. Apply the same RFQ constraints to initial procurement and every replacement.
   Recovery must not silently widen regions, change GPU model/count, increase
   spending limits, or switch from Spot to on-demand.
4. Keep lifecycle expiry separate from acquisition deadlines. If duration starts
   at first successful delivery, compute and persist `expires_at` then. A
   replacement does not restart the duration.
5. Define safe defaults only in the documented request schema and return the
   effective policy to the caller. Missing or ambiguous critical rules, including
   price units, expiry semantics, or supported disk coverage, are validation
   errors before procurement.
6. If no candidate satisfies the rules, return or emit a structured reason such
   as `capacity_unavailable`, `quota_insufficient`, `price_limit_exceeded`,
   `backup_capability_unsupported`, or `recovery_image_unavailable`.
7. Freeze the accepted rule version. Changes require an authenticated,
   version-checked policy update or renewal. Recheck the current state and policy
   before a new cloud mutation and before handoff; expiry/cancellation always
   wins over a late acquisition result.

Natural-language RFQs may be normalized by an upstream integration, but the
agent executes validated structured rules. An LLM may explain failures or
suggest alternatives; it does not authorize relaxed constraints.

### Initial procurement and handoff

1. Accept and validate the authorized RFQ request; create a durable rental.
2. Select eligible candidates and record each acquisition attempt.
3. Create the first VM with all protected volumes retained on termination.
   Record account, region, instance, volume IDs, image properties, and resource
   tags immediately. Reconcile uncertain results before buying again.
4. Verify retention flags, encryption, mounts, GPUs, SSH, and the guest agent.
   Capture an initial complete recovery point before protected-service handoff.
5. Deliver connection details and record gateway acknowledgement. Mark the
   rental active and emit a delivery event for customer notification.

The agent reports availability intervals, cloud resource usage, costs where
available, failures, and recovery progress. The upstream platform handles
customer charges, refunds, and downtime compensation from those records.

## 5. What backup A contains

Expose one logical `backup_id` to the customer. Internally, backup A consists of:

- A snapshot for the root disk and each protected EBS data disk.
- A manifest listing the complete disk set and snapshot IDs, original device
  mappings, filesystem UUIDs/mountpoints, sizes, encryption/KMS references, and
  snapshot-set consistency.
- Image metadata needed for a bootable restore: architecture, root device,
  virtualization and boot mode, network-driver support, and supported licensing.
- A deployment blueprint for compatible instance requirements, network policy,
  SSH key references, guest bootstrap version, and optional endpoint settings.
- Capture times, completion times, source generation, validation state, and
  region-specific restore-image IDs.

An AMI is the launchable image representation of this recovery point. Network
interfaces, IP addresses, security groups, instance roles, and IAM permissions
are reconstructed from the blueprint rather than assumed to be part of the
disk backup.

AWS supports a multi-volume snapshot request including the root volume. The
worker checks the whole set before promoting it to a usable recovery point.
See [AWS multi-volume snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-create-snapshots.html).

For supported Linux images, the worker can register the resulting root/data
snapshot set as an AMI. This explicit path is useful when the original server
has already disappeared and only its preserved volumes remain. Preserve image
metadata explicitly and validate bootability; do not assume an arbitrary
snapshot is a complete bootable image. See [RegisterImage](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_RegisterImage.html).

EBS snapshot data is managed by AWS and is not a normal object in our S3 bucket.
Our S3 bucket, if enabled, holds manifests, audit exports, or optional model files.
See [EBS snapshot storage](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html).

## 6. Data protection before an interruption

Set and verify `DeleteOnTermination=false` on the root disk and every protected
data disk. Reconcile inventory periodically so added, removed, or reformatted
disks cannot silently invalidate coverage. Newly attached disks are marked
pending protection until enrolled and captured. Instance-store/NVMe scratch
devices must be clearly identified; customers must place durable files on
protected EBS storage.

Preserved EBS volumes remain after termination and can subsequently be
snapshotted. They continue to incur charges until deleted. This is the primary
fallback when a warning-time backup cannot finish.
See [AWS volume preservation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html).

Proposed defaults, configurable per accepted rental policy:

| Setting | Initial value |
|---|---|
| Periodic snapshot target interval | 15 minutes; at most one capture per server at a time |
| Interruption metadata check | Every 5 seconds |
| Guest heartbeat | Every 15 seconds; three misses trigger investigation |
| Completed recovery points retained | Latest three, plus pinned recovery/final backups |
| Final backup retention | Seven days after rental end, disclosed in the quote |
| Automatic switch to on-demand | Disabled |
| Silent rollback to an older recovery point | Disabled |
| Cross-provider whole-server restore | Disabled until the provider pair is certified |

A 15-minute schedule is a target, not a guaranteed maximum data loss interval.
If snapshots take longer, fail, or overlap, the latest completed point may be
older. Publish backup age and alert when the target is missed.

For normal snapshots, use bounded guest quiesce/flush hooks where configured.
Coordinate all protected filesystems before capture and use a watchdog to thaw
them if an operation fails. Do not keep a filesystem frozen while waiting for
snapshot uploads to complete. Record whether quiescing succeeded; a successful
cloud snapshot alone does not prove application consistency.

Do not trigger a default rebooting AMI capture every 15 minutes. Routine capture
uses the explicit snapshot workflow. A separately requested maintenance backup
may stop services or reboot when the customer allows it.

## 7. Interruption, backup, and replacement

1. Receive an authenticated cloud event or a guest interruption report. Check
   account, instance ownership, current generation, event time, and rental
   state. Duplicate reports converge on one recovery operation.
2. Move the rental to `RECOVERING`, revoke the old gateway route, and notify the
   customer that service is interrupted or draining.
3. In parallel, investigate eligible replacement locations and prepare the
   final recovery point. Capacity discovery can run immediately; a fresh launch
   from backup A waits until A is usable. Discovery does not reserve capacity.
4. Ask the guest to stop accepting work, run any bounded application hook,
   flush writes, and capture all protected disks. Leave time for cloud API
   requests; do not depend on consuming the entire warning window.
5. Quiesce or shut down the old writer after the intended final capture. If
   writes continue, that capture cannot be called the final disk state.
   Track capture and write-stop boundaries explicitly. The implementation
   freezes every protected filesystem, captures only after the guest confirms,
   and terminates without thawing; it otherwise captures after termination.
6. If the VM disappears before capture, confirm termination and snapshot its
   retained disks. Once the old writer is gone, individual captures of the
   retained, unchanged disks can form a recovery set. Their application
   consistency remains crash-consistent unless a successful quiesce is known.
7. Wait for all snapshots and the restore image to become usable. Prefer the
   recovery point produced from the final retained disk state. If that cannot
   be obtained, an older point requires the customer's preaccepted rollback
   policy or an explicit decision; never silently discard recent data.
8. Launch a compatible replacement from the chosen image, restore the complete
   disk layout, verify readiness, and deliver the new generation.
9. Confirm the old generation cannot serve or continue as the authoritative
   writer before activating its replacement. A missed heartbeat alone is not
   proof the old server has stopped. If its state cannot be established, enter
   reconciliation instead of handing out two writable copies.
10. Retain old source volumes until the replacement is verified, the required
    complete backup is pinned, and cleanup policy permits deletion.

AWS interruption warnings are best-effort. The control plane must also handle
an instance disappearing with no warning. See [AWS interruption notices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html).

The two-minute objective is detection, flush/quiesce, capture initiation where
possible, and recovery scheduling. Full snapshot completion, image copying,
GPU acquisition, and server boot are asynchronous. AMI completion is not bounded
by two minutes. See [AWS AMI creation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-an-ami-ebs.html).

## 8. Placement and restore validation

Prefer the original region, trying eligible availability zones. A region's EBS
snapshots can restore disks in its other availability zones. Cross-region
recovery requires image/snapshot copies and compatible encryption permissions
before launch. Prepare copies in agreed fallback regions when recovery speed
justifies the cost. A copied older backup is not automatically preferred over a
newer source-region recovery point.
See [Copy an AMI](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/CopyingAMIs.html).

Candidates must satisfy the accepted GPU count/model/VRAM, CPU architecture,
RAM, disk sizes, boot mode, network features, and driver requirements. Prefer
the same instance type. Alternative types require an explicit compatibility
rule; a shared GPU marketing name alone is insufficient.

Validate before delivery:

- Every protected disk is restored, mounted by stable identifiers, and retains
  its expected filesystem and size.
- OS boot and SSH succeed; GPU count/model/VRAM and driver checks pass.
- Sample canary file checksums and expected customer disk inventory match.
- The guest agent has re-enrolled for the new generation.
- Any startup scripts are idempotent and do not format restored volumes.
- Instance-specific network settings and authorized SSH credentials are valid.
- Optional requested HTTP services pass their configured health checks.

Snapshot-restored disks can require initialization; include it in readiness
measurements for performance-sensitive profiles. Do not promise a fixed restore
time before measuring representative disk sizes and workloads.

Store per-generation guest credentials outside reusable image state where
possible, or rotate them at boot. Never bake cloud procurement credentials into
customer images. Customers with root access must not inherit the control
plane's IAM role or another tenant's data. Restore images and snapshots stay
private and tenant-scoped.

For direct SSH, notify the customer of the new address and verified host-key
fingerprint if it changes. An SSH gateway can keep a stable hostname or port,
but existing SSH sessions still disconnect. HTTP gateway routes can preserve a
stable URL; in-flight requests still require appropriate retry behavior.

## 8A. Managed SSH and HTTP gateway

### Scope and ownership

The project will implement the gateway, rather than require an existing external
gateway product. It is an independent process deployed outside customer Spot
instances, using the same repository and image as the bot. It has no cloud
procurement credentials and never purchases, terminates, snapshots, or restores
instances. The bot remains the sole owner of the rental lifecycle.

The gateway provides a stable SSH hostname and assigned TCP port for each rental,
and an optional stable HTTPS hostname for the customer HTTP service. Replacing a
GPU VM changes the backend route, not those public connection coordinates.
Existing SSH connections, HTTP requests, and streams can disconnect during
recovery. Clients must reconnect; memory and TCP sessions cannot migrate.

The initial release supports ordinary SSH TCP forwarding, HTTP request/response
traffic and streaming responses. HTTP WebSocket upgrades, SSH user management,
browser terminals, and a replicated gateway cluster are outside this release.
It does not install an inference server or add application authentication inside
the GPU VM. RFQ authoring, payments, and customer notification UI remain upstream.

### Public and private interfaces

| Interface | Authentication and purpose |
|---|---|
| `POST /v1/gateway/events` | Existing bot webhook HMAC, timestamp, and event ID; durable lifecycle event ingestion |
| `GET /v1/gateway/rentals/{id}/connection` | Gateway service token plus trusted tenant identity; stable endpoints, readiness, and HTTP access token |
| `GET /health` | Redacted worker health; no credentials, routes, or backend IP inventory |
| Assigned SSH TCP port | Forward encrypted SSH bytes to the currently authorized VM; the VM validates the customer's SSH key |
| `https://r-<rental-id>.<gateway-domain>/...` | Per-rental HTTP access token; reverse proxy to the RFQ-approved HTTP service |

Connection lookup is a trusted upstream service interface, not an end-customer
browser API. Tenant A cannot read tenant B's endpoints or access tokens. The
upstream presents the resulting connection details to its authenticated user.
HTTP access uses a bearer token or a dedicated access-token header when the
customer application also needs its own Authorization header. Gateway access
credentials are stripped before forwarding. Do not put access tokens in URLs.

The gateway forwards SSH without decrypting it, storing private SSH keys, or
changing `authorized_keys`. The customer continues to use the public key
registered for the RFQ. Server host-key verification remains the SSH client's
responsibility. Restore normally retains host keys from the protected root disk;
a changed key must be independently verified, never silently trusted.

### Durable routing and fencing

Use SQLite, MySQL, or DynamoDB through the existing storage adapters, with a
separate gateway database/table and worker ownership lock. Never point bot and
gateway at the same database/table: their independent ownership locks and
credentials must not conflict. Store the tenant, rental ID, assigned SSH port,
generation, highest observed rental state version, backend, expiry, pending
reconciliation, and last successful authorization time. Do not persist raw
event histories indefinitely or store cloud keys.

The route is keyed by tenant and stable rental ID. Assign a TCP port once and
persist it before opening the listener. A closed rental's port is reused only
after a quarantine (default seven days, `SPOTBOT_GATEWAY_SSH_PORT_REUSE_AFTER_SECONDS`);
until then stale client configurations reach a retired listener, and afterwards
another tenant's server presents a different SSH host key and requires that
tenant's key. Port exhaustion is an explicit delivery error; the bot moves a
handoff that stays unacknowledged past its delivery timeout to `ACTION_REQUIRED`. A gateway restart restores port
assignments, then rechecks current bot state before enabling traffic.

Only rental-record events advance the routing watermark. Backup-record events
carry a separate resource version and must not change the rental watermark.
Verify the HMAC over the original request bytes, reject expired signatures and
mismatched event IDs, and commit accepted routing intent before acknowledging
event delivery. Repeated or out-of-order events cannot regress the current
generation or state version. A tenant mismatch is rejected.

Events trigger reconciliation; they are not sufficient authority to install an
arbitrary supplied IP. Fetch current rental state from the configured bot over
an authenticated connection. The fetched state must be at least as recent as
the accepted event watermark. No caller-supplied callback or backend URL is
fetched. Validate backend IP literals and ports against operator network policy;
metadata, loopback, link-local, and private addresses are blocked unless an
operator deliberately enrolls the required target CIDRs.

### Initial handoff and recovery switching

1. The bot validates the guest and initial backup, enters `DELIVERING`, and emits
   `rental.handoff`. Production gateway rentals use `require_gateway_ack=true`.
2. The gateway durably records the event and assigned port, obtains current bot
   state, validates the target, checks the SSH banner, and checks the optional
   HTTP health endpoint specified by the accepted RFQ.
3. Prepare the new route and acknowledge the exact generation through the bot's
   existing `gateway-ack` endpoint. Enable public forwarding only after this
   acknowledgement succeeds and the generation/expiry are still current. A
   successful probe alone must not override a failed or stale acknowledgement.
4. Return stable connection metadata to the upstream through the gateway API.
   Optional public gateway metadata can also accompany the bot acknowledgement;
   per-rental HTTP access tokens must not enter ordinary lifecycle events.
5. On recovering, unavailable, ending, closed, or other non-deliverable state,
   revoke the old route and close its active tunnels/streams. A recovery never
   falls back to a previous generation while a new route is being prepared.
6. When the replacement passes bot restore validation, repeat the same protocol
   for its generation using the original public hostname and TCP port.

`rental.degraded` and `rental.healthy` keep the current route while the bot still
authorizes that running generation. The guest heartbeat is not a gateway routing
lease. The gateway independently polls the bot, so a lost webhook is recoverable.
An accepted signed revoke event disables traffic even if the bot lookup is
temporarily unavailable. Expiry is also enforced locally on every new connection
and during the worker cycle.

Use a bounded authorization lease, initially 60 seconds since the last successful
bot state check. After that interval without successful reconciliation, stop
forwarding and close active connections rather than retain a possibly revoked
route indefinitely. This deliberately trades availability during a prolonged bot
outage for bounded stale access. Make the lease configurable and expose this
failure separately from VM health. A healthy bot worker does not prove that an
instance's application is available.

### Proxy and credential boundaries

Every new SSH or HTTP connection checks route readiness, generation, lease and
absolute rental expiry. A generation change, revoke, expiry, or lost storage
ownership cancels existing forwarding sessions. Implement bounded connect/read
timeouts and backpressure; do not buffer model downloads into memory. Preserve
HTTP methods, paths, query strings, streaming bytes, and relevant headers. Strip
hop-by-hop and untrusted forwarding headers. Never follow backend redirects on
the gateway's behalf. Reject unsupported upgrade requests explicitly.
Keep HTTP proxy and bot control requests in separate connection pools so long
customer streams cannot starve authorization checks and gateway acknowledgements.

Use separate secrets for bot API access, gateway operator API access, webhook
verification, and customer HTTP access. The configured bot URL is trusted
operator configuration. Bot access from the gateway uses a dedicated credential
limited to a known rental's delivery view, connection and gateway acknowledgement;
it cannot list tenants/rentals or invoke procurement, recovery, backup, renewal
or release. The delivery view excludes commercial RFQ and accounting fields.
A shared bot administrator/execution token must not be deployed in the gateway.
A request header cannot change the bot origin. Disable
environment HTTP proxies for internal state lookups and backend proxy traffic.
Redact secrets and request payloads from logs and validation errors. Access logs
must not expose credentials. Keep private APIs protected even when the public
HTTP proxy is reachable.

### Deployment and operations

Deploy one gateway worker per gateway database initially. The HTTP application
runs behind an operator-managed TLS reverse proxy; publish wildcard DNS and a
wildcard certificate for `*.gpu.<domain>` (or equivalent chosen domain). Publish
a stable DNS record for the SSH gateway. Configure the reserved TCP port range
and firewall it explicitly. A container must publish that entire range, or use
the existing Linux host-network deployment pattern.

The GPU security group permits SSH and the requested HTTP port from the gateway
egress IP or private network. It need not expose those VM ports to the internet.
The bot may also need health-probe access. DNS records, TLS certificates, public
firewall rules, and AWS permission changes are deployment steps; adding code
must not silently modify them. Local integration can run with loopback targets
explicitly enabled. A production domain and allowed network ranges are required
before public rollout.

The gateway has an independent health check, persistent data volume or remote
database, restart policy, and redacted error counters/state. Its first release
is a single availability boundary: stable endpoints do not imply gateway high
availability. A later replicated deployment requires distributed port allocation,
leases, shared network listeners, and load-balancer design.

### Required gateway acceptance cases

- A signed handoff yields stable SSH and optional HTTP endpoints only after the
  bot accepts the current generation acknowledgement.
- Real TCP forwarding preserves SSH bytes; the VM's key authentication remains
  effective. Unauthorized HTTP requests cannot contact the backend.
- HTTP bodies and streaming responses work, access credentials are stripped,
  query strings are preserved, and backend redirects are not followed.
- Duplicate events, old generations, stale state versions, and backup events
  cannot replace or revoke a newer authorized route.
- Recovery closes old sessions; replacement reuses the public endpoint and
  reaches only the newly verified generation.
- Expiry, release, lease timeout, and storage ownership loss stop forwarding.
- A restart keeps the port assignment but does not serve stale backend state
  before reconciliation. Bind failures leave the handoff unacknowledged.
- Missing events are repaired by polling. A transient bot outage within the
  lease does not immediately change a valid route.
- Tenant isolation, tampered/expired HMACs, secret redaction, prohibited targets,
  and port exhaustion are covered by deterministic tests.
- A staging run validates actual DNS/TLS, SSH authentication, HTTP access,
  whole-server restore, route replacement, expiry, and storage retention.

Implementation order: gateway configuration and persistence; signed event
receiver and fenced reconciliation; SSH forwarding; authenticated HTTP proxy;
deployment examples and acceptance tooling; controlled AWS staging validation.
Automated local tests do not replace the final live acceptance run.

## 9. State, APIs, and durable coordination

Use a stable rental/server ID across replacements. Each cloud VM is a separate
generation with its own acquisition attempt and cloud resource IDs.

Rental states:
`ACCEPTED -> QUEUED -> PROVISIONING -> VERIFYING -> ACTIVE`;
`ACTIVE -> RECOVERING -> VERIFYING -> ACTIVE`;
`ACTIVE|RECOVERING -> ENDING -> CLOSED`.
Exceptional states include `WAITING_CAPACITY`, `NEEDS_RECONCILIATION`,
`ACTION_REQUIRED`, `FAILED`, and `CLEANUP_FAILED`.

Backups have independent states:
`REQUESTED -> CAPTURING -> PENDING -> AVAILABLE`, or `FAILED`.
Restore validation is separate from cloud snapshot completion.

Proposed additive APIs:

| Endpoint | Purpose |
|---|---|
| `POST /v1/rentals` | Accept an authorized execution request and validated RFQ rules with an idempotency key |
| `GET /v1/rentals/{id}` | State, current generation, expiry, backup age, recovery progress |
| `GET /v1/rentals/{id}/connection` | Current authorized SSH/HTTP handoff |
| `POST /v1/rentals/{id}/backups` | Request a manual whole-server backup |
| `GET /v1/rentals/{id}/backups` | Recovery points and consistency/validation status |
| `POST /v1/rentals/{id}/recover` | Request recovery from an owned, validated recovery point |
| `POST /v1/rentals/{id}/renew` | Apply an authorized upstream extension with version checks |
| `POST /v1/rentals/{id}/policy-revisions` | Apply a validated, authorized RFQ rule revision using the expected current version |
| `POST /v1/rentals/{id}/release` | End the rental with its agreed final-backup policy |
| `GET /v1/rentals/{id}/events` | Auditable lifecycle history |

These additive endpoints are implemented on top of the reviewed baseline;
see `rentals.md` for the executable API contract and integration requirements.
Execution commands come from the authenticated upstream scheduler. The agent
does not expose payment webhooks. Raw cloud interruption events enter through
SQS rather than an unauthenticated public API.

Persist `rentals`, `instance_generations`, `acquisition_attempts`, `volume_inventory`,
`backup_sets`, `backup_volumes`, `recovery_operations`, `usage_intervals`, and
`resource_cleanup_jobs`. Extend the existing event outbox.

All records carry tenant/business ownership and applicable generation numbers.
Each recovery operation is guarded by a per-rental lease and conditional state
version. Cloud API idempotency tokens are stable per attempt and scoped to its
unchanged request. Unknown results enter reconciliation; do not change the
parameters and replay the same token.

Gateway events include `event_id`, `rental_id`, `generation`, and state version.
The receiver rejects stale generations and deduplicates retries. Customer
notification occurs after the corresponding durable transition. Expose failed
delivery separately from instance health and retry both safely.

Implement SQL transactions and DynamoDB conditional/transactional writes with
equivalent invariants. SQLite remains suitable for local development; use MySQL
for the current deployment. Database backups are independent of GPU backups.

## 10. Expiry, release, budgets, and cleanup

A durable timer enforces `expires_at` even after a process restart. Expiry or
cancellation takes priority over recovery: cancel pending acquisitions, reject
late handoff, and release any VM created by an in-flight request.

At normal expiry, revoke the route, flush and stop the server according to the
accepted policy, and preserve its disks for the final backup. Terminate compute
once the agreed capture/preservation condition is met; backup completion may
continue against retained disks. A user-requested final backup failure becomes
an explicit data-protection incident, not a reason to delete the last copy.

Close a rental only when compute termination is confirmed and any retained
storage is represented by a visible retention job. `CLOSED` does not mean zero
storage cost while backups remain under the agreed retention policy.

Pin snapshots and volumes referenced by active recovery operations. Deregister
unused AMIs before deleting eligible backing snapshots; delete only unreferenced
owned resources. Keep the latest required complete backup until retention ends.
Retry cleanup with alerts and expose remaining resources and costs.

A recovery policy contains a per-instance price ceiling, remaining total budget,
retry deadline/backoff, allowed regions, compatibility set, and fallback rules.
Allow only one active replacement acquisition per rental initially. Account
quota checks must include temporary overlap and current cloud usage.

Keep waiting within policy when no eligible capacity exists. When the deadline
or budget is exhausted, retain the recoverable data and enter `ACTION_REQUIRED`
or terminate according to the accepted contract. Do not automatically buy
on-demand capacity without an accepted fallback policy.

Record compute, retained volumes, snapshots, transfers, and overlap separately.
A price quote is not a hard final invoice cap; reserve a spending margin and
stop new acquisitions before exhausting the budget.

## 11. Rollout and verification

1. Add rental identity, generation tracking, expiry, tenant authorization,
   resource inventory, and protected-volume launch checks.
2. Implement manual full backup and restore on AWS, including all data disks
   and restore-image metadata. Validate a restored server before automation.
3. Add interruption ingestion, no-warning loss detection, preserved-disk
   recovery, candidate failover, and restart-safe coordination.
4. Integrate authorized RFQ execution commands, SSH and optional HTTP gateway
   updates, notification events, availability reporting, final backup, and
   retention cleanup.
5. Exercise the flow from agent request through final cleanup in staging and perform an explicitly
   budgeted live acceptance run. Then enable protected rentals in production.
6. Add other providers through capability-based adapters and the same acceptance
   suite. Pricing support alone must never imply snapshot-recovery support.

Required acceptance cases:

- An authorized RFQ execution request creates one compliant server, delivers
  SSH, and releases it at its deadline.
- Duplicate execution commands or interruption events do not purchase duplicate
  machines.
- Missing, conflicting, or unsupported RFQ requirements fail before procurement.
- Initial and replacement acquisition both enforce price units, GPU count,
  region/account restrictions, expiry, budget, and explicit fallback rules.
- A stale RFQ revision cannot replace the current policy or bypass cancellation.
- Root and multiple data disks restore files, permissions, installed packages,
  mount layout, GPU access, and a test boot service.
- A warning triggers recovery; a snapshot still pending at VM termination can
  be completed or recreated from preserved disks.
- A no-warning termination recovers from retained disks without silently
  selecting an older backup.
- Failed snapshot, KMS access failure, incomplete volume set, and corrupt
  restore all block delivery and preserve the last recoverable copy.
- Capacity/quota/price failures obey placement and spending policies.
- Control-plane restart and a timed-out create call reconcile correctly.
- Expiry during backup, image copy, acquisition, or restore cannot deliver a
  replacement after the rental has ended.
- Delayed old-generation events cannot overwrite a new gateway route.
- Tenant A cannot list, restore, attach, or delete tenant B's backups or volumes.
- Retention cleanup removes only eligible resources; failures remain visible.

Measure recovery time as detection + capture/image preparation + capacity wait
+ launch + disk initialization + validation + gateway handoff. Record each
component. Test several representative disk sizes; report observed percentiles
and backup-age distributions before setting an SLA.

The staging acceptance tool defaults to a read-only execution plan. An explicit
execution flag uses a supplied bounded RFQ and the normal bot/gateway APIs;
it never invokes EC2 purchases directly. Persist a unique run journal before
submission, use a stable business idempotency key, verify root/data file hashes
and permissions over SSH before/after recovery, and request release in a finally
block even when creation outcome is uncertain. Report unresolved cleanup and
retained storage explicitly. SSH uses a dedicated known-hosts file; first-use
trust is an explicit staging option and never accepts a changed key. Enforce
short final retention for test runs. Actual execution requires approved cloud
permissions, networking, gateway DNS/TLS, and a spending limit in the RFQ.

## 12. Required deployment inputs

- Upstream execution API owner, authentication arrangement, and the RFQ field
  mapping/version contract. A structured test RFQ can be used before the live
  upstream integration is available.
- Gateway SSH/HTTP registration, revoke/update, acknowledgement, and customer
  notification contracts. The managed gateway is now owned by this project;
  supply its public domain, TLS/DNS arrangement, approved target networks, and
  deployment host. Customer-facing notification presentation remains upstream.
- Approved AWS recovery regions, Linux image profiles, GPU compatibility rules,
  and a budget for compute, retained disks, snapshots, and cross-region copies.
- A dedicated control-plane role with scoped snapshot/image/volume inventory,
  preservation, restore, cleanup, EventBridge/SQS, and KMS permissions, in
  addition to existing launch/terminate permissions.
- RFQ-defined lifecycle expiry, spend limits, rollback, final retention, and
  maximum recovery-wait policies. Customer billing and downtime credits remain
  owned by the upstream platform.

No new permissions, purchases, snapshots, deletions, payment actions, or
production changes were executed when writing this design. All new runtime
logs and maintained implementation documentation must remain in English.
