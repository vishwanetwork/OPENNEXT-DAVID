# SpotOrderBot

SpotOrderBot provides GPU price history and capacity procurement for an upstream scheduler. It collects vendor prices and availability, accepts requests for a specific offer with a price ceiling, creates instances, and publishes SSH and HTTP connection records for a gateway.

The implementation uses Python and FastAPI with selectable SQLite, MySQL, or Amazon DynamoDB storage. AWS EC2 Spot, Lambda, Vultr, and Shadeform are supported. The application-wide live-order switch is disabled in the example configuration; individual orders now default to `dry_run=false`. Check `/health` for the deployed service's live and simulation switches.

See [Architecture](docs/architecture.md) for component responsibilities, state transitions, and recovery behavior.

## Quick start

Run commands from the project directory. The existing local `.venv` already contains the required packages:

```sh
.venv/bin/spotbot check-config
.venv/bin/spotbot serve
```

Open [API documentation](http://127.0.0.1:8000/docs). The service listens on `127.0.0.1:8000`, collects prices every five minutes, and processes orders every 15 seconds by default. Restart after changing `.env`.

For a fresh environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
cp .env.example .env
chmod 600 .env
.venv/bin/spotbot serve
```

Alternatively, run `docker compose up --build -d`. Container data is stored in the `spotbot-data` volume. Use one service process per database; backend-specific locks reject additional service or CLI collector processes using the same store.

For a Linux host with local MySQL and an HTTPS reverse proxy, see [Deployment](docs/deployment.md) and `compose.production.yaml`.

## Configuration

Set cloud resource keys in `.env`. Model inference keys are not interchangeable with cloud resource keys.

```dotenv
LAMBDA_API_KEY=
VULTR_API_KEY=
SHADEFORM_API_KEY=
TENSORDOCK_API_KEY=
SPOTBOT_ENABLED_PROVIDERS=lambda,vultr,shadeform
```

TensorDock is disabled pending account registration. Its adapter remains available: add `tensordock` to restore collection and new orders. Disabling a provider preserves history and does not prevent monitoring or releasing existing instances.

If `SPOTBOT_API_KEY` is set, clients must send `Authorization: Bearer <token>`. An empty service key is intended for local development. Live ordering requires a service key and `SPOTBOT_LIVE_ORDERS_ENABLED=true`.

Select `sqlite`, `mysql`, or `dynamodb` with `SPOTBOT_STORAGE_BACKEND`. Setup, locking, credentials, and compatibility testing are covered in [Storage Backends](docs/storage.md). Collection, freshness, timeout, resource profile, and webhook settings are documented in [.env.example](.env.example).

## Provider support

| Provider | Catalog collection | Implemented creation adapter | Current limitation |
|---|---|---|---|
| AWS | Linux GPU Spot quotes by Region and Availability Zone | One-time EC2 Spot with a native hourly limit | Actual capacity requires a launch attempt; quotas and compatible launch defaults apply |
| Lambda | On-demand prices and regions with capacity | On-demand | No Spot creation in this adapter |
| Vultr | GPU on-demand and preemptible prices, including regional costs | On-demand | Preemptible creation parameters require verification |
| Shadeform | Separate on-demand and Spot entries for each region | On-demand and Spot | Spot uses Shade Cloud; the underlying cloud is preserved |
| TensorDock | v2 location catalog and complete resource profile estimate | On-demand with a dedicated public IP | Disabled; v2 Spot creation and forwarding-only hosts are unsupported |
| SF Compute | CLI workflow planning only | None | No collection, CLI execution, or transactions |

Unsupported markets are rejected without switching to on-demand. Query `/v1/providers` for enabled status, credential configuration, capabilities, and collection results. See [AWS integration](docs/aws.md) for default launch configuration and permissions.

Lambda's `/api/v1/instances` lists existing account instances; prices come from `/api/v1/instance-types`. Vultr uses `/v2/plans?type=vcg`; Shadeform uses `/v1/instances/types`. CPU-only types are excluded.

## Price API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/providers` | Configuration, capabilities, and collection status |
| POST | `/v1/collections?provider=shadeform` | Collect one provider; omit the filter for all enabled providers |
| GET | `/v1/prices/latest` | Latest offers grouped by provider |
| GET | `/v1/prices/history?provider=lambda&sku=gpu_1x_h100` | Historical snapshots for a provider and SKU |
| GET | `/v1/prices/aws-spot-history?region=us-west-2&sku=g5.xlarge` | Durable AWS Spot change events and coverage, up to a 90-day query window |
| GET | `/v1/prices/aws-list-history?region=us-west-2&sku=g5.xlarge` | Published historical On-demand and one-year No Upfront Reserved intervals |
| GET | `/v1/gpus?model=H100&market=spot` | GPU models, providers, regions, and offers |
| GET | `/v1/offers/{offer_id}` | Current details for one offer |

Latest prices accept `provider/cloud/market/gpu/available_only/can_attempt_only/limit/offset`. GPU lookup also accepts `can_attempt_only`. History additionally accepts `sku/region/offer_id/since/until`. Time bounds must include a timezone, such as `2026-10-13T00:00:00+08:00`.

Pagination defaults to 100 entries and permits up to 1,000. Latest prices paginate offers before grouping by provider; GPU queries paginate model groups. Use provider filters or additional pages for a complete catalog.

Prices are Decimal strings in **USD per complete instance per hour**. `price_per_gpu_hourly` is a derived comparison value. Memory and storage units remain explicit. `market` distinguishes Spot from on-demand; `price_kind` distinguishes quoted prices from estimates.

Availability is a snapshot, not a reservation. `capacity_status` distinguishes reported stock from unknown stock; `can_attempt` identifies a fresh candidate for a launch attempt. AWS publishes quotes with unknown stock, so its offers have `available=false`; use `can_attempt_only=true` for AWS candidates instead of treating prices as inventory. AWS candidates account for observed remaining quota, including other account resources, but allocation can still fail. Offers become stale after ten minutes by default; available-only queries exclude stale offers. Latest prices use each provider's most recent successful complete collection. A successful empty catalog removes its current offers. A failed collection preserves previous snapshots and reports an error. History begins with this service's first collection.

TensorDock estimates include one GPU, four vCPUs, 8 GB RAM, and 100 GB storage by default. Changing this profile changes the offer identity. Vendor bills may include additional network charges or taxes.

## Order API

The scheduler chooses an `offer_id`, a per-instance hourly price ceiling, and provider-specific launch settings. Each order creates one VM with the selected GPU count. Separate VMs require separate business idempotency keys.

Example Shadeform Spot dry run; replace the offer and SSH key IDs:

```sh
curl -X POST http://127.0.0.1:8000/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: scheduler-job-001' \
  -d '{
    "offer_id": "0123456789abcdef01234567",
    "max_price_hourly": "2.00",
    "dry_run": true,
    "wait_seconds": 900,
    "max_attempts": 20,
    "launch": {"ssh_key_id": "replace-with-your-ssh-key-id"},
    "inference_port": 8000,
    "inference_path": "/v1"
  }'
```

Add the service authorization header when configured. Omitting `dry_run` defaults to a live request. Live requests require live ordering enabled. Explicit `dry_run=true` stores a plan without creating resources only when `SPOTBOT_DRY_RUN_ENABLED=true`; disabling simulation rejects such requests. Existing planned orders remain planned. Replaying a business key with the same request returns the original order; different parameters with the same key return HTTP 409. Converting a dry run to a live request requires a new key.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/orders` | Submit an order; requires `Idempotency-Key` |
| GET | `/v1/orders` or `/v1/orders/{id}` | Query orders |
| GET | `/v1/orders/{id}/plan` | View a redacted provider request |
| POST | `/v1/orders/{id}/cancel` | Cancel a queued or planned order |
| POST | `/v1/orders/{id}/release` | Request destruction and poll for confirmation |
| POST | `/v1/orders/{id}/reconcile` | Associate a verified instance after uncertain creation |
| GET | `/v1/orders/{id}/handoff` | Read the gateway connection record |
| GET | `/v1/orders/{id}/events` | Inspect events and webhook delivery records |

Launch settings:

- AWS: `launch` may be empty when the deployment defaults are configured. Optional `key_name`, `security_group_ids`, `root_volume_gb`, and plaintext `cloud_init` are supported. The selected offer supplies its zonal subnet and GPU image; changing images requires updating the configured image and recollecting.
- Lambda: exactly one registered name in `launch.ssh_key_names`; optional plaintext `cloud_init`.
- Shadeform: `launch.ssh_key_id`; optional `os` and startup script `cloud_init`.
- Vultr: `launch.os_id` and `launch.sshkey_ids`; optional plaintext `cloud_init`. Retrieve OS IDs from the vendor's `/v2/os` API.
- TensorDock: `launch.ssh_public_key`; optional `os` and JSON `tensordock_cloud_init`. The adapter uses a v2 Bearer token.
- All providers: `launch.ssh_user` can override the image's default SSH user.

Unsupported options are rejected. Before creation, the worker refreshes the catalog and checks availability, freshness, and price. The ceiling is a client-side submission check, not a guaranteed native limit order or total budget cap. Waiting deadlines apply before creation and do not release running instances. The scheduler must release resources when their work ends.

Creation timeouts, HTTP 5xx, malformed success responses, and crashes during creation produce `needs_reconciliation`. These requests are not automatically replayed. Locate the vendor instance named `spotbot-{order_id}`, then submit `{"instance_id":"..."}` to the reconciliation endpoint. The bot verifies the name before resuming monitoring. AWS also receives a deterministic `ClientToken` for each order. If no instance exists, establish the outcome before purchasing again with a new business key.

## Gateway handoff

Connection records contain provider, underlying cloud, region, GPU details, instance ID, SSH host/port/user/key reference, and an optional HTTP inference URL. SSH private keys remain in the upstream platform's key management system.

`ready` means the provider reports a running instance with an IP. It does not prove that a container or model is healthy. Generated HTTP URLs remain `unverified`. The gateway must validate health and authentication before routing workloads. See [container startup example](examples/container-start.sh) for a template to submit through vendor launch configuration.

The gateway can poll handoff records or receive signed events:

```dotenv
SPOTBOT_GATEWAY_WEBHOOK_URL=https://gateway.example.com/events/capacity
SPOTBOT_GATEWAY_WEBHOOK_SECRET=replace-with-a-shared-signing-secret
```

The persistent outbox retries failed delivery with exponential backoff. Delivery is at least once: receivers must deduplicate `event_id` and check current order state before applying delayed events. Verify `X-SpotBot-Signature` as `HMAC-SHA256(secret, timestamp + "." + raw_body)`. See [verification example](examples/verify_webhook.py).

Preemption or disappearance revokes the available handoff. The scheduler decides whether to buy replacement capacity and restore a checkpointed workload; automatic repurchasing is not implemented.

## SF Compute and SkyPilot

SkyPilot is not installed or integrated. A future workload executor can use it while preserving independent procurement and workload states.

`POST /v1/sfcompute/plan` generates a CLI sequence: create a pool if needed, buy compute time, wait for a full fill, and create instances. It does not execute commands or purchase capacity. See [sample request](examples/sfcompute-plan.json). The plan uses node-hour pricing and the documented eight-GPU node model. Purchased allocation and VMs are separate resources; destroying a VM does not refund purchased time.

## Validation and repository conventions

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check spotbot tests examples
.venv/bin/spotbot collect --provider vultr
```

While the service is running, use `POST /v1/collections` instead of a second CLI collector against the same database.

All application log messages, CLI output labels, API errors, and committed documentation must use English. Keep operational instructions in this README and durable design details in `docs/architecture.md`. Local research, integration reports, logs, secrets, databases, and generated artifacts are excluded by `.gitignore`. Files already tracked by Git would require removal from the index before a later commit.

This version targets single-host integration. Production expansion beyond the current singleton worker requires distributed worker coordination, tenant authorization, quota and total budget policies, automated reconciliation, workload deployment, and gateway health checks. History has no automatic retention policy.
