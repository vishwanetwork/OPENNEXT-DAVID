# Buyer Terminal design QA — iteration 6

final result: passed

## Scope and reference

The user requested removal of visible middle dots and the repeated “Spot” result
label, more space between dropdown arrows and their right borders, and an All
checkbox that actually checks all filter options. This iteration applies those
changes within Buyer Terminal while retaining the original product flows.

- Before: `../qa-v6/before-market.png`.
- Desktop Market: `../qa-v6/market-filters-desktop.png`.
- Mobile Market: `../qa-v6/market-filters-mobile.png`.
- RFQ controls: `../qa-v6/rfq-dropdowns.png`.
- Market Insight: `../qa-v6/insight-desktop.png`.
- Previous thumbnail QA: `../qa-v6/previous-design-qa.md`.
- Review: `http://localhost:5194/terminal/demo/market?role=buyer`.

## Findings and corrections

No actionable P0/P1/P2 issue remains in the reviewed scope.

1. Buyer-facing middle-dot separators are removed from visible copy and the
   CSS-generated legend separator. The Market result label now displays the offer
   count without repeating the active term.
2. Native single-select dropdowns use a consistent chevron inset of 16px and 44px
   right padding. Labels retain their space beside the arrow. Filter disclosures
   align to the same inset; the compact RFQ history selector accommodates its
   longer labels. Native keyboard/touch behavior is retained, with a native-arrow
   fallback for forced-color mode.
3. All and individual filter checkboxes are synchronized. Selecting All selects
   every option in the group, including options outside the current search text.
   Partial selection displays a mixed state. Clearing All leaves every child
   unchecked and produces zero matching results; Reset restores the default
   unrestricted selection. Selecting every child marks All checked.
4. Market Insight's Index model remains independent of the resource table filter
   selection. The control's purpose and the existing backend data flow are retained.
5. Desktop/mobile Market, RFQ dropdowns and Insight evidence cover the updated
   spacing and content. No extra helper labels or decorative text were added.

## Validation

- Formatting passed.
- Lint passed with zero errors and three existing max-lines warnings.
- Typecheck passed.
- Full test run passed 426 tests: 418 web and 8 contracts.
- A regional-history backend-label regression test added after that run passed in
  its focused 12-test suite. Current coverage is 427 tests; the complete suite was
  not rerun after that one test was added.
- Production build passed.

The original APIs, contract package, backend logic, routing and isolated-preview
safeguards are unchanged. No real transactions, live publication or GitHub push
occurred. The source patch and integration bundle are local handoff artifacts.

## Current integration QA — landing, Buyer Terminal and authentication

Verified on 2026-10-31. This section records the current integrated release;
the iteration 6 findings and counts above are historical.

### Scope and results

The approved landing page and Buyer Terminal now run in the same Next.js
application, with upstream changes through `f086fa5` retained. All Open Terminal
and Buy capacity buttons use the existing host-aware Buyer Market destination:
`https://terminal.opennextlab.ai/market?role=buyer` on the configured public site,
or `/terminal/market?role=buyer` on a local or unconfigured staging host. They do
not enter an isolated demo route or submit a purchase.

- On the standalone production server at `http://localhost:5197`, the homepage
  rendered correctly and Open Terminal reached the actual authentication gate.
  The isolated Buyer Market also rendered correctly. Buyer Sign out returned to
  the new homepage at `/`, and Seller remained disabled in the account menu.
- At 390×844, the homepage and mobile navigation rendered correctly; Open Terminal
  reached the new login page. Screenshots in `../qa-integration/` include
  `homepage.png`, `login.png`, `buyer-market.png`, `homepage-mobile.png` and
  `login-mobile.png`.
- Development-server checks on the same source verified Buy capacity navigation,
  query preservation when switching between sign-in and sign-up, and return to
  the new homepage.
- Authentication tests verified email verification, session handling, logout and
  onboarding, including rejection of an empty verification response. The existing
  server session and authentication gates remain in place.
- Scoped landing and Buyer styles retain separate visual treatments. Existing
  backend adapters, API contracts, CSRF forwarding, production host routing and
  deployment configuration are unchanged relative to upstream main.

### Validation

- Formatting passed.
- Lint passed with zero errors and three pre-existing max-lines warnings.
- Typecheck passed.
- Web coverage passed: 78 test files, 437 tests; statements 69.58%, branches 77.36%,
  functions 63.34%.
- Contracts passed: 8 tests.
- Legacy backend passed: 668 tests.
- Adapter passed: 3 tests.
- `pnpm build` passed the production build.

Browser checks used the real anonymous authentication gate and the existing
isolated local backend for the Buyer UI. No live OAuth authorization, production
email delivery, payment or GPU provisioning was exercised.

The requested release uses the existing official domains and deployment workflow.
No GitHub push or PR has been created at this checkpoint because GitHub credentials
are unavailable. Creating a PR alone does not publish the release; merging to main
triggers the existing deployment workflow. See
`docs/LANDING_TERMINAL_INTEGRATION.md` for the route and authentication details.
