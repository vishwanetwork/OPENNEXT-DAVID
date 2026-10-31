# Operations Console integration

The Console and Terminal use the same OpenNEXT adapter and administrator session.
The legacy backend remains the owner of authentication and RFQ records; the adapter
owns rentals, payment review, usage settlement and the new operations projections.

## Delivery plan

1. Add protected user, order, overview and audit projections. Read the legacy account
   and marketplace snapshots from an explicitly configured shared data directory,
   without modifying them. Return only allowlisted fields, never sessions or identities.
2. Persist provider credentials encrypted in the adapter database. Restore them to the
   existing collector after a restart. Retain real collector capabilities and history;
   a registered provider is not necessarily implemented or configured.
3. Expose real Bot health, provider status, rental lifecycle and usage billing. Allow
   only bounded, audited maintenance actions, with same-origin checks and idempotency.
   Existing RFQs, monetary policy and running customer tasks are unchanged.
4. Connect the existing Console layouts to these APIs, including authentication,
   loading, empty/error states, pagination and refresh. Remove fabricated cost and
   local execution data from live operations pages.
5. Review and test authorization, secret handling, restart recovery, reconciliation
   and the customer-to-operator-to-customer flow. Open separate backend and frontend
   pull requests; pin the bundled adapter to the reviewed backend commit.

## Invariants

- The existing face-value top-up and checkout fee rules remain unchanged.
- Writes require a verified administrator session and the correct browser origin.
- Credentials never appear in API responses, logs, browser storage or audit details.
- Missing dependencies produce explicit unavailable states, never fabricated zeroes.
- Displayed prices do not constitute deployable inventory or a quota guarantee.
- Snapshot reads are transitional and local-only. Remote legacy deployments must
  configure a trusted shared snapshot or implement a future account directory API.
- Tests use local fixtures and fake cloud services; they must not provision GPUs or
  send production customer emails.

## Deployment

Run the updated `spotbot opennext-api` adapter in front of the existing backend.
Set `SPOTBOT_OPENNEXT_LEGACY_DATA_DIR` to the shared private directory containing
`auth-state.json` and `marketplace.json`. The adapter only reads these files. An
unavailable or malformed snapshot returns 503 instead of an empty account directory.

Set `SPOTBOT_OPENNEXT_CONSOLE_KEY` to an independent base64-encoded random 32-byte
key. Keep it in the deployment secret manager and retain it across restarts.
Provider credentials are AES-256-GCM encrypted in the configured workflow database,
bound to their provider ID, and never returned to the browser. Environment-supplied
provider keys continue to work. Database-saved keys override those environment keys.

The single adapter maintenance loop restores keys into the existing collector every
30 seconds, including after an independent collector restart. Local private legacy
listeners without configured host routing use their existing loopback policy. A
deployment with `ADMIN_HOST`, or a remote legacy service, requires
`OPENNEXT_ADMIN_TOKEN` in the adapter environment. The production host route uses
that configured administrator Host and its existing trusted proxy transport. No browser cookie is saved
for background use. Provider enablement, cadence, observations and run history remain
owned by the existing collector and its persistent data directory.

`POST /api/admin/agent/actions` accepts only `reconcile` plus an idempotency key.
It queues a durable job that retries already-paid work and settles existing usage;
it cannot create a fresh purchase or alter a running RFQ. Customer billing summaries
are ledger projections, not provider invoices. The current fee policy is unchanged.

Overview counters are calculated from complete records. Collector, contact, market
and rental dependencies fail independently; unavailable figures are null, never zero.
The audit projection includes legacy marketplace events and server review decisions.

The frontend repository includes `scripts/console-flow.test.cjs`. With
`SPOTBOT_TEST_ROOT` and `SPOTBOT_TEST_PYTHON` pointing at this checkout and its Python
runtime, it starts both services on ephemeral loopback ports and verifies login,
credential persistence, collection, Terminal catalog reads and restart restoration.
Provider HTTP responses are fixtures; no real cloud or email service is contacted.

## Order and payment history

Orders default to all lifecycle states. Explicit processing/completed/cancelled filters
remain available. Historical rentals, orphaned charge records and Direct Pay references
are joined without hiding ended instances. The agreed order limit is displayed separately
from the final ledger settlement. Bank-receipt reviews remain in the Direct Pay queue;
a separate administrator-only, read-only Credit purchase ledger shows holds, settlements
and released amounts. Direct Pay usage holds are excluded from that Credit projection.
No reads mutate balances, approval decisions, fees or provisioning state.
