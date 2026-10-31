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
