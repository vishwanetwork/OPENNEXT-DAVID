# Managed rental gateway

The independent gateway gives each rental a stable SSH host/port and an optional
HTTPS hostname while the bot replaces its underlying AWS Spot VM. It runs from
the same image with `spotbot gateway`, and never calls cloud provider APIs.
The design and acceptance requirements are in section 8A of
[the recovery plan](spot-instance-recovery-plan.md).

## Deploy

1. Choose a persistent gateway host, preferably separate from the bot and
   without a procurement IAM role. If co-locating on an IAM-enabled host, isolate
   gateway access to IMDS and credentials explicitly; host networking alone is
   not a credential boundary. Do not deploy the gateway on a customer Spot VM.
2. Copy `.env.gateway.example` to `.env.gateway` (ignored by Git). Set the bot URL,
   its dedicated `SPOTBOT_RENTAL_GATEWAY_TOKEN`, a separate gateway API key, the
   webhook signing secret, and a separate `SPOTBOT_GATEWAY_HTTP_TOKEN_SECRET`.
   Gateway secrets must be distinct and at least 32 characters.
3. Configure public SSH DNS and optionally `*.gpu.example.com` wildcard DNS to
   the gateway host. Choose the reserved SSH port range. Open only the approved
   ports in the gateway firewall. The default is TCP 22000–22999 plus HTTPS.
4. Use the existing TLS proxy to terminate HTTPS and preserve the Host header.
   `examples/gateway.nginx.conf` illustrates the configuration. Provision a
   certificate covering the control hostname and HTTP wildcard. Certificate/DNS
   provisioning is external to the gateway process.
5. Allow the gateway egress IP or private CIDR to reach VM SSH and RFQ HTTP ports.
   Keep bot health-probe access as needed. Public unicast targets are allowed by
   default. Set explicit `SPOTBOT_GATEWAY_ALLOWED_TARGET_CIDRS` for private
   networking; when populated, that list replaces the public-address default.
   The current HTTP backend protocol is plaintext HTTP; use private networking
   or a private tunnel when customer data requires protected gateway-to-VM transit.
6. Select SQLite, MySQL, or DynamoDB using gateway-prefixed settings. A separate
   database/table is required because each process owns its own worker lock.
   For MySQL create, for example, `spot_order_gateway`, grant its service user
   access, and set `SPOTBOT_GATEWAY_MYSQL_URL`. Never use the bot database.
7. Start one worker with `docker compose -f compose.gateway.yaml up -d --build`.
   The Linux host-network example publishes the TCP listener range and binds
   HTTP only to loopback 18084. The data volume persists assignments on restart.
8. In the **bot** environment set `SPOTBOT_GATEWAY_WEBHOOK_URL` to
   `https://gateway.example.com/v1/gateway/events` and use the same
   `SPOTBOT_GATEWAY_WEBHOOK_SECRET`. Restart the bot through its normal deployment.
   Set `SPOTBOT_RENTAL_GATEWAY_TOKEN` to the gateway's `SPOTBOT_GATEWAY_BOT_TOKEN`;
   use a new secret distinct from bot administrator/tenant execution credentials
   and webhook signing. Do not deploy an administrator or tenant execution token
   in the gateway. The dedicated token can read a known rental's limited delivery
   view/connection and positively acknowledge that generation, with
   `X-SpotBot-Tenant`. It cannot reject a handoff, because a rejection ends the rental.
   Other rental commands, collection APIs and inventory lists reject this token.
   The gateway also requires the bot's `authorization_scope=gateway_delivery`
   response marker and refuses to route with an administrator/full execution
   response. Upgrade the bot and gateway together for this contract.
9. Submit rental RFQs with `require_gateway_ack=true`. If an HTTP service is
   requested, configure the public HTTP domain and install that service on the
   VM so its RFQ health endpoint returns 200. No inference service is installed
   automatically.

Local startup reads `.env.gateway` automatically. The example data path is for
the container; use a writable local path when running outside Docker. Startup
fails on missing secrets or invalid network/port configuration. None of these
commands creates GPU resources until an authorized live rental is submitted.

### Co-located EC2 credential isolation

The gateway container uses UID/GID 10002 and `/app/gateway-data`; the bot keeps
UID 10001. Before starting a gateway on an EC2 host with a procurement role,
install `examples/spotbot-gateway-isolation.service` in `/etc/systemd/system/`
and enable/start it. It rejects IPv4 and IPv6 IMDS traffic from UID 10002,
persists across boot before Docker, and leaves other users' rules unchanged.
Also add a Docker systemd drop-in requiring and ordering after this unit so
Docker cannot auto-start the gateway if isolation setup fails. Inspect existing
Docker dependencies before reloading systemd; do not restart unrelated services.
Verify the container UID and a failed IMDSv2 token request from the gateway
while the bot can still use its instance role. Do not enable user namespace
remapping without adjusting the host UID rules. Do not mount cloud credentials,
the Docker socket, or the bot configuration in the gateway. The environment
disables SDK credential files/metadata as defense in depth; the firewall is the
network boundary. A gateway using DynamoDB needs separately scoped credentials
or a dedicated host/role, rather than access to the bot's instance role.

Existing SQLite gateway deployments must copy their database into the new
volume path and set ownership to 10002 before upgrading. MySQL deployments
keep their independent database and require no SQLite data migration.

## Upstream integration

The bot emits signed events to `POST /v1/gateway/events`. The receiver validates
the original bytes and five-minute signature window, commits routing intent,
and returns 204. The gateway polls the bot for current state, probes SSH and
optional HTTP, binds its fixed listener, and acknowledges the current generation.
Public forwarding starts after successful acknowledgement. Event payloads cannot
direct the gateway to an arbitrary URL or override current bot state.

The upstream reads `GET /v1/gateway/rentals/{rental_id}/connection` using
`Authorization: Bearer <gateway-api-key>` and `X-SpotBot-Tenant: <tenant-id>`.
The response contains `ready`, `generation`, `ssh`, optional `http`, and, when
ready, `http_access_token`. This trusted endpoint is not a browser login API.
Use the upstream's existing customer authentication before presenting results.
Missing events or an undelivered initial event leave a rental unavailable;
check the bot's durable event outbox and configured webhook URL.

SSH users connect with their original key:

```sh
ssh -i customer-key.pem -p 22000 ubuntu@ssh.example.com
```

Use the actual assigned port from the API. SSH remains encrypted end to end;
the VM validates the key. The gateway does not bypass SSH authentication or
disable client host-key verification. When a server host key changes, verify it
independently before updating `known_hosts`.

The managed bootstrap writes a cloud-init override after first-boot host-key
generation, so future snapshots preserve this rental's existing SSH host keys
on restoration. It does not distribute private keys through user data or the
gateway. Older backups and customer-modified cloud-init settings may still
change the keys and require independent verification. Shared factory images
must contain no saved server host private keys or tenant data; never enroll a
customer server backup as a shared initial image.

For HTTP, send `Authorization: Bearer <http-access-token>`. If the application
needs its own Authorization header, instead send the gateway credential in
`X-SpotBot-Access-Token`. The gateway strips its credential before forwarding;
an application Authorization header is preserved with the dedicated-header mode.
Do not put access tokens in URLs. Tokens are specific to the rental and derived
from `SPOTBOT_GATEWAY_HTTP_TOKEN_SECRET`, which must differ from the operator API,
bot, and webhook secrets. Rotating it rotates every rental's HTTP access token
without changing the upstream operator credential.

## Routing, failures, and limits

- A replacement reuses the same public endpoint, but existing connections close.
  Recovery, release, and expiry revoke the old route. Clients must reconnect.
- A missing webhook is repaired by polling **known** rentals. Initial discovery
  uses the durable bot outbox; configure event delivery before accepting rentals.
- `degraded`/`healthy` events retain the route while the bot still authorizes it.
  The gateway's independent authorization lease defaults to 60 seconds. Bot
  outages within that lease retain a valid route; longer outages close traffic.
  An independent timer enforces lease/expiry even while a bot request is pending.
- Restart preserves assignments but requires fresh bot authorization before
  enabling traffic. Old-generation and stale-version events cannot regress it.
- A closed rental keeps its SSH port for `SPOTBOT_GATEWAY_SSH_PORT_REUSE_AFTER_SECONDS`
  (default seven days, minimum one hour) after the gateway observes `CLOSED`.
  Afterwards the port may be assigned to a new rental, possibly another
  tenant's; the old route row keeps its history with `port_released_at`. A
  stale client then reaches a server with a different SSH host key, which SSH
  rejects. Size the range for the rentals opened within one quarantine period;
  when it is exhausted the gateway records `ssh_port_range_exhausted` and the
  bot moves the unacknowledged handoff to `ACTION_REQUIRED`
  (`gateway_ack_timeout`) after `SPOTBOT_RENTAL_DELIVERY_TIMEOUT_SECONDS`.
- SQLite, MySQL, and DynamoDB use the existing workflow CAS storage. One gateway
  worker owns a database/table. The first release is not a replicated gateway.
- HTTP bodies/responses stream with backpressure. Redirects are returned to the
  client and never followed internally. WebSocket upgrades are unsupported.
  Host and forwarding metadata are regenerated from the validated public route;
  configure the customer application to trust the gateway when generating URLs.
  The TLS proxy controls request-size limits. Backend HTTP read timeout is 60
  seconds and SSH idle read timeout is 300 seconds. SSE should send heartbeats.
- `/health` reports the worker and last completed cycle without private routes
  or credentials. Route lookup returns sanitized delivery errors. Logs are English.
- Direct VM IPs remain visible through the bot API for operator diagnosis. The
  upstream must present the gateway API's endpoints when fixed entry is desired.

Run `pytest tests/test_gateway.py tests/test_gateway_rentals.py -q` for gateway
tests, then the full test suite. Network tests require loopback socket access.
Cloud tests remain simulated until staging validates real DNS/TLS, security
groups, customer keys, disk restoration, route switching, and retention cleanup.
