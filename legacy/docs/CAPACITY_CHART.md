# Live GPU price comparison

The GPU Market main chart compares Spot, On-demand and Reserved prices of one reference offering. Legend, tooltip, table and public chart API contain no provider names, instance or SKU names, source URLs or credentials. Private state retains provenance for audit. Other procurement and provider-management views remain separate.

## Start

Set the server-only values from `.env.example` in an ignored `.env.local` file, then run:

```sh
node --env-file=.env.local OpenNEXT-preview-server.cjs
```

`OPENNEXT_SPOTBOT_URL` must use HTTPS, except for loopback development. `OPENNEXT_SPOTBOT_API_KEY` is sent only to that origin in an authorization header. The bridge makes GET requests only; it cannot submit orders. No cloud pricing credentials are needed for the public tariff feeds.

The bridge uses Node's own HTTP client, which ignores system and `HTTP(S)_PROXY` settings. Each catalog page has a 90-second timeout. The bot compresses catalog pages with gzip (about 50 KB per 1,000 offers), but an older bot sends roughly 1.2 MB per page and can time out on slow links.

The public endpoint is `GET /api/pricing/capacity-history`. Filters: `gpuModel`, `gpuCount`, `gpuMemoryGb`, `formFactor`, `region`, `period` (`1D`, `1W`, `1M`, `3M`). The default is `1M`. `3M` means the most recent 90 days. Periods select real saved or vendor-published history; missing history stays empty. An example preview is `/?gpu=A10G&count=1#terminal/market`.

## Comparison basis

An offering is one GPU configuration from one supplier in one region (for example, one instance size in one cloud region). All three lines and the three headline prices come from the same offering, so the comparison never mixes a cheap On-demand rate from one supplier with Spot or Reserved rates from another.

Among offerings that match the selected GPU model, GPU count, region and any memory/form-factor constraint, the reference is chosen in this order:

1. a current Spot price observed live by SpotOrderBot. Azure publishes fixed Spot rates, so its lines are flat; an Azure offering is the reference only when no live Spot offering matches;
2. the most price types with a current quote;
3. the most price types observed in the selected period;
4. the lowest current On-demand rate;
5. the lowest current rate of any type.

Live Spot first means the Spot line shows real movement for most models. The cost is that some configurations lose a line their Azure equivalent would have had, when the live offering has no matching rate (for example, an offering with Spot and On-demand but no one-year Reserved term).

The response reports the reference's region, GPU count, memory and form factor, and how many offerings matched. It never names the supplier. Within an offering, zone-level Spot quotes are reduced to the lowest one.

## Sources

- **SpotOrderBot**: Spot and account On-demand quotes, plus AWS On-demand and Reserved list prices that the bot reads from the AWS Price List API. All catalog pages are read. Full physical GPUs only; fractional GPU offers are excluded. Of the Reserved terms, the chart uses one year with no upfront payment, standard or convertible (the lower rate wins). Bot list prices stay current for 13 hours, two of the bot's six-hour refreshes.
- **AWS public pricing JSON**: On-demand and Reserved (Linux, shared tenancy, one year, no upfront, standard) in `OPENNEXT_CAPACITY_REGIONS` (default `us-west-2,us-east-1`). It is a fallback when the bot has no list prices; equal rates from both sources are merged.
- **Azure Retail Prices API** (`prices.azure.com`, no key): Spot, On-demand and one-year Reserved for documented whole-GPU sizes (A100, H100, H200, MI300X, T4, A10, V100) in `OPENNEXT_AZURE_REGIONS` (default `eastus,westus2`). Windows, Low Priority and partial-GPU sizes are excluded. Azure publishes the reservation price for the whole term; it is divided by 8,760 hours, and Azure can bill it monthly with no upfront payment. A Spot meter priced at or above On-demand is a placeholder and is dropped. Azure regions are mapped onto the chart's regions only where the geography matches (for example `eastus` → US East).

Every value is USD per GPU-hour: the instance price divided by the verified physical GPU count. Reserved is a billing commitment, not a guarantee of reserved inventory. Unavailable inventory and account quotas do not erase price references, and the chart does not imply that a machine can be launched.

## Refresh, history and failure behavior

The page polls its cached chart endpoint every 30 seconds (every five seconds during initial synchronization). The server polls the bot every five minutes and the public tariffs hourly. The API responds immediately while upstream synchronization runs in the background. Public feeds have a 25-second timeout, a body-size limit and no redirects.

History is stored as price segments: a value together with the first and last time it was observed. Each sync extends a segment while its price is unchanged and the quote is fresh. A changed price, an expired quote or a gap longer than 15 minutes closes the segment. Bot quotes expire after 15 minutes and public quotes after two hours.

Where history comes from:

- **Azure**: each retail price carries the date it took effect (`effectiveStartDate`). A rate's segment starts at that date, limited to the one-year retention window. This is the published validity of the rate, not an observation.
- **AWS Spot**: the bot backfills the vendor's most recent 90 days into its configured SQLite, MySQL or DynamoDB storage, independently of current offer catalogs. The bridge reads `/v1/prices/aws-spot-history` for the reference SKU and Region, including all pages and the effective predecessor at the start. A zone's price remains valid until the next change, even when changes are days apart. At every change the bridge recomputes the lowest zone price; it never takes a minimum over obsolete zone quotes. Reconstructed intervals take precedence inside the bot's confirmed coverage. Live observations after that coverage remain visible. The selected offering's history cache refreshes every ten minutes and is saved in private state; the bot refreshes its durable history daily. Failed imports preserve the previous cache and retry after ten minutes. Newly introduced instances may have shorter histories.
- **Other SpotOrderBot providers**: saved observations are imported once per reference offering from `/v1/prices/history`, filtered by provider, cloud, SKU and Region, up to 90 days and 100,000 rows. Only the time before the first locally recorded segment is filled. Sparse observations are not extended across unobserved gaps. A failed import retries after ten minutes.
- **AWS On-demand and Reserved history**: `/v1/prices/aws-list-history` supplies published intervals from the official EC2 archive versions intersecting the most recent 90 days. The bot streams regional CSV files, persists only filtered GPU rates in SQLite/MySQL/DynamoDB, checks for new versions daily and reuses completed immutable versions. The bridge reads all interval pages and refreshes its private cache every ten minutes (every 30 seconds while the initial backfill is pending). Each interval begins no earlier than both its version beginning and the term's own effective date, and ends at the version ending or last index check. Some Reserved terms start late in the month: earlier unconfirmed dates stay empty. One-year No Upfront terms only; the lower eligible standard/convertible rate in a version wins. Values are converted from instance-hours to verified physical GPU-hours. Archive intervals replace local segments only within their confirmed ranges; real observations outside those ranges remain visible. Failed or partial imports retain successfully cached data. Version IDs, supplier names, AWS SKUs and source URLs remain private.
- **Current AWS On-demand and Reserved quotes**: live Price List API records start at their `effectiveDate` and continue while fresh. They supply subsequent observations after the archived interval. Today's rate is never used to fill earlier gaps.
- **AWS public pricing JSON**: no effective date, so these lines start at the first collection.

Current catalog prices are never written into past time.

The chart uses 5-minute buckets for 1D, 30-minute for 1W, 2-hour for 1M, 6-hour for 3M. Each bucket shows the lowest value observed in it. Buckets run from the first to the last observation. Empty buckets in between stay empty and break the line.

Files in `.opennext-data/`, excluded from Git and static HTTP access:

- `capacity-state.json`: offering specifications, open segments, the latest quotes, the offerings whose bot observations have been imported, and the cached AWS Spot and tariff intervals. Version 2 state is upgraded without losing observations; old import markers are invalidated for the wider history window. It is rewritten atomically after each sync or history import. Size depends on the number of cached offerings and price changes.
- `capacity-segments.jsonl`: closed segments, append-only. It is compacted daily to one year and at most 500,000 segments.

A partial failure keeps existing history and reports partial coverage. If one catalog page fails, quotes from the pages that arrived are still used. Monitor the source schemas: the AWS and Azure feeds are public but not versioned for this use.

The earlier `capacity-observations.json` file from the first version of this chart is no longer read and can be deleted. The previous uploaded Spot history remains available through its original imported-history endpoint. It is not merged with this chart because its sampling and attribution differ.
