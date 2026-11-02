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

## Partner and program module — 2026-11-01

### Reference and placement

The product owner's supplied partner slide is the content reference. The owner
confirmed Pharos, Fidelity Labs, Ondo and Solana as partners. The module follows
the existing team experience metrics and precedes the closing call to action.
The earlier integration PR #12 has since merged; this addition is based on main
at `489046a` and retains the subsequent Console work.

The slide's heavy green cards were intentionally adapted to the approved landing
design: white background, monochrome logos, fine dividers and the existing font.
Programs are grouped separately from partners, with their supplied program names.
No decorative descriptions, badges, pagination or middle-dot separators were added.

### Visual verification

- Reference and implementation screenshots were inspected together. Artwork,
  typography, spacing, colors and copy were checked against the content reference
  and the existing landing style.
- Desktop at 1280×720: partners appear in four columns; programs appear in three
  columns. The module shares the metrics container and has no fixed-height blank
  section. All seven logo assets load locally.
- Mobile at 390×844 and 320×740: partner logos use a compact two-column grid;
  programs stack with horizontal dividers. No horizontal overflow was observed.
- Initial Fidelity artwork clipping was corrected with a responsive image-mat
  crop; the complete mark remains visible at 320px. The initial Solana icon was
  replaced with a transparent horizontal wordmark.
- Existing scroll reveal adds short staggered fades. Reduced-motion styling
  leaves the logos visible without the stagger. Logos have meaningful alt text;
  the two groups have labelled sections and lists.
- The browser reported no warnings or errors. Existing Open Terminal and Buy
  capacity destinations remain the host-aware Buyer Market routes.

Evidence is in `../qa-partners/`: `before-experience.png`,
`partners-desktop.png`, `partners-mobile.png`, `partners-mobile-narrow.png`
and `programs-mobile.png`. Artwork provenance is recorded in
`apps/web/public/landing-design/partners/SOURCES.md`.

### Validation

- Formatting, lint and typecheck passed. Lint retains three existing max-lines
  warnings and no errors.
- The complete test run passed: 477 web tests and 10 contract tests.
- Production build passed.
- No new dependencies, API contracts, authentication, backend or deployment
  behavior were introduced by this static landing module.

Final visual QA result: passed. This change is prepared for review; the local
preview is not a production deployment.

### Hero CTA refinement — 2026-11-01

Removed the hero's “Agent-native GPU marketplace” eyebrow and replaced its two
actions with a single “Launch App” link to the existing Buyer Market destination.
The hero copy reflows naturally; obsolete eyebrow styles were removed and the
mobile button uses a 180×50px target with 14px text.

Browser review at 1280×800 and 390×844 confirmed the single action, removed copy,
and intact layout without horizontal overflow. Launch App reached the Buyer
authentication gate; Back to OpenNEXT returned to the homepage. Evidence is in
`../qa-launch/hero-desktop.png`, `hero-mobile.png` and `launch-login.png`.

Formatting, lint, typecheck and production build passed. All 477 web tests passed
with two workers and loopback access for the proxy test server; all 10 contract
tests also passed. An initial sandboxed parallel run encountered a denied local
listener and timing failures, resolved by the complete web-suite rerun above.

### Final market placement and CTA — 2026-11-01

The hero's single action is now “Open Terminal”, using the same Buyer destination.
Partners and programs now follow the “Find your fit. Set your terms.” introduction
and its buyer/supplier cards, immediately before the scrolling capacity rail.
They no longer appear in the team metrics section.

At 1280×900 the endorsement block has 56px spacing above and below; at 390×844
the existing compact logo grid and stacked programs remain intact. All logos
load, both groups reveal on scroll, the capacity rail runs, and neither viewport
has horizontal overflow. The former location retains only its normal section
padding, with no duplicate module or reserved blank area.

Evidence is in `../qa-placement/`: `partners-before-capacity.png`,
`partners-mobile.png` and `programs-to-capacity-mobile.png`. Formatting, lint,
typecheck, all 477 web tests, all 10 contract tests and production build passed.
The three existing lint warnings are unchanged.

## Fidelity Labs branding correction — 2026-11-02

Replaced the earlier atom artwork with the original 200×200 profile image from
the product owner's Fidelity Labs LinkedIn reference. The downloaded JPEG is
preserved unchanged, including its green color and full mark. The adjacent
company name uses the existing page typography. Pharos, Ondo and Solana and their
unused artwork have been removed at the owner's request.

The remaining partner and three programs share a compact desktop row. On mobile,
the groups stack with fine dividers. The module remains below the buyer/supplier
introduction and above the capacity rail. At 1280×720 and 390×844 all four images
loaded, removed partners were absent, and there was no horizontal overflow or
empty grid slot. Scroll reveal remained intact; browser logs had no warnings or
errors. Screenshots are in `../qa-fidelity/partners-desktop.png` and
`../qa-fidelity/partners-mobile.png`.

This correction is based on main at `a4b3849`, after PR #16 merged. Formatting,
lint, typecheck and the production build passed; lint retains the same three
existing max-lines warnings. The complete web suite passed 488 tests, and the
contracts suite passed 10 tests. No backend, routing or authentication changes
were needed.
