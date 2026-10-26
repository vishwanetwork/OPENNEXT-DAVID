/** Research metadata, not executable connectors or availability claims. Checked 2026-10-27. */
export type ProviderReference = {
  docs: string;
  endpoints: string[];
  auth: string;
  coverage: string;
  limitation: string;
};

export const PROVIDER_REFERENCES: Record<string, ProviderReference> = {
  aws: {
    docs: 'https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html',
    endpoints: [
      'AWS Price List: GetProducts / public AmazonEC2 bulk offer files',
      'EC2: DescribeSpotPriceHistory',
      'EC2: DescribeReservedInstancesOfferings',
    ],
    auth: 'Public bulk files; signed IAM requests for EC2 / Pricing APIs.',
    coverage: 'On-demand, Spot history, Reserved offerings.',
    limitation:
      'Reserved effective hourly cost must include upfront payments and commitment length. Prices do not establish deployable inventory.',
  },
  gcp: {
    docs: 'https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api',
    endpoints: [
      'GET https://cloudbilling.googleapis.com/v1/services/{serviceId}/skus',
      'GET https://cloudbilling.googleapis.com/v2beta/skus',
      'GET https://cloudbilling.googleapis.com/v1beta/skus/{skuId}/prices',
    ],
    auth: 'API key for public prices; IAM / OAuth for billing-account contract rates.',
    coverage:
      'Public GPU SKUs, including Spot; consumption models and contract SKUs require mapping.',
    limitation:
      'A commitment discount is not a capacity reservation. GPU, CPU and RAM SKUs must be combined accurately.',
  },
  hyperstack: {
    docs: 'https://docs.hyperstack.cloud/docs/billing/pricebook/',
    endpoints: [
      'GET https://infrahub-api.nexgencloud.com/v1/pricebook',
      'GET https://infrahub-api.nexgencloud.com/v1/core/flavors',
    ],
    auth: 'api_key header, server-side.',
    coverage: 'Account hourly rates, including -spot GPU resources and contract discounts.',
    limitation:
      'Pricebook includes unavailable resources; join flavors and capacity separately. Reserved terms need account-contract metadata.',
  },
  vultr: {
    docs: 'https://www.vultr.com/api/',
    endpoints: ['GET https://api.vultr.com/v2/plans', 'GET https://api.vultr.com/v2/plans-metal'],
    auth: 'Public catalog in the existing adapter; authenticated account operations use Bearer API token.',
    coverage: 'GPU catalog and preemptible rates where explicitly returned.',
    limitation: 'Honor deployment flags and regions. No Reserved feed has been verified.',
  },
  packet: {
    docs: 'https://dash.packet.ai/docs/ai',
    endpoints: [
      'GET /api/v1/launch-options (Packet API; confirm production base from current OpenAPI)',
      'GET https://packet.ai/api/openapi',
    ],
    auth: 'Provider API key; confirm current OpenAPI security requirements.',
    coverage: 'Products, pricePerHourCents, GPU pools and availability.',
    limitation:
      'Dynamic/shared is not automatically Spot. Contract clusters need a quote; OpenNEXT adapter is not implemented.',
  },
  lightning: {
    docs: 'https://api.lightning.ai/pricing/',
    endpoints: [],
    auth: 'Public price page; no verified public GPU price-catalog API.',
    coverage: 'Published GPU and interruptible compute rates.',
    limitation:
      'API schema, permitted collection and enterprise contract pricing require provider confirmation.',
  },
  shadeform: {
    docs: 'https://docs.shadeform.ai/api-reference/instances/instances-types',
    endpoints: ['GET https://api.shadeform.ai/v1/instances/types'],
    auth: 'X-API-KEY header.',
    coverage:
      'Instance specifications, hourly prices and region-level rental types / availability.',
    limitation:
      'Retain the underlying cloud. Top-level prices are cents; regional overrides require their documented unit. Reserved contract support needs confirmation.',
  },
  vast: {
    docs: 'https://docs.vast.ai/api-reference/search/search-offers',
    endpoints: ['POST https://console.vast.ai/api/v0/bundles (read-only offer search)'],
    auth: 'Authorization: Bearer API key.',
    coverage: 'On-demand and interruptible offer search using documented type filters.',
    limitation:
      'Per-offer storage, network and rental conditions differ. Do not infer a Reserved contract from an hourly offer.',
  },
  crusoe: {
    docs: 'https://docs.crusoecloud.com/api/',
    endpoints: ['GET https://api.cloud.crusoe.ai/v1/projects/{project_id}/compute/vms/types'],
    auth: 'Crusoe account credentials and project permissions.',
    coverage: 'VM hardware types; pricing requires the account rate card / approved price source.',
    limitation:
      'The VM types response is not a complete public price feed. Do not reuse managed-inference prices for GPU VMs.',
  },
  runpod: {
    docs: 'https://docs.runpod.io/sdks/graphql/manage-pods',
    endpoints: ['POST https://api.runpod.io/graphql (read-only gpuTypes / gpuType queries)'],
    auth: 'Runpod API key, held on the server.',
    coverage: 'GPU catalog and on-demand / interruptible price fields subject to GraphQL schema.',
    limitation:
      'Secure / community cloud, regional supply and storage differ. Reserved pricing must be verified separately.',
  },
  aliyun: {
    docs: 'https://www.alibabacloud.com/help/en/ecs/developer-reference/api-ecs-2014-05-26-describeprice',
    endpoints: ['ECS DescribePrice', 'ECS DescribeSpotPriceHistory'],
    auth: 'Signed Alibaba Cloud OpenAPI requests using scoped RAM credentials.',
    coverage: 'Pay-as-you-go / subscription quotes, capacity-reservation pricing and Spot history.',
    limitation:
      'China / international accounts may use different currency. Preserve currency and quote configuration; verify Reserved Instance commercial terms separately.',
  },
  azure: {
    docs: 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices',
    endpoints: ['GET https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview'],
    auth: 'Unauthenticated public retail catalog.',
    coverage: 'Consumption, Spot / low-priority meters, Reservation and savings-plan prices.',
    limitation:
      'Follow NextPageLink; preserve region, OS, meter and commitment terms. Savings plans are not guaranteed stock.',
  },
  modal: {
    docs: 'https://modal.com/pricing',
    endpoints: [],
    auth: 'Public pricing page; no verified public GPU price-catalog API.',
    coverage: 'Serverless GPU, CPU and memory resource rates.',
    limitation:
      'Serverless execution is not interchangeable with a rented GPU instance. No verified Spot / Reserved instance-price feed.',
  },
  nebius: {
    docs: 'https://docs.nebius.com/signup-billing/spot-prices',
    endpoints: [
      'GET https://api.nebius.cloud/billing/v1alpha1/spot-price',
      'GET https://api.nebius.cloud/billing/v1alpha1/spot-price/list-series',
    ],
    auth: 'Public Spot prices and history require no authentication.',
    coverage: 'Current per-GPU Spot prices by platform / region and up to 30 days of history.',
    limitation:
      'Follow nextPageToken. History supports 15-minute steps up to 7 days, otherwise hourly. On-demand / commitment feeds and the OpenNEXT adapter remain pending.',
  },
  oci: {
    docs: 'https://www.oracle.com/cloud/price-list/',
    endpoints: [],
    auth: 'Public price list; signed OCI account APIs for resources.',
    coverage: 'Published GPU rates and commitment terms.',
    limitation:
      'No stable documented all-terms GPU price-catalog API verified in this review. GPU preemptible availability must be verified per shape.',
  },
  paperspace: {
    docs: 'https://docs.digitalocean.com/reference/paperspace/api-reference/machine-types/',
    endpoints: [
      'GET https://api.paperspace.com/v1/machine-availability?machineType={type}&region={region}',
    ],
    auth: 'Authorization: Bearer API key.',
    coverage: 'Per-type / region availability; this endpoint does not return prices.',
    limitation:
      'A separate approved rate source is needed; Spot / Reserved price feeds are unverified.',
  },
  tencent: {
    docs: 'https://www.tencentcloud.com/document/product/213/33248',
    endpoints: ['CVM InquiryPriceRunInstances', 'CVM DescribeReservedInstancesOfferings'],
    auth: 'Tencent Cloud signed API requests and scoped account credentials.',
    coverage: 'Configuration-specific hourly / prepaid quotes and Reserved offerings.',
    limitation: 'Verify Spot strategy and regional SKU support; a quote does not reserve capacity.',
  },
  volcengine: {
    docs: 'https://docs.volcengine.com/docs/ecs/Elastic-Compute-Service-API-overview?lang=zh',
    endpoints: ['ECS DescribeSpotPriceHistory', 'ECS DescribeInstanceTypes'],
    auth: 'Signed Volcengine OpenAPI requests; scoped AccessKey credentials.',
    coverage: 'Spot history and hardware types.',
    limitation:
      'On-demand quote / Reserved-price contracts need confirmation before ingestion. Never label owned reservations as public stock.',
  },
  lambda: {
    docs: 'https://docs.lambda.ai/api/cloud',
    endpoints: ['GET https://cloud.lambda.ai/api/v1/instance-types'],
    auth: 'Authorization: Bearer API key.',
    coverage: 'On-demand instance prices in cents/hour and region availability.',
    limitation:
      'Rate applies to the entire instance. Availability is boolean, not a GPU count; Spot / Reserved catalog not verified.',
  },
  tensordock: {
    docs: 'https://dashboard.tensordock.com/api/docs',
    endpoints: [],
    auth: 'Provider account API credentials; current API specification requires confirmation.',
    coverage:
      'Official documentation describes host availability; current price schema not verified.',
    limitation:
      'API reference access was restricted during review. Do not enable a guessed legacy endpoint.',
  },
  coreweave: {
    docs: 'https://docs.coreweave.com/reference-home',
    endpoints: [],
    auth: 'Account / organization API credentials.',
    coverage: 'Infrastructure APIs; negotiated resource pricing requires an account agreement.',
    limitation:
      'No verified public all-terms GPU price-catalog endpoint. Obtain approved rate card and commercial access.',
  },
  cudo: {
    docs: 'https://www.cudocompute.com/',
    endpoints: [],
    auth: 'Direct enterprise contact; public on-demand collection remains disabled.',
    coverage: 'Enterprise GPU cluster proposals.',
    limitation:
      'Existing registry marks the old public on-demand platform closed. Confirm current service and API access directly before enabling.',
  },
  verda: {
    docs: 'https://api.verda.com/v1/docs',
    endpoints: [
      'GET https://api.verda.com/v1/instance-types',
      'GET https://api.verda.com/v1/instance-availability',
      'GET https://api.verda.com/v1/long-term/periods/instances',
    ],
    auth: 'Public catalog endpoints; account operations use OAuth2 client-credentials Bearer tokens.',
    coverage:
      'Instance specifications, hourly / Spot prices, regional availability and long-term periods.',
    limitation:
      'The OpenNEXT adapter is pending. Join availability separately and resolve long-term period discounts to exact instance prices; do not use deprecated price-history.',
  },
  digitalocean: {
    docs: 'https://docs.digitalocean.com/reference/api/reference/sizes/',
    endpoints: ['GET https://api.digitalocean.com/v2/sizes'],
    auth: 'Bearer token with sizes:read and regions:read.',
    coverage: 'Droplet sizes, GPU specifications, hourly price and available regions.',
    limitation:
      'GPU-capable sizes must be filtered explicitly. No verified Spot / Reserved price feed; do not confuse dedicated inference with Droplets.',
  },
};
