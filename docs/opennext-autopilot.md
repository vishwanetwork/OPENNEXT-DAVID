# OpenNEXT Spot autopilot (design)

Status: P0 (usage billing and email notices) and P1 (managed launch) are implemented in the
adapter, bot and guest agent; P2 and later are proposals. "As built" notes under P1 record where
the implementation differs from the proposal.

A Spot purchase waits up to 60 minutes for capacity, and the customer has no way to learn
when it arrives. A server that arrives at night runs idle until its paid hours expire. This
design removes that waste in two phases:

- **P0, usage billing and notifications.** Customers pay only for the time they had a
  server, and they hear about every change by email.
- **P1, managed launch.** At purchase, the customer leaves a task for the guest agent: what to
  run once a server is delivered, and whether to end or keep the server when the task exits.

Nothing here gives the bot or an AI model new access to the server. The guest agent already
polls the bot every 15 seconds and applies the customer's key set; P1 adds one more
instruction to the same channel.

## P0.1 Usage billing

### Today

- The adapter holds `checkout_totals(price, hours)` (duration plus the 5% fee) at purchase.
- The charge becomes `charged` when the bot accepts the rental and stays charged.
- Ending a delivered rental early refunds nothing.
- `expires_at` is `acquisition_deadline + hours`, so a server delivered after 5 minutes runs
  `hours + 55 minutes` at our cost.

### Proposal

- The purchase hold stays as it is: it is the customer's maximum for this order.
- The service window starts at delivery: `expires_at = delivered_at + hours`. The bot sets it
  when the rental first becomes `ACTIVE`, and the acquisition deadline still bounds the wait.
- Billable time is the sum of **service intervals**: periods in which the customer had a
  delivered server. An interval opens when the rental becomes `ACTIVE`. It closes when the
  rental becomes `RECOVERING` (the customer has no server during a replacement), when an end
  is requested (END, autopilot end or expiry), or when the rental closes.
  - The rental row records the intervals: `service_intervals: [{start, end}]`.
  - Recomputing them from generation timestamps is possible but fragile, because recovery
    and frozen switches overlap generations.
- When the rental closes, the ledger settles the charge:
  - `billed = ceil(billable_minutes * price_cents / 60)` plus the 5% fee, rounded the way
    `checkout_totals` rounds.
  - The billed amount never exceeds the hold.
  - A delivered order is billed at least 60 minutes.
  - The remainder is released.
- Undelivered rentals stay fully refunded, as today.

### Ledger changes (`spotbot/opennext_ledger.py`)

| State | Counts against Credit | Meaning |
|---|---|---|
| `held` | `cents` | Purchase submitted, no rental yet |
| `charged` | `cents` | Rental accepted; the hold stays in place until it closes |
| `settled` (new) | `billed_cents` | Rental closed; `released_cents = cents - billed_cents` |
| `refunded` | 0 | Never delivered, or never accepted |

- `reconcile` settles a `charged` charge when its rental is `CLOSED` and was delivered.
- The instance view shows the live usage (`billed so far`) next to the hold.
- `adjusted_account` subtracts `billed_cents` for `settled` charges and `cents` for open ones.
  `spotCharges` gains `billedCents` and `releasedCents`.

### Risks

- Revenue per order falls when customers end early. The cost estimate already loses money at
  Spot price + 5%. The largest fixed per-order cost was the 100 GiB root volume kept for the
  7-day retention (about $1.84). Closed rentals now delete their volumes as soon as the final
  snapshot is available and keep only the snapshot, which is billed for the blocks written.
- Settlement currently runs only when the customer opens the Terminal (`/me`). The notifier
  loop (P0.2) reconciles every customer with open charges, so settlement no longer depends on
  page visits.

## P0.2 Notifications

### Delivery

- The OpenNEXT adapter runs a **notifier loop** every 30 seconds. It lists open
  `tenant=opennext` rentals from the bot and compares each one with what it last notified.
- Polling is preferred over the bot's event outbox: the outbox already has one consumer (the
  gateway webhook), and polling also drives ledger settlement.
- Sent notices are recorded in the bot database (kind `opennext_notice`, id
  `<rental>:<event>`), so a restart never sends a notice twice.
- Email goes through the same SMTP settings the OpenNEXT API uses (`SMTP_HOST` …), passed to
  the adapter as `SPOTBOT_OPENNEXT_SMTP_*`.
- The recipient is the account email captured from the verified session at purchase and
  stored on the charge record. Turning notices off per account is not built yet.
- A signed customer webhook (HMAC, same scheme as the gateway webhook) is optional and comes
  after email. Telegram and Feishu can be built on top of the webhook.

### Events

| Event | Trigger | Content |
|---|---|---|
| Delivered | First `ACTIVE` | Model, Region, SSH command, service end, keys state |
| Not acquired | `CLOSED` without delivery | Full refund amount |
| Replacing server | `RECOVERING` after delivery | Spot interruption; billing paused |
| Server replaced | `ACTIVE` again | Same SSH command; disk restored from the last backup |
| Ending soon | 30 minutes before `expires_at` | How to extend, if supported |
| Ended | `CLOSED` after delivery | Billed time, billed amount, released amount, retention end |
| Task finished / failed (P1) | Task report | Exit code, last log lines, end-or-keep action taken |

## P1 Managed launch

### What the customer sets

The customer sets this at purchase, or later in Manage while the order is still waiting:

- **Script**: a bash script run as the SSH user (`ubuntu`) in `/home/ubuntu`, up to 64 KiB.
  Docker images are started from the script (`docker run --gpus all …`).
- **Environment**: plain variables, at most 50.
- **Secrets**: named values, such as an HF token or S3 keys. They are encrypted in the bot
  database, never shown again, and redacted from logs. At most 20.
- **When the task succeeds** (exit 0): `end` (default) or `keep`.
- **When the task fails** (non-zero exit, or killed): `end` or `keep`, with no default; the
  customer must choose.
- **After a server replacement**: `rerun` (default) or `do nothing`.
- **Optional time limit**: the task is stopped after N minutes and treated as failed.

`keep` means the server runs until `expires_at` or until the customer presses END. Usage
billing continues for that time.

### Rental API (bot)

- `PUT /v1/rentals/{id}/task` takes `{script, env, secrets, on_success, on_failure,
  on_replacement, max_minutes}`. It works like `ssh-keys`: a versioned document on the rental
  row (`task: {version, …}`), rejected once the rental has ended.
- The rental view returns `task_state` (below) without the script body or secrets.
- `POST /v1/rentals/{id}/task/stop` stops a running task. It leaves the server running.

### Guest agent (`spotbot/guest_agent.py`)

- `agent_report` returns `task: {version, attempt, script, env, secrets}` once the current
  generation is verified. `attempt` is the generation number, so a replacement can be told
  apart from a retry on the same server.
- The agent writes the script to `/var/lib/spotbot/task/<version>-<attempt>/run.sh`. It writes
  the environment and secrets to a 0600 env file owned by the SSH user.
- It starts the task with `systemd-run --unit spotbot-task-<version>-<attempt>
  --uid ubuntu`. Output goes to `/var/log/spotbot-task.log` on the root disk, so it is part
  of every backup.
- The script receives `SPOTBOT_ATTEMPT` and `SPOTBOT_RESUMED=1` on a replacement, so it can
  continue from its own checkpoint.
- On a Spot interruption warning, the agent sends SIGTERM to the unit, giving the task the
  two-minute notice to checkpoint.
- The agent's report gains `task: {version, attempt, state, exit_code, started_at,
  finished_at, log_tail}`:
  - `state` is `running`, `succeeded`, `failed` or `stopped`.
  - `log_tail` is the last 4 KiB of the log, with secret values redacted.
- After a reboot, the agent does not start the task again unless the bot sends a new
  `attempt`.

### Bot policy (`spotbot/rentals.py`)

- When a report shows a finished attempt for the current task version, the bot applies the
  policy exactly once per attempt:
  - `succeeded` with `on_success=end`, or `failed` with `on_failure=end`: `release()`, with
    `end_reason=task_succeeded|task_failed`.
  - `keep`: nothing changes. The notifier sends the result with an END link.
- The policy only ends rentals; it never extends them or starts new purchases.

### Terminal UI (OPENNEXT-DAVID)

- Buy Now gets a collapsed **Autopilot** section with the fields above. The success and failure
  choices are radio groups. A failure choice is required once a script is present.
- Manage shows the task state, the last log lines, and Stop / Edit while the order is waiting.
- The instance list labels ended orders with the reason ("Ended after the task finished").

### Security

- The script runs only on the customer's own server, as the customer's SSH user. The bot never
  executes customer code anywhere else.
- Secrets reach only the agent, over the guest callback (HTTPS outside loopback). They are
  encrypted at rest with `SPOTBOT_OPENNEXT_SECRET_KEY` and deleted when the rental closes.
- Log tails come from customer code. They are shown as plain text and never interpreted.

### As built

- The Terminal sets the task in Manage → Autopilot, not at checkout. Every purchase waits for
  capacity first, and the task can be set or changed until its first run starts, also on an
  order that is already running. Checkout and Direct Pay stay unchanged.
- The bot's routes are `GET/PUT/DELETE /v1/rentals/{id}/task` and `POST …/task/stop`; the key is
  `SPOTBOT_RENTAL_TASK_KEY`, held by the bot (the adapter never stores task secrets).
- The variables file is `/var/lib/spotbot/task/<version>-<attempt>/env.sh` (0600, owned by the
  SSH user), sourced by the unit's command line and deleted when the run finishes. The log is
  `/var/log/spotbot-task/<version>-<attempt>.log` (0640, root and the SSH user's group).
- A run that ends while the server is being replaced or ended is recorded as `interrupted` and
  never triggers the end-or-keep policy. With `on_replacement=none` its outcome becomes
  `interrupted` once the replacement is running.
- A run whose unit disappeared (the server rebooted) is `stopped`: the policy never ends a
  server because of a reboot.
- A cost cap for `keep` is not built: `keep` lasts at most until the order's paid time ends,
  which the customer already chose at purchase.
- Docker containers started with `-d` outlive Stop and the time limit; scripts should run them in
  the foreground (`docker run --rm …`), so SIGTERM reaches them.
- Verified on a real systemd host: success, failure, Stop, SIGTERM before a Spot interruption,
  the time limit, variable quoting, secret redaction and restart idempotency.

## Later

- **P2, idle end.** Add GPU utilization to the agent report (`nvidia-smi
  --query-gpu=utilization.gpu`); this also fills the Terminal's "Awaiting telemetry" panel.
  Policy: end, or notify, after N minutes below X%.
- **P3, AI assistant.** Turn a plain-language request into a task document the customer
  confirms, and explain failures from the log tail. The executed task is always the confirmed
  document. The model never gets shell or END access.

## Decisions needed

1. ~~Billing granularity and minimum~~ Decided: per minute, with a 1-hour minimum once a
   server was delivered.
2. ~~Retention for orders ended by autopilot~~ Decided: every closed order keeps only its final
   snapshot for 7 days; its volumes are deleted once that snapshot is available.
3. P0 channels: email only, or email plus customer webhook.
4. Whether a customer may still choose `keep` when the task fails and nobody is watching. A
   "keep for at most N hours" option would bound the cost.
