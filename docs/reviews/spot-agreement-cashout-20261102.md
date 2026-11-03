# Spot agreement and Cashout implementation review

Base: `origin/main` at `a4b3849f0e7ff9fbb74021a758f61508b9bfb0ec`.
Branch: `codex/spot-agreement-cashout-20261102`. Publication scope is this branch and a
draft PR; production activation and merging remain gated by the backend prerequisites.

## Delivered scope

- Revised English DOCX, 35 mapped autofill fields after confirming the provider name,
  and eight canonical clauses matching the UI.
- Agreement review between payment-method selection and payment, verified KYB/order binding,
  explicit signature consent and fail-closed agreement-linked monetary ports.
- Buyer Billing Cashout, KYB-matched beneficiary, validated international bank fields,
  server-authoritative eligible balance and masked request history.
- Console Cashout Requests with private bank details, audited Completed confirmation,
  reservation/notification/email acknowledgment validation and idempotent retries.
- Backend handoff in `docs/SPOT_AGREEMENT_CASHOUT_HANDOFF.md`. No legacy, deployment,
  routing or wire-contract modification. No production signing/payout adapter was invented.

## Final alignment and publication review

The agreement document and order summary now share one intrinsically sized grid row
on desktop, aligning both top and bottom edges. Size containment keeps the long
contract internally scrollable without forcing the row to the entire document height.
At 720px and below the existing stacked layout and bounded contract scroll are retained.

Eight browser checks passed: desktop and breakpoint widths (1440, 1024, 721), stacked
widths (720, 390), long summary text, 200% desktop text zoom and 150% mobile text zoom.
Matching desktop edges, no horizontal overflow, final clause accessibility and signing
action accessibility were verified with the actual components and blocked-network
synthetic fixtures. Screenshots and local demonstration harnesses are not committed.

The reviewed Bitfintech Word template and its 35-field mapping are included under
`docs/legal/`. The DOCX checksum matches the previously delivered, visually reviewed
artifact. No customer-filled document or signature is included.

The pre-publication review also identified two boundary cases for regression coverage:
an earlier ambiguous purchase must remain frozen when a retry fails with HTTP 4xx
before payment dispatch, and Console Cashout validation must accept the same safe
nonnegative revisions and masked-account formats as the Buyer submission model.
These corrections do not change pricing or authorize a payout.

### Final upload checks

- Formatting passed. Web lint passed with zero errors and the same three existing
  file-length warnings; contracts formatting lint passed.
- Web and contracts TypeScript passed.
- Web coverage run passed: 96 suites / 543 tests. Coverage: statements and lines
  70.50%, branches 78.17%, functions 63.94%; all configured thresholds passed.
- Contracts: 2 suites / 10 tests passed. Legacy regression: 668 tests passed.
- Adapter image-pin checks: 3 tests passed. Deployment shell syntax checks passed.
- Production Next.js build passed, including `/admin/cashouts`.
- `git diff --check` passed. Local Demo harnesses, screenshots, rendered documents
  and customer-filled agreements are excluded from the upload.
- Deployment Python tests cannot be validated on this Windows host: ten existing
  Linux-path validation cases errored, and the Docker Compose case was skipped
  because Docker Compose is unavailable. No deployment source was modified; these
  checks must pass in the Ubuntu GitHub CI job before merge.

The upload contains the frontend and interface handoff only. A draft PR is used;
production signing, payments and Cashout activation remain blocked on the documented
backend and business-policy prerequisites. No merge or deployment is part of this task.

## Initial implementation verification

- `pnpm format`: passed; unrelated files unchanged.
- Web ESLint: zero errors, three existing file-length warnings (static catalog, model quotes,
  and the exempt Spot checkout engine).
- Web and contracts TypeScript: passed.
- Web Vitest: 96 suites / 530 tests passed (`--maxWorkers=2`).
- Contracts Vitest: 2 suites / 10 tests passed; formatting lint passed.
- `pnpm test:legacy`: 668 tests passed; legacy source unchanged.
- Production Next.js build: passed, including `/admin/cashouts`.
- `git diff --check`: passed. New feature source contains no Chinese text.
- DOCX: three rendered pages inspected; original file unchanged. Canonical LibreOffice
  renderer unavailable on this Windows runtime; read-only Word PDF export used for QA.
- Visual QA: actual agreement/Cashout components and current Terminal styles inspected at
  1440 x 1100 and 390 x 844. No horizontal overflow or browser errors; mobile scrolling
  reaches all actions. The isolated harness used synthetic in-memory fixtures and blocked
  all network access; it is not a live signed contract or financial state.
- Independent review fixed a pre-dispatch rejection incorrectly locking payment as pending,
  and removed unverified representative-authorization wording. Regression tests cover both
  first-attempt local refusal and retaining a prior ambiguous payment.

Root pnpm recursive scripts use quoted glob filters which matched no projects on this Windows
shell. Actual lint/test/typecheck/build were therefore run explicitly against each package.
Initial sandbox runs blocked test-only localhost calls and atomic temporary-file renames;
normal-permission reruns passed. Earlier full-suite runs overlapped active source edits and
resource-heavy builds; the final run above used finished source and two workers.

## Release gates

This is the agreed frontend/interface-handoff scope, not a live financial rollout. New Spot
payment cannot bypass the missing agreement service. Cashout is unavailable until the ledger
reservation, operator payout completion and transactional notice/email outbox exist.
The business owner supplied the complete legal entity name, Bitfintech Group Limited.
Confirm signatory authority,
obtain final legal/policy review, and verify durable data preservation before activating signing.

## Cumulative runtime clarification

The business owner confirmed that a 72-hour purchase ends after 72 cumulative hours
of available instance time. The runtime clock starts automatically when provisioned
capacity is ready, not when the Buyer connects or starts work. Idle available time
counts; interruptions pause runtime and billing, and replacement resumes the remaining
hours. The frontend agreement, version validator, fixture and backend handoff now use
`opennext-spot-runtime-v2` / `cumulative-running-time`. Historical executed policies
are not rewritten, and actual metering still requires backend integration.

Files changed for this clarification:

- `apps/web/src/lib/spot-agreement.ts`
- `apps/web/src/features/agreements/validation.ts`
- `apps/web/src/features/agreements/terms.ts`
- `apps/web/src/features/agreements/components/agreement-document.tsx`
- `apps/web/src/features/agreements/components/agreement-review.tsx`
- `apps/web/src/features/agreements/agreement-review.test.tsx`
- `apps/web/src/test/spot-agreement-fixture.ts`
- `docs/API_CONTRACT.md`
- `docs/SPOT_AGREEMENT_CASHOUT_HANDOFF.md`
- `docs/reviews/spot-agreement-cashout-20261102.md`

The cumulative-runtime DOCX is a separate local artifact; the previous version and
original supplied agreement are preserved. All eight clauses match the current UI
verbatim, 36 autofill fields match their typed mappings, and all three rendered pages
passed visual review. Desktop and mobile UI inspection found no horizontal overflow
or browser errors. Word PDF export was used because this runtime has no bundled
LibreOffice.

Clarification checks: formatting passed; Web ESLint has zero errors and the same
three pre-existing file-length warnings; Web and contracts TypeScript passed; Web
Vitest passed 96 suites / 532 tests, including two new policy/summary regressions;
contracts passed 2 suites / 10 tests and formatting lint. Legacy regression passed
668 tests, production build passed, and `git diff --check` passed. The initial
sandboxed build could not create Next.js standalone output (`EPERM`); the normal-
permission rerun passed. No source workaround, dependency or deployment change was
needed. No commit, push or merge was performed for this clarification.

## Changed repository files

### Legal name confirmation

The confirmed legal name is Bitfintech Group Limited (OpenNEXT brand), BVI company
number 2180739. The shared company constant, agreement preview and test fixture now
use that name, and prepared documents with a different legal name fail validation.
This does not approve signatory authority, replace Stable X Limited bank instructions,
or activate an unsigned/unconnected payment service. Canonical v2 clauses and runtime
policy are unchanged. A separately named local DOCX replaces the legal-name merge
placeholder while preserving all prior outputs.

The local Word revision changes only the provider-name text in `word/document.xml`;
the other 17 package parts are byte-identical, and the remaining 35 merge fields are
preserved. All three pages were rendered and inspected; only the name area on page 1
changed visually. The requested payment-stage screenshot uses the actual agreement
component and current Terminal CSS with a synthetic 72-hour H100 order. Network calls
are blocked; no signature or payment was submitted. It is not production account data.

Verification: formatting passed; Web ESLint has zero errors and the same three
pre-existing file-length warnings; Web/contracts TypeScript passed; Web Vitest passed
96 suites / 534 tests; contracts passed 2 suites / 10 tests and formatting lint; legacy
passed 668 tests. Production build and `git diff --check` passed. No backend,
routing, deployment or wire-contract files changed, and no commit or push occurred.

Files changed for this clarification:

- `apps/web/src/lib/spot-agreement.ts`
- `apps/web/src/features/agreements/validation.ts`
- `apps/web/src/features/agreements/components/agreement-document.tsx`
- `apps/web/src/features/agreements/agreement-review.test.tsx`
- `apps/web/src/test/spot-agreement-fixture.ts`
- `docs/SPOT_AGREEMENT_CASHOUT_HANDOFF.md`
- `docs/reviews/spot-agreement-cashout-20261102.md`

### Full feature file inventory

- `apps/web/src/app/admin/cashouts/page.tsx`
- `apps/web/src/app/terminal/terminal-app.tsx`
- `apps/web/src/features/agreements/agreement-review.test.tsx`
- `apps/web/src/features/agreements/agreements.css`
- `apps/web/src/features/agreements/api.ts`
- `apps/web/src/features/agreements/components/agreement-document.tsx`
- `apps/web/src/features/agreements/components/agreement-review.tsx`
- `apps/web/src/features/agreements/hooks.ts`
- `apps/web/src/features/agreements/index.ts`
- `apps/web/src/features/agreements/terms.ts`
- `apps/web/src/features/agreements/validation.ts`
- `apps/web/src/features/bank-transfer/hooks.ts`
- `apps/web/src/features/billing/billing.test.tsx`
- `apps/web/src/features/billing/components/billing-page.tsx`
- `apps/web/src/features/cashout/api.ts`
- `apps/web/src/features/cashout/cashout.css`
- `apps/web/src/features/cashout/cashout.test.tsx`
- `apps/web/src/features/cashout/components/bank-fields.tsx`
- `apps/web/src/features/cashout/components/cashout-form.tsx`
- `apps/web/src/features/cashout/components/history.tsx`
- `apps/web/src/features/cashout/components/modals.tsx`
- `apps/web/src/features/cashout/hooks.ts`
- `apps/web/src/features/cashout/index.ts`
- `apps/web/src/features/cashout/test-fixtures.ts`
- `apps/web/src/features/cashout/validation.test.ts`
- `apps/web/src/features/cashout/validation.ts`
- `apps/web/src/features/console-cashouts/cashouts.css`
- `apps/web/src/features/console-cashouts/fixtures.test-data.ts`
- `apps/web/src/features/console-cashouts/hooks.ts`
- `apps/web/src/features/console-cashouts/index.ts`
- `apps/web/src/features/console-cashouts/page.test.tsx`
- `apps/web/src/features/console-cashouts/page.tsx`
- `apps/web/src/features/console-cashouts/request-dialog.tsx`
- `apps/web/src/features/console-cashouts/validation.test.ts`
- `apps/web/src/features/console-cashouts/validation.ts`
- `apps/web/src/features/console/console.test.tsx`
- `apps/web/src/features/console/pages.ts`
- `apps/web/src/features/console/pages/operations-pages.test.tsx`
- `apps/web/src/features/console/pages/requests.tsx`
- `apps/web/src/features/spot-market/agreement-payment.test.ts`
- `apps/web/src/features/spot-market/agreement-payment.ts`
- `apps/web/src/features/spot-market/checkout.test.ts`
- `apps/web/src/features/spot-market/checkout.ts`
- `apps/web/src/features/spot-market/components/agreement-modal.tsx`
- `apps/web/src/features/spot-market/components/checkout-modals.tsx`
- `apps/web/src/features/spot-market/hooks.tsx`
- `apps/web/src/features/spot-market/purchase.test.tsx`
- `apps/web/src/lib/api/query-keys.ts`
- `apps/web/src/lib/cashout.ts`
- `apps/web/src/lib/spot-agreement.ts`
- `apps/web/src/terminal-kit/services.ts`
- `apps/web/src/test/spot-agreement-fixture.ts`
- `docs/API_CONTRACT.md`
- `docs/SPOT_AGREEMENT_CASHOUT_HANDOFF.md`
- `docs/legal/spot-rental-agreement-en.docx`
- `docs/legal/spot-rental-agreement-fields.md`
- `docs/reviews/spot-agreement-cashout-20261102.md`
