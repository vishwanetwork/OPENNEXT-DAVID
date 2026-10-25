# OpenNEXT

Complete source for the current **OpenNEXT website / Capacity Terminal** and the separate **Operations Console** for the OpenNEXT team.

## Run locally

Requires Node.js 20 or later. Public AWS On-demand and Vultr collection runs without third-party runtime dependencies or API keys. Authenticated collectors need server-side credentials; optional AWS Spot uses the AWS SDK.

```sh
git clone https://github.com/vishwanetwork/OPENNEXT-DAVID.git
cd OPENNEXT-DAVID
npm start
```

- Website and buyer/seller terminal: http://127.0.0.1:4188/
- Team Operations Console: http://127.0.0.1:4188/admin/

The GPU Market main chart now compares **Spot / On-demand / Reserved** for one reference offering (same GPU configuration, supplier and region), without provider attribution in its public payload or chart. Configure the server-only bot bridge and run `node --env-file=.env.local OpenNEXT-preview-server.cjs` to connect SpotOrderBot. It checks for updates every 30 seconds, uses actual observations only, adds public AWS and Azure tariffs, and treats Reserved as one year with no upfront payment. See [live chart setup and methodology](docs/CAPACITY_CHART.md). The older uploaded Spot dataset remains accessible through its historical API.

If port 4188 is already in use, choose another port:

```sh
# macOS / Linux
PORT=4190 npm start

# Windows PowerShell
$env:PORT = '4190'
npm start
```

The server binds to localhost by default. Set `HOST` only when intentionally enabling network access. This preview is not a production deployment.

## Included sites

### Website and Capacity Terminal

The original landing page is retained, including market listings, procurement flow, supplier sections and the bundled GCI Index Factory animation. The GPU ticker rotates, pauses on hover and exposes a price chart.

The three homepage listing tabs use a horizontal, one-card-at-a-time carousel: five cards on desktop, responsive layouts on smaller screens, hover pause, manual navigation and reduced-motion support. Approved marketplace records take precedence. The GPU rental fallback uses the isolated Demo showcase and four user-supplied B300/H200 requirements, not a live scrape. Older Packet Demand records remain in source but are not the active rental fallback. Model prices use the supplied Nova sheet plus dated official reference entries; physical hardware prices are static merchant references from ServerSupply, Gatewell, Newegg, B&H and Exxact. None of these references guarantees current inventory or an executable quote.

The terminal includes searchable GPU model / region / GPU count filters, market terms, AWS observation charts, real provider-price comparisons, rotating matches/recent observations, quote requests, RFQs, supply onboarding, instances, saved products, quote cart, supplier conversations, account settings and the agent drawer. Empty source coverage remains empty. Model, memory, form factor and exact instance GPU count are matched separately.

Switch Market currently enables GPU Market only; Model Capacity is marked Coming soon. Region selectors use readable locations without observation counters or provider instance/code suffixes, while retaining the original identities and prices internally. Buyer Supply & Demand shows Supply first; Seller shows RFQs first. When no matching marketplace records are available, the formal Terminal can show read-only reference listings from the previous Demo catalog. These are not executable offers or verified settlements and do not populate customer balances, orders or inventory. Set `OPENNEXT_REFERENCE_CATALOG_ENABLED=0` to disable that fallback.

### Operations Console

The independent team interface includes overview, market datasets, advisory, orders, instances, schedules and execution history, platform-agent configuration, agent billing, user/supplier reviews and audit logs. Some legacy dashboard modules remain browser-local previews. The RFQ/Supply inbox, KYB reviews, homepage approvals and contact inbox use protected server APIs.

Terminal RFQs and supply submissions have durable server receipts and appear in Console immediately after saving, including supply awaiting Agent installation. The inbox supports search, market/status filters, full details and visible-page auto-refresh. A separate **Demo submissions** area supports isolated testing without adding guest records to the production marketplace. See [Terminal-to-Console integration](docs/TERMINAL_CONSOLE_SYNC.md) for endpoint contracts, retry behavior and backend handoff.

Every new or edited RFQ starts in Reviewing and remains visible to its owner and operations. Console approval is required before public market listing or supplier quotations. Approval displays Live RFQ for public requirements and sends an in-app notification; rejection requires a reason and supports revision/resubmission. Operations decisions require the current `expectedRevision`. Approved private requirements remain private. RFQ market approval is separate from homepage-placement approval and supplier KYB review.

### Order fees

Listed supplier unit prices are not marked up. For new quotations and orders, each side pays **OpenNEXT Fee 5%**, calculated independently on the agreed order subtotal and rounded to USD cents. The buyer pays subtotal plus buyer fee; the seller receives subtotal minus seller fee. For a $1,000 order, the buyer pays $1,050 and the seller receives $950. The server records `subtotal`, `buyerFee`, `sellerFee`, `buyerTotal`, `sellerNet`, `feePercent` and `feePolicyVersion`; `total` is the buyer's total. Broker commissions remain separate, and credit top-ups do not incur this order fee. Historical accepted/paid orders retain their recorded amounts. Payment and settlement integrations must use the authoritative server amounts; browser actions cannot confirm payment or release proceeds.

**Price sources** (`/admin/#pricing`) manages 24 provider registrations in a searchable card grid. AWS and Vultr public collectors are connected. Lambda and Shadeform adapters are implemented and await server credentials. Other registrations document integration status and upstream APIs; they are not represented as connected. Manual runs, cadence/enable settings, actual run logs and cached price tables use the server API and survive a server restart. Credential inputs remain in server memory only.

See [all provider APIs](docs/PROVIDER_APIS.md) and [pricing operations / deployment](docs/PRICING_OPERATIONS.md).

## Source map

| Files | Responsibility |
| --- | --- |
| `index.html`, `OpenNEXT-preview-entry.html`, `OpenNEXT-terminal-preview.html` | Main website / terminal entry points |
| `OpenNEXT-original-homepage.js` / `.css` | Preserved landing-page content and visual system |
| `OpenNEXT-home-listings.js` / `.css` | Three market-card carousels, dated price metadata and motion controls |
| `OpenNEXT-gci-index-factory.html` | Homepage animation with bundled resources |
| `OpenNEXT-auth.js` / `.css`, `OpenNEXT-auth-service.cjs`, `OpenNEXT-oauth-adapter.cjs` | Authentication UI, Google/GitHub OAuth, verified sessions and onboarding |
| `OpenNEXT-procurement.js`, `OpenNEXT-marketplace-service.cjs` | Submission forms, durable marketplace records and receipt/idempotency contracts |
| `OpenNEXT-rfq-notifier.cjs`, `OpenNEXT-mailer.cjs` | Background RFQ notification email to operations over a dependency-free SMTP client |
| `OpenNEXT-console-marketplace.js` / `.css` | Protected production and isolated Demo submission inboxes |
| `OpenNEXT-terminal.js` / `.css` | Buyer, seller and broker workflows |
| `OpenNEXT-market-data.js` | Browser client for real price/cache and legacy AWS history APIs |
| `OpenNEXT-capacity-prices.cjs`, `OpenNEXT-capacity-chart.js` / `.css` | Server-only bot bridge, public fixed-tariff collector and live three-type GPU chart |
| `OpenNEXT-pricing-service.cjs`, `OpenNEXT-pricing-registry.cjs` | Provider adapters, normalization, scheduler, persistent observations and source capabilities |
| `OpenNEXT-pricing-api.cjs` | Read-only public pricing and protected collector administration |
| `OpenNEXT-provider-console.js` / `.css` | Provider connections, settings, jobs, logs and collected prices |
| `OpenNEXT-market-feed.cjs` | Public catalog normalization and cache |
| `OpenNEXT-news-service.cjs` | Hourly official GPU-news collection, persistent cache and source dates |
| `OpenNEXT-reference-catalog.cjs` | Read-only reference listings isolated from genuine marketplace records |
| `admin/index.html`, `OpenNEXT-admin-console.html` | Operations Console entry points |
| `OpenNEXT-admin.js` / `.css` | Team dashboard, reviews and operating workflows |
| `OpenNEXT-preview-server.cjs` | Local server and `/api/market`, `/api/news` |
| `scripts/`, `tests/` | Portable syntax and HTTP smoke checks |

## Data and preview boundaries

- Terminal GPU reference prices use real server-collected AWS and Vultr prices, with Lambda/Shadeform available after credential setup. Whole-instance hourly prices are divided by verified physical GPU count. Catalog pricing does not guarantee stock, delivery speed, ratings or executable quotes; unknown fields stay unreported.
- History consists of actual collection observations only. The main chart reads Spot quotes from the configured bot and supplements them with public AWS and Azure tariffs; all three lines come from one offering. Missing coverage remains empty. The separate legacy collector's direct AWS Spot adapter still needs IAM; its original price/history endpoints remain independent. Unknown specifications are excluded rather than inferred.
- Demo account balances and legacy Console datasets remain test records, not executed transactions or a published benchmark. Genuine customer records and the reference catalog are separate. Packet Demand is a buyer-demand reference, not a settled Spot-price feed.
- Market Intelligence collects GPU-relevant articles from official AWS and AMD RSS feeds on startup and hourly while the backend is running. It retains publisher dates, source links and stale/cache status; a collection timestamp is not a publication date. Failures retain the last successful snapshot without fabricating headlines. Set `OPENNEXT_NEWS_ENABLED=0` to pause collection. Additional publishers require licensing and feed validation; NVIDIA RSS is not enabled because its published RSS terms restrict commercial use.
- Google / GitHub sign-in uses the team's server-side OAuth adapter once `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are set. Register `https://terminal.opennextlab.ai/api/auth/oauth/{google|github}/callback` as the redirect URI. Email verification, payment checkout and infrastructure installers still require their adapters; unconfigured services fail closed. The direct `/demo/` route remains an isolated guest workspace and is not an authentication bypass for production; the team's removal of the sign-in Demo button is preserved.
- Each submitted or resubmitted RFQ emails `OPENNEXT_RFQ_NOTIFY_TO` in the background once `SMTP_HOST`, `SMTP_FROM` and recipients are set (`SMTP_USER`/`SMTP_PASS` for authenticated relays). Port 587 requires STARTTLS; 465 uses implicit TLS. Delivery never delays or fails the RFQ; failed sends retry three times, and pending sends are lost on restart.
- RFQs, supplies, KYB and submission receipts persist in the private backend store and are shared by Terminal and Console APIs. Browser preferences and some legacy preview modules still use `localStorage`. Separate server processes need shared transactional storage before production-scale use.
- Pricing, contact and marketplace administration enforce server-side access checks: direct localhost access, or a configured administrator token exchanged for a short-lived HttpOnly session over HTTPS. Terminal-host routing denies administrative APIs. Production administrator identity/RBAC and remaining legacy Console modules still require hardening.
- Pricing snapshots, authentication state and marketplace records persist in private data directories excluded from Git and HTTP static serving. Supplier publication requires KYB approval and a verified Agent installation callback; an unavailable installer does not simulate success. Payment settlement, external supplier agents and SMM settlement still require their backend integrations.

Before production, complete identity adapters and administrator RBAC, shared transactional storage, secure secret storage, authenticated supplier integrations, payment verification, durable audit retention, data licensing and operational monitoring. Do not treat the legacy preview Console modules as completed production services.

## Verification

```sh
npm run check
npm test
```

Checks cover syntax, site entry points and resource completeness, pricing units/specifications, actual-only history, failure/cache handling, credential redaction and administrative access boundaries. Optional browser smoke: install Playwright separately and run `node scripts/pricing-browser-smoke.cjs` against a running server; `TEST_BASE` defaults to port 4190.

## Hosting

The Node server runs both sites and their APIs. Static hosting alone cannot run collectors, persist submissions or serve protected Console data; missing APIs show an unavailable state. Docker Compose mounts private persistent storage. The manual GitHub Actions deployment workflow publishes the configured application image; deploying it does not configure OAuth, mail, payment or supplier-Agent providers. GitHub Pages is not used for the application backend.
