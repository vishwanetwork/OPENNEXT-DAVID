# Terminal submissions and the Operations Console

RFQs and supply submissions share one canonical backend record. The Terminal writes the record; the Console reads the same record and its server-issued receipt. There is no browser-to-browser synchronization or client-side write to an administrator endpoint.

## Submission contract

| Operation | Endpoint | Response |
| --- | --- | --- |
| Create an RFQ | `POST /api/marketplace/rfqs` | `201 { "rfq": record }` |
| Edit an owned RFQ | `PATCH /api/marketplace/rfqs/:id` | `200 { "rfq": record }` |
| Create a supply submission | `POST /api/marketplace/supplies` | `201 { "supply": record }` |
| Request Agent installation | `POST /api/marketplace/supplies/:id/agent` | Installation status and integration message |
| Reload the user's workspace | `GET /api/marketplace/me` | Owned records, review, orders and notifications |
| Read the operations inbox | `GET /api/admin/marketplace` | RFQs, supplies, KYB, homepage reviews, audit and `generatedAt` |

Keep the existing record fields and response envelopes when replacing the file adapter with a database. Rental prices are USD per GPU-hour; physical GPU prices are USD per GPU; model RFQ budgets are total request budgets. Do not relabel model submission prices as per-token rates without an explicit unit contract.

Each accepted create includes a server-generated receipt, persisted atomically with the record:

```json
{
  "id": "RFQ-0123456789ABCDEF",
  "status": "Open",
  "submission": {
    "receiptId": "RCPT-0123456789ABCDEF",
    "source": "terminal",
    "status": "Received",
    "receivedAt": "2026-10-18T08:00:00.000Z",
    "updatedAt": "2026-10-18T08:00:00.000Z",
    "revision": 1
  }
}
```

`Received` means durably stored and available to operations. It does not mean a human has read it, a supplier has been approved, an offer has been published, or payment has completed. Editing an RFQ preserves its record ID, receipt ID and original `receivedAt`, while increasing the revision and updating `updatedAt`.

The server derives account identity from the verified session. Client-supplied ownership, receipt, review and publication fields are not authoritative. Private RFQs appear only in authorized account/operations views, not the public marketplace.

## Retries and partial failures

- Create forms send an optional `clientSubmissionId` (8–128 characters: letters, digits, `.`, `_`, `:`, `-`). Keep it stable when retrying the same submission.
- The backend deduplicates by verified owner, resource collection and identifier. Identical retries return the original record. Reusing an identifier with different accepted fields returns `409`.
- The database replacement must enforce this uniqueness transactionally across processes. The current private file adapter serializes writes within a single process only.
- RFQ edits use `PATCH` on the existing ID, not a new submission identifier.
- Double clicks are suppressed while the form is submitting. Validation/authentication failures preserve the form and do not fabricate a browser record.
- Once the create response contains a record ID, later workspace-refresh or Agent-request failure must not invite another create. Show the saved reference and a recovery message.
- A saved response without a valid receipt is shown as saved but operations receipt unconfirmed. Do not fabricate confirmation to support a legacy response.

After an ambiguous network failure, retry the unchanged form. If details must change and a retry returns `409`, first check My RFQs/My Supply for the original record; edit the existing RFQ or intentionally open a new submission.

## Supply gates

Verified Seller → KYB submission → operations approval → supply submission → Agent installation → verified callback → publication.

A saved supply appears in Console immediately with `Awaiting agent`. Agent installation is a separate step: an unavailable installer does not remove the submission or publish capacity. No private SSH keys are accepted. Console lists strip SSH host/user values and show whether connection details were provided. Homepage promotion still requires its existing independent operations approval.

## Console behavior

RFQs and Supply show record IDs, verified account information, market-specific quantities/prices, received/updated times, receipt revisions and full requirements. Search and market/status filters are client-side views of the authorized snapshot.

The inbox refreshes every 30 seconds while visible, when the window regains focus, and on manual refresh. Requests are coalesced; navigation aborts pending reads. A failed refresh keeps the last successful snapshot with a visible stale-data warning. An expired administrator session clears private records and requests sign-in.

## Isolated Demo submissions

The Console's separate **Demo submissions** page is a test inbox, not the production marketplace. Its admin API is `GET /api/admin/demo/marketplace`; Demo KYB decisions use `PATCH /api/admin/demo/marketplace/kyb/:id` with the row's `workspaceId` and the decision fields.

Demo records belong to individual, short-lived guest workspaces (two hours by default). Only guest-created submissions appear in this inbox, not the preloaded showcase fixtures. The administrator can approve a Demo KYB to test supply submission; this does not approve a production Seller. Demo submissions never enter production records, homepage review or real payment/Agent execution. Expiry, Demo logout or application restart removes access to these test records. Never treat this transient store as an audit archive.

Open **Console → Demo submissions** (`/#demoSubmissions` on the Console host), then choose Buyer RFQs, Supplier capacity or Supplier KYB. Record ID and receipt ID correlate with the guest Terminal confirmation; `workspaceId` identifies the isolated test session. If Terminal and Console run in different application processes, provide a shared, separately scoped Demo store and session registry before using this test inbox across them.

## Backend handoff

1. Connect the configured OAuth/email verification adapter. Unconfigured authentication stays unavailable; do not add a route accepting a client-provided verified identity.
2. Route Terminal writes and Console reads to the same transactional storage/service. Separate application replicas must not each maintain an independent file cache.
3. Preserve session ownership, CSRF/origin validation and administrator authorization. Administrative APIs must remain unavailable on the public Terminal host.
4. Replace private-file persistence with a durable database, retain receipt/idempotency semantics, and add operational monitoring, backups and production administrator RBAC.
5. Connect the Agent installation adapter and authenticated callback. Keep supply unpublished until KYB approval and verified installation succeed.
6. Preserve the separate Demo namespace and test inbox. Do not copy Demo submissions into production to make a test visible.

The existing `OpenNEXT-auth-service.cjs`, `OpenNEXT-marketplace-service.cjs` and `OpenNEXT-preview-server.cjs` define the adapter and routing boundaries. No API keys or credentials belong in browser assets or this document.

## Acceptance checks

- Submit an RFQ from a verified Buyer: My RFQs and Console show the same ID and receipt.
- Edit it: Console updates one record, with the same receipt and a newer revision.
- Retry a create: there is still one record and no duplicate audit submission.
- Submit supply from a KYB-approved Seller: Console receives it even when the installer is unavailable; public listings remain unchanged.
- Simulate a post-save refresh failure: the Terminal retains the saved reference and warns against resubmitting.
- Submit in Demo: only the Demo inbox changes. Approve Demo KYB and submit capacity without affecting production.
- Check an unauthorized browser: it cannot read either operations inbox or decide KYB reviews.

Run `npm test` and `npm run check`. Integration tests use isolated temporary data and test-only authentication adapters, never a production authentication bypass.
