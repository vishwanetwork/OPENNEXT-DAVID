# Buyer Terminal and landing integration

The redesigned UI is implemented inside OPENNEXT-DAVID, including the upstream
changes through `f086fa53e897c38b420d5e1cda549bc1a36a4bc6`. It uses the original Next.js application,
feature components, API adapters, contracts, and backend. The earlier standalone
React prototype is not the production implementation.

## Run the integrated preview

Use Node 22+ and the repository's pinned pnpm 10.11.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `/terminal/demo/market?role=buyer` for the existing isolated backend Demo.
Open `/terminal/market` for the real sign-in screen. The normal API origin defaults
to `http://127.0.0.1:4189`. Keep the existing deployment environment and OAuth,
email, payment, and backend settings when deploying. Demo does not charge a real
payment method or provision a real instance.

## What is reused

| Flow                  | Original implementation retained                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication        | AuthView, server session boot, Google/GitHub redirects, email challenge/verification, logout and CSRF                                      |
| Market                | Inventory API/query hooks, model/country/price/vCPU/memory filters, terms, sorting, pagination, list/cards                                 |
| Spot purchase         | Existing checkout state machine, KYB gate, duration pricing, expected-price check, SSH key input, idempotency and server-confirmed balance |
| On-demand / Reserved  | Existing quote request form, original fields and validation, RFQ submission and review status                                              |
| RFQs and quotes       | Server workspace query, details, edit/cancel, supplier responses, accept/reject, payment/resume and CSV export                             |
| Instances             | Original delivery states, SSH access/key management, usage and END confirmation                                                            |
| Billing               | Original balance, top-up/payment adapters, transaction states, daily analytics, receipts and exports                                       |
| Account and utilities | Profile, KYB, settings, notifications, saved capacity, quote cart, comparison, help and Agent                                              |
| Backend migration     | Existing same-origin `/api/*` proxy and Zod contract package; no replacement endpoints or changed payloads                                 |

No changes were made to `legacy/`, `packages/contracts/`,
API client/demo routing, CSRF forwarding, production host routing, or deployment
configuration. Server-owned identity, balances, orders and RFQs remain server-owned.
The auth adapter now rejects an email-verification response with a null user instead
of reporting a successful login; its endpoint and response schema are unchanged.

The Buyer/Seller control is available in the narrow-screen navigation and account
menus; Seller remains visible and disabled, including onboarding. This is a
presentation restriction; existing backend authorization is unchanged.

## UI changes

The latest visual iteration takes its hierarchy from the Ondo product application:
strong dark feature surfaces, rounded white data cards, clearer navigation and a
consistent blue-led palette. It keeps OpenNEXT's own content and original flows.

- Primary navigation moves from the left sidebar to a horizontal top bar above
  1200px. Narrower screens use a dropdown menu on the right. Saved capacity and
  Quote cart retain their routes through desktop header icons and narrow-screen
  navigation; help remains available in the account menu. The redundant Terminal
  title and separate OpenNEXT home button are removed.
- The selected E logo package supplies navy and white wordmark variants plus the
  favicon. TerminalBrand applies them to the terminal and sign-in surfaces. The
  public landing page now uses the same approved branding and is integrated in the
  same Next.js application; the brand link keeps its existing action.
- A dark GPU feature uses the previously approved GPU artwork from the landing
  page. Its Agent action opens the existing assistant rather than a new workflow.
- Three model shortcuts show the current term's offer count and minimum price per
  GPU-hour from the existing inventory. Selecting one updates the existing model
  filter; these figures are derived from inventory, not static promotional numbers.
- Model shortcuts and table/card listings now use matching hardware thumbnails in
  place of colored GPU symbols. H100, H200 and B200 select their respective model-
  family visuals; unknown models use the approved generic GPU artwork. All four
  thumbnails now use transparent cutout PNGs without a background, border or
  rounded tile; the existing image slots keep text and pricing aligned. The images
  are decorative beside visible model names, remain visible on mobile, and do not
  change offer specifications. Asset provenance is documented in
  `apps/web/public/terminal-design/gpu-image-sources.md`.
- Market terms, filters, sorting and view controls stay together. Existing table,
  card and pagination behavior remains available beneath the feature and shortcuts.
- Market Insight uses navy feature areas, white data cards and blue controls.
  Region curves use blue, violet and teal; distribution bars, legends, range
  selectors, region pickers, hover tooltips and activity rows follow the same
  palette. Scoped chart variables preserve the default styles outside Buyer.
- OpenNEXT Agent uses navy and blue surfaces with readable suggestions and inputs.
  On mobile it opens as a full-screen panel. Decorative tiny captions are removed;
  its existing prompts, context, controls and actions remain available.
- Consistent Manrope type and cool gray surfaces extend to market tables, RFQ
  dialogs, billing metrics and instance panels. Sign-in retains the approved
  data-center photo and compact mobile form.
- Demo/Exit Demo chrome and example analytics/instances stay removed. Meaningful
  units, validation and security guidance remain. Account identity and isolated
  session routing are unchanged; local isolated accounts use a neutral “My account”
  display.
- Billing shows account records even when an old example toggle was persisted.
  Empty instances use a capacity action and adjacent SSH-key panel.
- An existing render-time offer index update was moved from useMemo to useEffect;
  the indexed offers and API behavior are unchanged.

## Iteration 6: controls and filter behavior

- Visible middle-dot separators are removed from Buyer Terminal copy, including
  the CSS-generated chart legend separator. The Market result count shows only
  the offer count, such as “18 offers”; it no longer repeats “Spot” beside it.
- Native single-select controls retain their keyboard, touch and form behavior.
  Their chevron sits 16px from the right edge, with 44px of right padding to keep
  labels clear. Filter disclosure arrows use consistent insets. The compact RFQ
  history control has enough width for its label; forced-color mode retains the
  native arrow.
- Each filter group's All checkbox and its children stay synchronized. All
  selects the full group, even when the search field shows only matching options.
  Deselecting a child produces the mixed state; selecting every child checks All.
  Clearing All clears every child and yields zero matching results. Reset restores
  the default unrestricted selection with All and its children checked.
- Market Insight's Index model remains a separate chart control from the resource
  table filters. Selection changes do not alter API payload contracts or backend
  behavior.

## Validation

Current landing, Buyer Terminal and authentication integration checks passed:

- Formatting passed.
- Lint passed with zero errors and three pre-existing max-lines warnings in
  catalog/model-quotes/checkout.
- Typecheck passed.
- Web coverage passed all 78 test files and 437 tests: statements 69.58%, branches
  77.36%, functions 63.34%.
- Contracts passed 8 tests; the legacy backend passed 668 tests; the adapter
  passed 3 tests.
- `pnpm build` passed the production build.
- The standalone production server at `http://localhost:5197` rendered the new
  homepage, its Open Terminal link reached the actual authentication gate, and
  the isolated Buyer Market rendered correctly. Buyer Sign out returned to the
  new homepage, and Seller remained disabled in the account menu. At 390×844,
  mobile navigation also reached the new login page. Development-server checks also
  covered Buy capacity, sign-in/sign-up query retention and return to the homepage.
  Authentication tests cover email verification, session handling, logout and
  onboarding.

Current results and screenshot evidence are recorded under Current integration QA
in `design-qa.md`; the earlier iteration 6 record remains as historical evidence.

On this machine Node 25 exposes experimental global Web Storage, which conflicts
with jsdom. Tests run with `NODE_OPTIONS=--no-experimental-webstorage`; this is a
local runner setting, not an application or test mock change. API proxy tests need
permission to bind an ephemeral local port.

The interaction baseline covers market terms and filters, list/cards, navigation,
isolated RFQ submission and server-generated notification, the Spot KYB gate,
account-only billing, Insight model/range controls, login and mobile navigation.
The latest visual checks also cover the top navigation, narrow-screen dropdown,
selected logo, model thumbnails, model shortcuts, Insight colors, and the Agent
panel. Iteration 6 also checks select spacing, full-group selection during search,
All/child synchronization, empty selections, reset, and desktop/mobile filter
layout. Final evidence and build verification are recorded in `design-qa.md`. No production transactions were submitted. Production OAuth,
email delivery, payment-provider callbacks and GPU provisioning require the
existing deployment configuration and were not exercised against production.

## Local review and deployment

Local review: `http://localhost:5194/terminal/demo/market?role=buyer`.

The page presentation now follows the production product. The local review URL
still uses `/terminal/demo/` so review actions remain isolated; the route name is
not displayed as product chrome. Real sessions continue through the existing login
and production APIs. Removing UI labels does not enable real payments or GPU
provisioning for isolated inventory. The connected release is prepared as a PR;
production changes take effect only after the existing main-branch deployment.

See [Landing and authentication integration](LANDING_TERMINAL_INTEGRATION.md) for
the release routes, approved homepage implementation and navigation verification.

Regression coverage includes headless session boot, a recoverable startup error,
neutral account display without identity mutation, stale example-analytics
preferences, empty instances, model shortcut/filter integration, model-family image
matching and fallback, Agent interactions, and existing checkout isolation guards.
