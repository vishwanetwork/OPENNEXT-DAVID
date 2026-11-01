# Dynamic Spot retail pricing

The OpenNEXT adapter owns the customer retail markup. Supplier quotes, procurement ceilings
and research price history retain their existing meanings. This policy currently applies to
executable Spot offers from the connected Bot. API resale, managed procurement and B2B RFQ
pricing are separate business workflows and do not silently inherit this Spot markup.

## Policy

A new configured adapter starts with a 20% markup. `SPOTBOT_OPENNEXT_SPOT_MARKUP_BPS=2000`
sets the initial default; the versioned database policy takes precedence once an operator
saves it. Console exposes Spot pricing under Platform agent and links to it from Price Source.
Operators can edit the default and up to 20 ordered overrides by canonical GPU model, region
and/or provider. Blank fields match any value. The first matching override wins. Duplicate
selectors and unbounded percentages are rejected; supported markups are 0–100%, in 0.01% steps.

The administrator GET/PUT endpoint is `/api/admin/pricing/retail-policy`. PUT verifies the
operator session, same origin and expected policy version. Compare-and-swap prevents one
operator from overwriting another's changes. Actor, time and the previous ten policy
revisions are persisted with the setting, using the existing SQLite/MySQL/DynamoDB workflow
store. No client-side storage or redeployment is required for future policy changes.

## Price calculation

Retail instance-hour cents are `ceil(supplier_hourly_usd * (1 + markup) * 100)`. Calculation
uses decimal arithmetic, before rounding, rather than adding a margin to an already rounded
supplier price. Per-GPU prices divide the retail instance-hour price by the explicit GPU count.
No fixed checkout or usage service fee is added to new purchases. For example,
a $1.00 supplier rate with 20% markup lists at $1.20 per instance-hour; a one-hour purchase is
$1.20. The Console reports `serviceFeeBps=0`. New Credit holds freeze `service_fee_bps=0`;
historical holds without that field retain 500 bps, and existing snapshots/Direct Pay invoices
retain their accepted fee. This is a markup on the observed supplier quote, not a
promise of a fixed realized margin after future Spot price fluctuations and storage costs.

The existing procurement tolerance remains independent: the Bot's `max_price_hourly` derives
from the original supplier quote rounded to cents, plus its existing 20% tolerance. Increasing
a retail markup never raises the procurement ceiling. Public marketplace rows contain retail
prices; wholesale cost snapshots stay in protected server records. Market Insight and price
history retain source observations rather than rewriting historical data with a retail margin.

## Accepted-price snapshots

The supplier catalog can stay cached, but each new quote reads the current policy. Checkout
validates the user's reviewed amount against the server quote; a stale price returns 409 and
requires review. A Credit hold stores the accepted retail cents, policy version, matching rule,
markup, service fee, duration and original source offer. Direct Pay intents store the same
snapshot before an operator confirms funds. Delayed provisioning uses this accepted snapshot.

Later policy changes cannot alter accepted holds, issued payment instructions, instance rates,
usage settlement or an idempotent confirmation. Retrying an uncertain purchase reuses its
existing hold, without requiring a second copy of the same funds. Closed/refunded attempts
cannot acquire a new server under an old charge. Legacy records retain their original pricing
and fee rules; pending legacy holds without a complete snapshot await reconciliation rather
than being silently repriced. No existing orders or account balances are migrated.
