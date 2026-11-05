# Console account and review adapters

These adapters implement OPENNEXT-DAVID PR #15. Deploy the backend before the new frontend.
`/api/admin/operations/session` advertises `accounts-v1`, `kyb-bundle-v1` and
`direct-pay-continuation-v1`; clients keep unsupported actions disabled on older backends.
Operator endpoints require an administrator session. Writes enforce the Console origin;
customer writes require their verified session's CSRF token. Responses are private and no-store.

## Account records

`GET /api/admin/accounts?userIds=u1,u2` accepts at most 100 accounts. Details are available at
`GET /api/admin/accounts/{id}?creditCursor=&purchaseCursor=` with independent histories of
50 entries per page, session scope and as-of time. Reads are audited.

Random stable Account # values are assigned lazily in the configured workflow database; they
contain no email or derived user identifier. Balances use the Terminal's promotional/paid Credit,
confirmed receipts and purchase holds. Configure the existing shared legacy data directory.
Missing initialized or inconsistent ledgers fail closed. Bank accounts are null because no
customer bank enrollment source exists. Do not substitute the platform receiving bank.
Historical balance-after stays null where current snapshots cannot reconstruct it.

## KYB package download

`GET /api/admin/buyer-kyb/{case}/bundle?accountId={owner}&revision={revision}` returns JSON
metadata and a base64 ZIP for the JSON API client. It contains `submitted-form.pdf`, all original
files, and `manifest.json`. Submitted fields and consent are frozen at submission. Historical
records without a consent snapshot explicitly say that consent was not recorded.

Authorization, owner and revision are checked before decrypting originals. SHA-256 integrity,
safe unique archive paths, archive contents, malware scan and final revision checks precede
download. Scan failure refuses the export; the existing explicit development-only unscanned
mode remains available. Audit records include the archive hash. There are no public URLs or
persistent unencrypted exports. ZIP size is limited to 100 MiB, PDF to 20 MiB, originals to 50 MiB.

Runtime images include an embedded Unicode font. Other installations may set
`OPENNEXT_KYB_PDF_FONT` to a readable TrueType font/collection covering submitted languages.
Unsupported characters refuse export instead of silently losing fields.

## Paid continuation

`POST /api/admin/payment-requests/{id}/complete` uses the existing decision fields with
Confirm and fundsVerified=true. The operator verifies the entire immutable USD bank receipt;
this is a manual acknowledgment, not automatic bank reconciliation.

The adapter calls tenant-protected `POST /v1/rentals/preflight` using the original model, region,
instance type, duration and supplier price ceiling. This refreshes provider quota and Spot price,
never allocates, and cannot reserve or guarantee Spot stock. Unknown provider/network/auth
errors return 503 without changing the receipt.

- Ineligible capacity or expired payment instructions: confirm and credit the full receipt,
  including its original fee, exactly once. No additional conversion fee.
- Eligible: confirm and issue an owner-bound single-use paid intent, valid seven days. No
  instance or Credit debit yet. Decision, notification and email outbox commit together.
- `GET /api/billing/paid-purchases` lists only the verified Buyer's continuations.
- `POST /api/billing/paid-purchases/{id}/redeem` accepts idempotencyKey, checks owner/KYB,
  rechecks provider eligibility, and consumes the intent. The request cannot change terms.
  Lost eligibility or expiry converts the entire receipt to Credit.
- The durable redeeming state survives restart. Maintenance writes the original usage hold
  before making receipt funding available, then submits the idempotent rental. Repeated clicks
  cannot charge or provision twice. Credit checkout cannot use reserved direct-pay references.
- Definitive submission failure releases the whole payment and queues its notice atomically
  with the failed transfer state. Uncertain outcomes stay pending and reconcile the original
  reference. After acceptance, existing acquisition/delivery deadlines and usage billing apply:
  an undelivered closed rental releases its entire hold; delivered use retains its accepted fee terms (zero on new orders).
- Maintenance expires unused paid intents to Credit. Expiry and redemption compete through
  the same compare-and-swap record. Never both credit and allocate.

Terminal shows the continuation in Instances with loading/error feedback. Customers can leave
after submitting. Existing SSH-key management and delivery notices apply. Top-ups remain 1:1;
Fail requires a private reason and queues both notification and email. Queued does not mean
delivered: SMTP delivery uses the existing notifier's retries and persisted attempt/state records.

The legacy Direct Pay decision endpoint retains automatic provisioning for older clients;
new clients use complete. Old transfers without immutable pricing snapshots require
reconciliation, not repricing. Run one adapter process, as required by the existing Credit ledger;
versioned new workflows do not make unrelated legacy balance writes safe across multiple adapters.
