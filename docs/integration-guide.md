# Protected GPU rentals: integration guide (staging)

This guide is for upstream partners that place orders and deliver GPU servers to their
own customers. When a server is lost or reclaimed by AWS, the platform replaces it and
restores the whole server; the customer's connection address stays the same.

## 1. Environment and credentials

| Item | Staging |
|---|---|
| Rental API | `https://spotbot.test.vishwalab.com` (API reference: `/docs`) |
| Connection API (gateway) | `https://gpu-gateway.test.vishwalab.com` |
| Customer SSH | `gpu-ssh.test.vishwalab.com:<assigned port>` |
| Customer HTTP | `https://r-<rental-id>.test.vishwalab.com` |
| Regions | `us-west-2`, `us-east-1`, `us-east-2` |

The platform delivers these credentials separately. Keep them in server-side secret
storage, never in code or a browser:

- **Tenant ID** and **tenant token** for the rental API. A tenant sees and changes only
  its own rentals.
- **Gateway API key** for the connection API.

Send these headers on every request:

```
Authorization: Bearer <token>
X-SpotBot-Tenant: <tenant ID>
```

Staging uses real AWS resources. Test rentals are billed, within each RFQ's price
ceiling and budget.

## 2. Typical flow

1. **Create**: `POST /v1/rentals` with an `Idempotency-Key` header (your order ID is
   fine). After a timeout, retry with the same key and body; it never buys twice. The
   same key with a different body is a conflict.
2. **Poll**: call `GET /v1/rentals/{id}` every 10–30 seconds until `state` is `ACTIVE`.
   Delivery usually takes minutes, longer when AWS capacity is tight.
3. **Get the connection**: call `GET /v1/gateway/rentals/{id}/connection` on the
   gateway and show the customer the SSH host, port, user, HTTP address and HTTP access
   token. Do **not** show the server IP from the rental API's `connection` field; it
   changes when the server is replaced.
4. **While in use**: keep polling. On `RECOVERING`, tell the customer the server is
   being replaced and to reconnect later. Once `ACTIVE` again, the customer reconnects
   to the **same** address.
5. **Renew**: `POST /v1/rentals/{id}/renew` with the next RFQ version (`rfq_version`
   plus one, later `expires_at`) and `expected_version` set to the current
   `rfq_version`.
6. **End**: `POST /v1/rentals/{id}/release`. Rentals also end at `expires_at` or when the
   budget is spent. A final backup is taken first and deleted after
   `backup.final_retention_seconds`.

## 3. RFQ fields

The request body is `{"rfq": {...}}`. Common fields:

| Field | Meaning |
|---|---|
| `rfq_id`, `rfq_version`, `upstream_order_id` | Your order identifiers; `rfq_version` starts at 1 |
| `regions` | Allowed Regions, for example `["us-east-1","us-west-2"]` |
| `gpu_model`, `gpu_count` | GPU model and count, for example `"L4"` and `1` |
| `min_gpu_memory_gib` | **Marketed** memory per GPU in GB: 24 for L4/A10G, 16 for T4, 80 for H100 |
| `instance_types` | Optional instance type limit, for example `["g6.xlarge","g6.2xlarge"]` |
| `price_unit`, `max_price_hourly` | Always `"instance_hour"`; hourly price ceiling per server in USD |
| `budget_usd` | Total budget in USD; the rental ends when it is spent |
| `acquisition_deadline` | Deadline for the first server; the rental ends if none is obtained |
| `expires_at` | Rental end time (ISO 8601 with time zone) |
| `root_volume_gib`, `data_disks` | Root disk size; data disks such as `[{"device":"/dev/sdf","size_gib":100}]` |
| `ssh_key_name` | Optional login key pair name; see section 6 |
| `ssh_public_key` | Optional customer OpenSSH public key, installed for `ssh_user` |
| `ssh_user` | Login user; `ubuntu` for the default image |
| `http_port`, `http_health_path` | Optional customer HTTP service; if set, it **must return 200** before delivery |
| `max_recovery_seconds` | Longest wait for a replacement (default 3600) before an operator is needed |
| `backup` | `interval_seconds` (default 900), `keep`, `final_retention_seconds` |

## 4. Rental states

| State | Meaning | Suggested customer message |
|---|---|---|
| `QUEUED`, `WAITING_CAPACITY`, `PROVISIONING` | Obtaining a server | Preparing |
| `VERIFYING` | Server is up; self-check and first backup | Preparing |
| `DELIVERING` | Waiting for the gateway to connect it | Preparing |
| `ACTIVE` | Ready to use | Running |
| `RECOVERING` | Replacing the server (reclaimed, lost, or requested) | Switching; reconnect shortly |
| `ACTION_REQUIRED` | Needs a platform operator (see `error`) | Problem; contact support |
| `NEEDS_RECONCILIATION` | Purchase outcome uncertain; being checked | Problem; contact support |
| `ENDING`, `CLOSED` | Ending / ended | Ended |

`GET /v1/rentals/{id}/events` lists the rental's event history (for example
`rental.recovering`, `rental.active`, `rental.degraded`) for diagnosis and customer
notifications.

## 5. Replacement and data guarantees

- **Preserved**: everything written to the root and data disks. After replacement, file
  contents, modes and owners are identical, and the SSH host key is unchanged.
- **Lost**: RAM, GPU memory, running processes and network connections. Customers
  reconnect and restart their programs.
- **Timing**: the final backup is ready about 2 minutes after an AWS reclaim warning; a
  new server takes about 4–5 minutes from launch to delivery. Expect 5–15 minutes
  overall, **plus however long AWS takes to provide capacity**.
- Customers may install an executable `/etc/spotbot/pre-backup` script. It runs before
  every backup (8-second limit) so applications such as databases can flush first.

## 6. Current limits

- AWS Spot only, one Linux server per rental.
- **SSH public keys**: `ssh_key_name` must be an AWS key pair the platform has imported
  in **every enabled Region**. Alternatively pass the customer's `ssh_public_key`, or none:
  `PUT /v1/rentals/{id}/ssh-keys` replaces the customer keys at any time and the server picks
  them up within about 15 seconds (`GET` shows whether they are installed).
- Replacement stays in the server's Region; cross-region recovery is not enabled.
- While a server is being replaced, customers cannot connect.

## 7. Common errors

| HTTP / `error` | Meaning |
|---|---|
| 401 / 403 | Wrong token or tenant |
| 404 `rental_not_found` | No such rental for this tenant |
| 409 `idempotency_key_conflict` | The same `Idempotency-Key` with a different body |
| 409 `region_not_enabled_for_rentals` | The Region is not enabled for rentals |
| `aws_InsufficientInstanceCapacity` | AWS has no free capacity right now; retried automatically |
| `acquisition_limit_reached` | No server before the deadline; the rental ended |
| `gateway_ack_timeout` | Delivery timed out; needs an operator |
| `recovery_wait_limit_reached` | No replacement within `max_recovery_seconds`; needs an operator; data is kept |

## 8. Examples

```sh
curl -X POST https://spotbot.test.vishwalab.com/v1/rentals \
  -H "Authorization: Bearer $TENANT_TOKEN" -H "X-SpotBot-Tenant: $TENANT_ID" \
  -H "Idempotency-Key: order-10001" -H "Content-Type: application/json" \
  -d '{"rfq": {"rfq_id": "order-10001", "rfq_version": 1, "upstream_order_id": "order-10001",
       "regions": ["us-east-1", "us-west-2"], "gpu_model": "L4", "gpu_count": 1,
       "min_gpu_memory_gib": 24, "price_unit": "instance_hour", "max_price_hourly": "0.95",
       "budget_usd": "20", "acquisition_deadline": "2026-10-23T12:00:00Z",
       "expires_at": "2026-10-23T20:00:00Z", "ssh_key_name": "test", "ssh_user": "ubuntu",
       "root_volume_gib": 75, "data_disks": [{"device": "/dev/sdf", "size_gib": 100}]}}'

curl https://gpu-gateway.test.vishwalab.com/v1/gateway/rentals/$RENTAL_ID/connection \
  -H "Authorization: Bearer $GATEWAY_API_KEY" -H "X-SpotBot-Tenant: $TENANT_ID"
```
