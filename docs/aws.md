# AWS EC2 Spot

Protected server rentals use a separate lifecycle described in
[rentals.md](rentals.md). The legacy `/v1/orders` disk-deletion and explicit-release
behavior below remains unchanged. Rentals preserve all enrolled root/data EBS
volumes and require additional snapshot, image, volume, and queue permissions.

Install `.[aws]` and add `aws` to `SPOTBOT_ENABLED_PROVIDERS`. The Docker image already includes Boto3. AWS uses the SDK credential chain: an EC2 instance role in the deployment, or standard process environment credentials for development. No AWS access keys are stored by the application. Credentials inside a dotenv file must be exported to the SDK process, such as through Compose `env_file`.

`SPOTBOT_AWS_REGIONS` defaults to `us-west-2` and accepts a comma-separated list. Configure a key-pair name and the dedicated GPU security group once. An empty VPC selects each Region's default VPC; the collector selects an existing subnet for each quoted Availability Zone. The deployed network is public and has an internet-gateway route. Custom networks must provide the configured public/private connectivity.

The default NVIDIA image is resolved through the public SSM parameter `/aws/service/deeplearning/ami/<architecture>/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id`. It includes the NVIDIA OSS driver. AMD, legacy K80/V100/M60, and fractional GPU instances requiring GRID/vGPU drivers need a custom compatible image through `SPOTBOT_AWS_IMAGE_ID`. Architecture must match the selected image. The adapter enlarges the configured minimum root disk to meet the image's required disk size. Encrypted gp3 root volumes are deleted with the instance.

Catalog records preserve `region` and `availability_zone`; the zone participates in the offer ID. Existing non-AWS offer IDs and order fingerprints remain compatible. Linux Spot prices come from `DescribeSpotPriceHistory`; observations are saved in the configured store. History and latest-price filters can use an `offer_id` to select one zone.

## Ninety-day Spot history

When AWS and the background worker are enabled, a separate read-only task backfills Linux GPU Spot price changes for every configured Region and GPU instance type. It uses `ec2:DescribeInstanceTypes` and `ec2:DescribeSpotPriceHistory`; it does not submit orders. The initial request covers the AWS 90-day window, with a one-minute boundary margin. AWS also returns the effective predecessor before the requested start. New GPU types and zones may have shorter histories.

Set `SPOTBOT_AWS_SPOT_HISTORY_ENABLED=false` to disable this task. Successful series refresh daily (`SPOTBOT_AWS_SPOT_HISTORY_INTERVAL_SECONDS=86400`); failed series retry after ten minutes. Committed per-series coverage checkpoints resume subsequent requests with a one-hour overlap. Failed or interrupted requests do not advance coverage. Event identity is Region, SKU, Availability Zone and vendor effective timestamp, so retries do not duplicate events. SQLite and MySQL use dedicated `aws_spot_changes` and `aws_spot_coverage` tables; DynamoDB uses separate `AWS_SPOT_HISTORY#<region>#<sku>` partitions. Saved history has no automatic retention deletion.

`GET /v1/prices/aws-spot-history?region=us-west-2&sku=g5.xlarge` requires the usual Bearer token. Optional timezone-aware `since` and `until` delimit a window of at most 90 days; `limit` (up to 5,000) and `offset` paginate ascending price-change events. Pin both dates when paging. The response includes completed `coverage`, vendor `effective_at`, zone, and USD per **instance-hour**. A predecessor per zone is included to establish the effective price at the start. An empty or missing coverage is not a promise of available capacity. Historical events never enter `/v1/prices/latest`, executable offers or order processing. The existing `/v1/prices/history` continues to return the bot's collection snapshots with their original observation times.

The chart bridge uses these events to reconstruct effective intervals and takes the lowest zone price at each change within one Region and SKU. AWS confirms historical price validity only through `coverage.until`; live bot observations cover subsequent time. It divides instance prices by the verified physical GPU count. Published historical prices do not establish capacity or quota eligibility.

Source: [AWS DescribeSpotPriceHistory](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html).

## Historical On-demand and Reserved tariffs

The worker also backfills the official EC2 Price List Bulk archives over the most recent 90 days. It reads the service version index and downloads only configured Regions. CSV files are streamed with bounded memory, a 2 GiB size limit and a 15-minute per-file limit; full price lists are not retained on disk. Only Linux, shared tenancy, no pre-installed software, no license charge, Used capacity and OnDemand market rows for GPU instance types are kept. Currency is USD and rates are per instance-hour. Reserved is one year, No Upfront, standard or convertible (the lower eligible rate in that version wins); positive upfront charges and three-year terms are excluded.

`SPOTBOT_AWS_LIST_HISTORY_ENABLED=true` enables the separate read-only task whenever AWS and the background worker are enabled. `SPOTBOT_AWS_LIST_HISTORY_INTERVAL_SECONDS=86400` checks the index daily. Immutable versions already stored with the same GPU specification set are reused. Failed versions retry after ten minutes; only complete downloads are committed. No additional IAM pricing permissions are needed for the public archive URLs; the existing `ec2:DescribeInstanceTypes` permission identifies GPU instances.

Filtered archive versions and index checkpoints are persisted in `aws_list_archive` in SQLite/MySQL or `AWS_LIST_ARCHIVE#<region>` in DynamoDB. They never replace current catalog batches or enter order processing. A version is an atomic document, guarded by DynamoDB's existing item-size check. History has no automatic deletion policy. Documents retain source URL, version, AWS product SKU, rate code, term effective date and retrieval time for audit.

`GET /v1/prices/aws-list-history?region=us-west-2&sku=g5.xlarge` requires Bearer authentication. Timezone-aware `since` and `until` select at most 90 days. Pin both dates when paging with `limit` (maximum 5,000) and `offset`. `kind=published_price_intervals` distinguishes these records from observed snapshots and Spot change events. Responses include On-demand/Reserved `market`, `price_hourly`, `effective_at`, inclusive `valid_from`, exclusive `valid_until`, version and commitment attributes. `pending` and `missing_versions` report incomplete archive imports; existing successful versions remain queryable.

An interval begins at the later of the version's effective beginning and the term's own effective date. It ends at the version's effective ending or the last index check. Some Reserved term dates occur late in the month even when the archive version starts at the beginning of the month. Earlier unconfirmed days remain gaps; unchanged prices in adjacent snapshots are not proof of uninterrupted historical validity. Newly introduced GPU sizes and unavailable one-year terms can have shorter coverage. The chart retains genuine live observations outside confirmed archive intervals and does not backdate today's rates.

Sources: [AWS version validity](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/service-version-index-file-for-aws-service.html), [price-list fields and term effective dates](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-file-for-services.html).

## Price-only Regions

`SPOTBOT_AWS_PRICE_REGIONS` adds Regions that are collected for price references only. Orders, quotas, networks and images stay limited to `SPOTBOT_AWS_REGIONS`; the combined list (order Regions first) drives current prices, list prices and both history backfills.

- Current Spot: every `SPOTBOT_AWS_PRICE_REGION_INTERVAL_SECONDS` (one hour by default) the bot records one offer per GPU instance type and price-only Region, priced at the lowest current zone. These offers have no Availability Zone and `orderable=false` with `eligibility_status=price_only_region`; `details` records `lowest_zone` and `zone_count`. They form a separate `aws_regions` catalog batch. Each sweep makes `DescribeInstanceTypes` and `DescribeSpotPriceHistory` calls per Region. The SDK lock is released between Regions, and a failing Region is skipped without discarding the others.
- List prices: price-only Regions keep On-demand and the No Upfront Reserved terms; order Regions keep every term.
- History: the 90-day Spot change backfill and the archived On-demand/Reserved backfill cover every price Region. The first run for new Regions downloads one archive CSV per Region and version and can take hours. Later daily runs reuse stored versions.

The role needs `ec2:DescribeInstanceTypes` and `ec2:DescribeSpotPriceHistory` in each price-only Region. The deployed role grants them in a separate `ReadGpuPricesAllRegions` statement without the order-Region condition.

## On-demand and Reserved list prices

The bot also reads published Linux On-demand and Reserved rates for GPU instances in `SPOTBOT_AWS_REGIONS` from the AWS Price List API (`pricing:GetProducts`, served from `us-east-1`). Filters: shared tenancy, no pre-installed software, no license charge, and the On-demand market option (excluding Capacity Blocks). These offers have `price_kind=list`, no Availability Zone, and `orderable=false` with `eligibility_status=list_price_only`. They are price references; the bot cannot buy On-demand or Reserved capacity.

- `market=on_demand`: the hourly On-demand rate.
- `market=reserved`: one offer per term. `details` records `lease_contract_length` (`1yr` or `3yr`), `purchase_option` (No, Partial or All Upfront), `offering_class` (`standard` or `convertible`), `upfront_usd` and `recurring_hourly_usd`. `price_hourly` is the effective hourly cost: the recurring rate plus the upfront payment spread over 8,760 or 26,280 hours. Some families are sold only on some terms; for example, P5 has no one-year standard Reserved Instance, only one-year convertible.
- `effective_at`: the price list's `effectiveDate`. It records the price-list version that contains the rate, not when the rate first applied. On-demand rates currently carry the first day of the month and Reserved rates the publication day.

List prices refresh every `SPOTBOT_AWS_LIST_PRICE_INTERVAL_SECONDS` (6 hours by default), not every Spot cycle. They are recorded as a separate catalog batch named `aws_list`, so `latest` keeps them between refreshes and history grows by about 1,200 rows (about 1.2 MB) per refresh for two Regions. A failed refresh keeps the previous batch, is reported as `last_list_price_collection` on `/v1/providers`, and is retried after 30 minutes. Set `SPOTBOT_AWS_LIST_PRICES_ENABLED=false` to turn it off. Current list prices cover every price Region (see above).

Quota checks estimate remaining G/VT and P Spot vCPUs across the account in each Region. They count pending/running Spot instances and open/active Spot requests, deduplicate fulfilled requests by instance ID, and include VT transcoders in the G/VT bucket. This includes resources launched outside the bot. Unknown instance/request specifications fail closed instead of advertising eligibility. `quota_vcpus`, `quota_used_vcpus`, `quota_remaining_vcpus`, and `quota_usage_known` explain the result. Describe APIs provide a snapshot, not a quota reservation; concurrent launches, eventual consistency, and fleet behavior can still cause AWS to reject a launch. AWS remains authoritative.

AWS quotes have `available=false` and `capacity_status=unknown` because AWS does not confirm stock through the pricing API. `orderable=true` means that configured launch prerequisites and the observed remaining quota permit a request. `can_attempt=true` additionally requires a fresh quote and no recent quota/capacity rejection. These fields never guarantee a purchase. Query `/v1/prices/latest?provider=aws&can_attempt_only=true` for candidates. For GPU lookup use `/v1/gpus?model=H100&available_only=false&can_attempt_only=true`. `available_only=true` excludes AWS's unknown stock, while other providers can expose their catalog's availability snapshot.

Orders refresh account usage before each billable submission. Insufficient observed quota queues the order without calling `RunInstances`. Known native quota rejection queues a retry and exposes `eligibility_status=quota_rejected_at_launch`; known capacity rejection exposes `capacity_status=unavailable`. Both pause attempts for `SPOTBOT_AWS_CAPACITY_BACKOFF_SECONDS` (60 seconds by default). The failure cache is local to the worker and resets to unknown after restart. Waiting expiration preserves the last blocking error. Only successful allocation and provider monitoring establish that an individual instance exists and is ready.

For partitioned GPUs, `gpu_count` is the number of logical GPU devices. `details.gpu_count_kind`, `physical_gpu_count`, and `gpu_specifications` expose the partition fraction and memory. `price_per_gpu_hourly` is per logical device in these records; do not compare a fractional GPU to a full GPU without checking its specifications.

Every order launches exactly one VM. Orders use `MarketType=spot`, a one-time request, interruption behavior `terminate`, the scheduler's `max_price_hourly` as AWS `MaxPrice`, and a deterministic `ClientToken`. Quote checks run again before submission. Root disks and network interfaces have `DeleteOnTermination=true`; instances and volumes carry `spotbot-managed=true` and the deterministic order name.

The limit covers the EC2 Spot compute rate, not EBS, public IPv4, network transfer, taxes, or a total spend budget. GPU image contents do not automatically start a model endpoint. Use `cloud_init` to start the workload, and have the gateway verify its health before routing traffic. Releasing an order terminates its instance and verifies termination.

AWS SDK retries are disabled for the adapter. Definite capacity errors return the order to the queue; uncertain mutation outcomes require reconciliation. Inspection searches the configured Regions. Deletion verifies the management tag before calling `TerminateInstances`.

The deployed role can read EC2 catalogs, public GPU-image parameters, and quota values; create tagged GPU Spot instances using approved network resources and the `test` key pair; tag resources during launch; and terminate only tagged managed instances. It can read the AWS Price List (`pricing:GetProducts`, which does not support resource-level scoping, so it is granted in its own statement on `*` without the Region condition). It cannot change IAM, network configuration, or launch on-demand instances. The host administrator provisions the AWS Spot service-linked role separately. When adding Regions, extend the role's allowed resources and network defaults as well.

The deployed service enables live orders and sets `SPOTBOT_DRY_RUN_ENABLED=false`. Orders default to `dry_run=false`; explicit simulations are rejected. Authentication and a business `Idempotency-Key` remain required. Changing environment settings requires recreating the container with `docker compose -p spotbot -f compose.production.yaml up -d --force-recreate`; restarting the same container does not reload its environment.

## Deployment regions and quotas

The production installation collects `us-west-2` and `us-east-1`. It discovers each Region's default VPC, zonal subnets, and the dedicated `spotbot-gpu` group. The `test` key pair is registered in both Regions; only its public key was imported into `us-east-1`. GPU ingress allows SSH and port 8000 from the deployment host; the east-region group permits its public IP only.

On 2026-10-14, the applied P Spot quota was 64 vCPUs in `us-west-2` and 16 vCPUs in `us-east-1`. The G/VT Spot quota was zero. An 8-vCPU G/VT Spot increase was requested in `us-west-2`; AWS opened support case `179194673600708`. Query Service Quotas for its current approval state before relying on G-family capacity.

Real `RunInstances` requests were tested in all four configured west-region Availability Zones and all five launch-eligible east-region Availability Zones, in ascending price order within each regional test. All nine requests failed for capacity; no GPU instance was created. Resource audits found no managed instances, volumes, or active Spot requests. All test orders are terminal, so the worker will not continue purchasing for them. Actual GPU startup and SSH/HTTP verification remain unvalidated until capacity is allocated.

The live test exposed and fixed the handling of a known capacity error returned as HTTP 500: the bot queues a retry instead of treating this definite failure as an uncertain purchase. AWS CloudTrail confirmed `Server.InsufficientInstanceCapacity` for the west-region attempts. The original misclassified order was corrected to `failed` only after checking AWS for its exact management tag and order name and confirming no instance existed.
