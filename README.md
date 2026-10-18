# OpenNEXT

Complete source for the current **OpenNEXT website / Capacity Terminal** and the separate **Operations Console** for the OpenNEXT team.

## Run locally

Requires Node.js 20 or later. Public AWS On-demand and Vultr collection runs without third-party runtime dependencies or API keys. Authenticated collectors need server-side credentials; optional AWS Spot uses the AWS SDK.

```sh
git clone https://github.com/Caliboy6/OPENNEXT.git
cd OPENNEXT
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

The three homepage listing tabs use a horizontal, one-card-at-a-time carousel: five cards on desktop, responsive layouts on smaller screens, hover pause, manual navigation and reduced-motion support. The catalog contains 12 model API reference rates, 14 GPU rental demand records and 10 physical GPU / server reference offers observed on 13 October 2026. Price provenance stays in source metadata rather than appearing on the cards. These are dated observations, not a live inventory feed or firm OpenNEXT quotes.

The terminal includes searchable GPU model / region / GPU count filters, market terms, AWS observation charts, real provider-price comparisons, rotating matches/recent observations, quote requests, RFQs, supply onboarding, instances, saved products, quote cart, supplier conversations, account settings and the agent drawer. Empty source coverage remains empty. Model, memory, form factor and exact instance GPU count are matched separately.

### Operations Console

The independent team interface includes overview, market datasets, advisory, orders, instances, schedules and execution history, platform-agent configuration, agent billing, user/supplier reviews and audit logs. Review, delivery, authorization and schedule actions persist within the browser.

**Price sources** (`/admin/#pricing`) manages 24 provider registrations in a searchable card grid. AWS and Vultr public collectors are connected. Lambda and Shadeform adapters are implemented and await server credentials. Other registrations document integration status and upstream APIs; they are not represented as connected. Manual runs, cadence/enable settings, actual run logs and cached price tables use the server API and survive a server restart. Credential inputs remain in server memory only.

See [all provider APIs](docs/PROVIDER_APIS.md) and [pricing operations / deployment](docs/PRICING_OPERATIONS.md).

## Source map

| Files | Responsibility |
| --- | --- |
| `index.html`, `OpenNEXT-preview-entry.html`, `OpenNEXT-terminal-preview.html` | Main website / terminal entry points |
| `OpenNEXT-original-homepage.js` / `.css` | Preserved landing-page content and visual system |
| `OpenNEXT-home-listings.js` / `.css` | Three market-card carousels, dated price metadata and motion controls |
| `OpenNEXT-gci-index-factory.html` | Homepage animation with bundled resources |
| `OpenNEXT-auth.js` / `.css` | Authentication UI and local preview account flows |
| `OpenNEXT-terminal.js` / `.css` | Buyer, seller and broker workflows |
| `OpenNEXT-market-data.js` | Browser client for real price/cache and legacy AWS history APIs |
| `OpenNEXT-capacity-prices.cjs`, `OpenNEXT-capacity-chart.js` / `.css` | Server-only bot bridge, public fixed-tariff collector and live three-type GPU chart |
| `OpenNEXT-pricing-service.cjs`, `OpenNEXT-pricing-registry.cjs` | Provider adapters, normalization, scheduler, persistent observations and source capabilities |
| `OpenNEXT-pricing-api.cjs` | Read-only public pricing and protected collector administration |
| `OpenNEXT-provider-console.js` / `.css` | Provider connections, settings, jobs, logs and collected prices |
| `OpenNEXT-market-feed.cjs` | Public catalog normalization, cache and source-linked news |
| `admin/index.html`, `OpenNEXT-admin-console.html` | Operations Console entry points |
| `OpenNEXT-admin.js` / `.css` | Team dashboard, reviews and operating workflows |
| `OpenNEXT-preview-server.cjs` | Local server and `/api/market`, `/api/news` |
| `scripts/`, `tests/` | Portable syntax and HTTP smoke checks |

## Data and preview boundaries

- Terminal GPU reference prices use real server-collected AWS and Vultr prices, with Lambda/Shadeform available after credential setup. Whole-instance hourly prices are divided by verified physical GPU count. Catalog pricing does not guarantee stock, delivery speed, ratings or executable quotes; unknown fields stay unreported.
- History consists of actual collection observations only. The main chart reads Spot quotes from the configured bot and supplements them with public AWS and Azure tariffs; all three lines come from one offering. Missing coverage remains empty. The separate legacy collector's direct AWS Spot adapter still needs IAM; its original price/history endpoints remain independent. Unknown specifications are excluded rather than inferred.
- Account balances, local workflow records and legacy Console datasets remain demonstration records, not executed transactions or a published benchmark. Packet Demand is a buyer-demand reference, not a settled Spot-price feed. The homepage's separately dated reference carousel is retained.
- News currently uses a source-linked, dated editorial snapshot, not a live crawler.
- Google / GitHub sign-in is real server-side OAuth (`OpenNEXT-oauth-adapter.cjs`) once `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are set; register `https://terminal.opennextlab.ai/api/auth/oauth/{google|github}/callback` as the redirect URI. Email verification and password-reset steps are preview flows only. Do not use real passwords or private credentials.
- User activity is stored in browser `localStorage`. It is not shared between browsers or automatically synchronized between the terminal and admin console.
- Price-source administration has server-side access checks: direct localhost access, or a configured administrator token exchanged for a short-lived HttpOnly session over HTTPS. Terminal-host routing denies administrative APIs. This protects pricing operations only; the remaining preview Console does not have production identity/RBAC. Supplier approval, funding confirmation, SSH verification and agent execution remain demonstrations.
- Pricing cache, raw source snapshots and observations persist in the private `.opennext-data` directory (excluded from Git and HTTP static serving). SMM settlement, supplier agents and production business-record storage are not connected.

Before production, implement server-side identity/RBAC, tenant isolation, secure secret storage, authenticated supplier integrations, payment verification, durable audit logs, data licensing and operational monitoring. Do not expose this Console as a protected live admin service.

## Verification

```sh
npm run check
npm test
```

Checks cover syntax, site entry points and resource completeness, pricing units/specifications, actual-only history, failure/cache handling, credential redaction and administrative access boundaries. Optional browser smoke: install Playwright separately and run `node scripts/pricing-browser-smoke.cjs` against a running server; `TEST_BASE` defaults to port 4190.

## Hosting

The Node server runs both sites and the pricing API. Static hosting alone cannot run collectors, manage credentials or serve the Terminal price API; missing APIs show an unavailable state. Docker Compose mounts a persistent private pricing volume. This repository does not automatically deploy a production service or enable GitHub Pages.

## 中文说明

本仓库包含当前两个站点的完整运行代码：OpenNEXT 官网与交易 Terminal，以及独立的团队管理后台。安装 Node.js 20+ 后执行 `npm start` 即可同时启动，默认主站为 `http://127.0.0.1:4188/`，后台为 `http://127.0.0.1:4188/admin/`。

定价部分已接入真实服务端采集与缓存：AWS 公开 On-demand、Vultr 公开目录；Lambda / Shadeform 待配置服务端密钥，AWS Spot 待 IAM 授权。后台 Price sources 可配置、采集、查日志与价格。历史只保留实际观测，不补造曲线。其余 OAuth、交付、SMM 结算与供应商 Agent 仍是待接入的演示流程。定价管理接口已有访问控制，但完整企业身份/RBAC 仍需建设。仓库不包含账户密钥和本地采集数据。
