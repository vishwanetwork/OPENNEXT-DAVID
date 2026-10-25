# Migration status

| Legacy module | New location | Status | Notes |
| --- | --- | --- | --- |
| OpenNEXT-preview-server.cjs (routing, host split) | apps/web/src/proxy.ts, src/lib/apps.ts | done | API still served by legacy server via rewrite |
| OpenNEXT-auth.js / .css | apps/web/src/features/auth | done | sign-in, verify, OAuth start, onboarding, role intent; server session seeding in app/terminal/layout.tsx |
| OpenNEXT-original-homepage.js / .css | apps/web/src/features/site/components/{landing-sections,artwork,brand,cta,info-modal}.tsx, styles/homepage.css | done | `renderLogin`/providers/consent were unreferenced in legacy and were not ported |
| OpenNEXT-home-listings.js / .css | apps/web/src/features/site/components/{listings-carousel,listing-card}.tsx, lib/listings.ts, data/catalog.ts, styles/listings.css | done | carousel rotation via state offsets instead of DOM moves |
| OpenNEXT-curated-inquiries.js / .css | apps/web/src/features/site/components/curated-rfq-dialog.tsx, lib/curated.ts, styles/curated-inquiries.css | done | |
| OpenNEXT-contact.js / .css | apps/web/src/features/site/components/contact-dialog.tsx, api.ts (`submitContact`), styles/contact.css | done | terminal account menu still needs to reuse it |
| OpenNEXT-market-data.js | ticker: apps/web/src/features/site/api.ts; catalog/offers/history: apps/web/src/features/market/catalog.ts, hooks.ts | done | pure matching + React Query |
| OpenNEXT-history-chart.js / .css | apps/web/src/features/market/regional-history.ts, RegionalHistoryChart.tsx | done | region picker, legend focus, hover tooltip, series table |
| OpenNEXT-capacity-chart.js / .css | apps/web/src/features/terminal/components/MarketPage.tsx | done | the regional-history branch is used (as in production); the single-offering `capacity-history` renderer is not ported because the legacy code always took the regional branch |
| OpenNEXT-market-insight-index.js | apps/web/src/features/market/insight-index.ts, InsightIndex.tsx | done | consumed by the seller Market Insight page |
| OpenNEXT-model-quotes.js | apps/web/src/features/site/data/model-quotes.ts (re-exported by features/market/model-quotes.ts) | done | one shared dataset; terminal Model Capacity page imports it via @/features/market |
| OpenNEXT-terminal.js / .css / preview-shell.css | terminal: apps/web/src/features/terminal/**, app/terminal/**; ticker + public actions: features/site | partial | shell, store, routing, market/models/saved/cart/settings/help, agent, generic modals, export done; rfqs/supply/instances/billing/profile/insight/notifications pages are stubs (PendingFeaturePage) |
| OpenNEXT-spot-market-preview.js / .css | apps/web/src/features/spot-market (inventory.ts, checkout.ts engine, components/, spot-market.css); route src/app/terminal/market (buyers) | done | Checkout is a DI state machine (22 ported tests). Purchase backend registered via `registerSpotCheckoutService`; balance fallback = GET /api/billing/account. Legacy `setInventory` → `useSpotMarketStore.setInjected`. Contract: packages/contracts/src/spot-market |
| OpenNEXT-seller-activities-preview.js / .css | apps/web/src/features/seller (settlements.ts, store.ts, hooks.ts, components/SellerActivitiesPage.tsx, seller.css); routes /insight and seller branch of /market | done | Settlement tape from GET /api/marketplace/settlements?days=90 (contract packages/contracts/src/seller); Demo tape generated locally; index filter rows from the market catalog. History modal rendered inline as in legacy. Contact Sales → terminal `openContact` |
| OpenNEXT-quote-preview.js / .css | apps/web/src/features/quotes (notifications.ts, store.ts, hooks.ts, components/{NotificationBell,NotificationsPage,QuoteRequests}.tsx, quotes.css); route /notifications; bell via `registerHeaderBell` | done | Data comes from the workspace store (procurement loads /api/marketplace/me); refresh = `refreshWorkspace()` throttled 15 s. `QuoteRequests` section exported for the RFQ page. Country names resolved with Intl.DisplayNames (unknown names kept raw instead of blanked) |
| OpenNEXT-account-profile-preview.js / .css | apps/web/src/features/account (ssh-keys.ts, store.ts, service.ts, components/{ProfilePage,SshKeyLibrary,modals}.tsx, account.css); route /profile | done | Backend adapter registered via `registerAccountService` (unconfigured → "not connected" as legacy); Demo keys stay in localStorage per workspace. `SshKeyLibrary scope=` reusable by instances. Contract: packages/contracts/src/account |
| OpenNEXT-procurement.js / .css | apps/web/src/features/procurement/** (RfqPage, SupplyPage, forms, dialogs, ListingTable, MatchesPanel, ProcurementModals, Registrar) | done | Only the live server-backed flows were ported; the legacy switch cases that fabricated quotes/orders/instances in the browser (proc-sample-quotes, proc-response-test/accept, proc-pay-confirm, proc-complete, proc-close, browser-side delivery/verify) were unreachable dead code and are intentionally omitted (buttons show the legacy "requires a verified backend transaction" toast). Budget slider uses current price records (the legacy chart `priceRange` fallback path). |
| OpenNEXT-rfq-details.js / .css | apps/web/src/features/rfq-details/** | done | Shared `<RfqDetails record money? date? />` + `maximumQuote()`; used by the console inbox, available to the terminal procurement feature. |
| OpenNEXT-exchange.js | apps/web/src/features/procurement/exchange.ts, workspace.ts, api.ts; billing account part in src/features/billing/account.ts | done | Pure market logic + zustand `useMarketplaceStore`; refresh registered with the shell's 30 s loop. Browser-side accept/reject/pay/sampleQuotes simulations were dead code and are not ported. |
| OpenNEXT-instances.js / .css | apps/web/src/features/instances/** | done | Example card + locally ended demo allocations keep the legacy `opennext-instance-preview-v2:*` localStorage key (illustrative only). Real END fails closed until `registerInstanceLifecycle` is given a backend adapter. SSH key library is a hook point (`registerSshLibrary`) for the account-profile feature; until then a "temporarily unavailable" note renders. |
| OpenNEXT-payments.js | apps/web/src/features/billing/payments.ts, components/PaymentModals.tsx | done | Manual top-ups via POST /api/billing/topups with per-draft idempotency key; 10 s polling while pending. Purchase-return link is a hook point (`registerPurchaseContext`) for the spot-market checkout feature. |
| OpenNEXT-billing.js / .css | apps/web/src/features/billing/** (analytics.ts, BillingPage, BillingModals) | done | Chart is React SVG; resize handled by state instead of DOM patching. Legacy `completePayment`/cashout submissions were no-ops and remain toasts. |
| OpenNEXT-demo.js / .css | apps/web/src/lib/api/client.ts, src/features/terminal/DemoToolbar.tsx | done | sandbox start/role/logout + toolbar |
| OpenNEXT-countries.js | apps/web/src/features/procurement/countries.ts | done | |
| OpenNEXT-preview-icons.js | apps/web/src/components/icons/lucide.tsx | partial | lucide glyphs used by Spot market / Market Insight (9 icons); other icons ported where used |
| OpenNEXT-admin.js / .css | apps/web/src/features/console/** (shell, store, dialogs, pages), src/app/admin/** | done | Browser-local preview dataset kept in localStorage under `opennext.operations.v2` (preview records, not customer data; identity migration retained). Toast omits the legacy check icon. `/demo-submissions` route exists but, as in legacy, has no sidebar entry. |
| OpenNEXT-provider-console.js / .css / provider-logos.js | apps/web/src/features/pricing-admin/**, apps/web/public/provider-logos/* | done | Logos extracted to static files (24, raster kept as-is). Admin token sign-in = `POST /api/admin/pricing/session`; shared by every console page. |
| OpenNEXT-console-leads.js / .css | apps/web/src/features/console-leads/** | done | 15 s visible-page polling, focus refresh, 409 draft preservation. |
| OpenNEXT-console-marketplace.js / .css | apps/web/src/features/console-marketplace/** | done | Production inbox + Demo submissions (`/demo-submissions`), external import review, featured review; 30 s visible refresh with stale warning. |
| OpenNEXT-console-topups.js / .css | apps/web/src/features/console-topups/** | done | Live/test scope fail-closed checks, verified-receipt gate, 409 handling. |
| OpenNEXT-gci-index-factory.html | apps/web/public/gci-index-factory.html | done | static iframe |

## Open contract questions (spot-market / seller / quotes / account)

- `GET /api/marketplace/public` supplies must carry `gpuCount`, `vcpu`, `memory` (and `agentStatus: "Succeeded"` or `serverRecord && status: "Published"`) for a row to appear in the Spot GPU market; today's `publicRow` only has `count`, so real inventory is empty (legacy behaviour).
- Credit purchase: the front-end expects `beginPurchase` (`pricingVersion: "duration-v1"`, `expectedPricing`, `idempotencyKey`) and `getCreditBalance` as in `packages/contracts/src/spot-market`; no endpoint exists yet. The backend must recompute subtotal + 5% fee, lock the offer and honour idempotency.
- `GET /api/billing/account` is used as the Credit balance source (`confirmed`, `accountId`, `currency: "USD"`, `availableCredit`).
- Account SSH keys: `listSshKeys` / `addSshKey` / `removeSshKey` (see `packages/contracts/src/account`) have no endpoints yet; until registered, real accounts see "SSH key management is not connected yet".
- `GET /api/marketplace/settlements?days=90` rows should include `country` (or a region the client can map), `gpuCount`/`count`, `perGpuHourly`/`price`, `settledAt`, `status: "Completed"`, `serverRecord: true`, never a supplier identity.
- Notifications in `/api/marketplace/me` need `id`, `ownerId`, `subject|title`, `message`, `created|createdAt`, optional `orderId|rfqId|topupId`; quote requests are RFQs with `requestKind: "quote_request"`.

## Procurement / instances / billing — contract questions for the backend team (Agent C)

- `GET /api/marketplace/me`: the web app relies on `rfqs[].quotes[]` (buyer view with `price`/fees), `listings[]` (with `netPrice`, `agentStatus`, `submission` receipt), `review.status`, `responses[]`, `orders[]` (with `side` and the explicit-fee fields), `notifications[]` (with `ownerId`) and `instances[]`. Keep these keys.
- Quotes/orders must carry the complete explicit-fee breakdown (`feePolicyVersion: opennext-explicit-5pct-v1`, `subtotal`, `buyerFee`, `sellerFee`, `buyerTotal`, `sellerNet`); the UI refuses to accept a quote without it.
- `GET /api/marketplace/reference-catalog` activity rows use `side: "activity"` and `timeBasis: "illustrative"`; rows carry `referenceOnly: true`.
- External (sourced) rows need `external: true`, `responseMode: "operations"`, `regionScope`, `quantity`, `rentalMonths`, `modelOptions`/`modelBudgets` exactly as the legacy external marketplace emitted them.
- `GET /api/billing/account` must answer `confirmed: true`, `accountId` = session user id, `currency: "USD"` and numeric credit fields, or the browser keeps the last confirmed balance.
- `POST /api/billing/topups` must echo `amount`, `amountCents`, `method`, `purchaseReference` and an id matching `TOPUP-<uuid>`; mismatches are treated as unconfirmed.
- Instance termination (`END`) has no endpoint yet; the UI exposes `registerInstanceLifecycle({ end })` expecting `{ confirmed: true, instance: { id, status: 'Ended' | 'Released', ... } }`.
- `POST /api/marketplace/instances/:id/resell` body is `{ count, rate, hours }` (numbers).

## Findings in the legacy backend (not fixed; the Python backend replaces it)

- `POST /api/demo/start` (and other demo writes) compare `Origin` against an origin built from the
  socket (`http://` unless `secureCookies` is set). Behind TLS termination the browser sends an
  `https://` origin, so the demo workspace cannot start in production unless the server is started
  with `secureCookies`. Reproduced directly against the legacy server with forwarded headers.
