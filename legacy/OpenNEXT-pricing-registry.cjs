"use strict";

// This is a capability registry, not a list of successfully ingested suppliers.
// Unsupported adapters are intentionally visible and never report fake runs.
const PROVIDERS = [
  { id: "aws", name: "AWS", adapter: "aws-public", enabled: true, intervalMinutes: 15, credentialRequired: false, credentialEnv: null, docsUrl: "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api-fetching-price-list-files-manually.html", endpoints: [{ method: "GET", url: "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/{location}/Linux/index.json", term: "On-demand", auth: "Public AWS pricing-page feed (undocumented schema)" }, { method: "AWS SDK", url: "DescribeSpotPriceHistory", term: "Spot", auth: "AWS IAM ec2:DescribeSpotPriceHistory; optional installed AWS SDK" }], supportedTerms: ["On-demand"], pendingTerms: ["Spot", "Reserved"], scope: "Linux / shared tenancy / no preinstalled software; configured AWS Regions and verified GPU instance specifications only. Public catalog, not deployable inventory." },
  { id: "gcp", name: "GCP", docsUrl: "https://cloud.google.com/billing/docs/reference/rest/v1/services.skus/list", endpoints: [{method:"GET",url:"https://cloudbilling.googleapis.com/v1/services/{serviceId}/skus"}] },
  { id: "hyperstack", name: "Hyperstack", docsUrl: "https://docs.hyperstack.cloud/docs/billing/pricebook/", endpoints: [{method:"GET",url:"https://infrahub-api.nexgencloud.com/v1/pricebook"},{method:"GET",url:"https://infrahub-api.nexgencloud.com/v1/core/flavors"}] },
  { id: "vultr", name: "Vultr", adapter: "vultr-public", enabled: true, intervalMinutes: 60, credentialRequired: false, credentialEnv: "VULTR_API_KEY", docsUrl: "https://www.vultr.com/api/", endpoints: [{ method: "GET", url: "https://api.vultr.com/v2/plans-metal", term: "On-demand / Spot", auth: "Public catalog; no key required" }], supportedTerms: ["On-demand", "Spot"], scope: "Public bare-metal GPU catalog, including preemptible rates. Locations and deployment flags are retained; no stock quantity is inferred." },
  { id: "packet", name: "Packet.ai", docsUrl: "https://packet.ai/pricing", scope: "Packet.ai GPU cloud, distinct from retired Equinix Metal. Official public pricing page/API schema must be verified before enabling a collector." },
  { id: "lightning", name: "Lightning", docsUrl: "https://lightning.ai/docs/overview" },
  { id: "shadeform", name: "Shadeform", adapter: "shadeform", enabled: true, intervalMinutes: 60, credentialRequired: true, credentialEnv: "SHADEFORM_API_KEY", docsUrl: "https://docs.shadeform.ai/api-reference/instances/instances-types", endpoints: [{ method: "GET", url: "https://api.shadeform.ai/v1/instances/types", term: "On-demand / Spot", auth: "X-API-KEY header" }], supportedTerms: ["On-demand", "Spot"], scope: "Shadeform marketplace quotes, attributed to the underlying cloud. Top-level prices are cents; availability-entry override prices are USD. Not direct supplier account pricing." },
  { id: "vast", name: "Vast.ai", docsUrl: "https://docs.vast.ai/api-reference/search/search-offers" },
  { id: "crusoe", name: "Crusoe", docsUrl: "https://docs.crusoecloud.com/" },
  { id: "runpod", name: "RunPod", docsUrl: "https://docs.runpod.io/sdks/graphql/manage-pods", endpoints:[{method:"POST (read-only GraphQL)",url:"https://api.runpod.io/graphql"}] },
  { id: "aliyun", name: "Aliyun", docsUrl: "https://www.alibabacloud.com/help/en/ecs/developer-reference/api-ecs-2014-05-26-describeprice", endpoints:[{method:"Signed ECS action",url:"DescribePrice / DescribeSpotPriceHistory"}] },
  { id: "azure", name: "Azure", docsUrl: "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices", endpoints:[{method:"GET",url:"https://prices.azure.com/api/retail/prices"}] },
  { id: "modal", name: "Modal", docsUrl: "https://modal.com/docs/guide" },
  { id: "nebius", name: "Nebius", docsUrl: "https://docs.nebius.com/api/" },
  { id: "oci", name: "OCI", docsUrl: "https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Understanding_Cloud_Pricing.htm" },
  { id: "paperspace", name: "Paperspace", docsUrl: "https://docs.digitalocean.com/reference/paperspace/api-reference/" },
  { id: "tencent", name: "Tencent", docsUrl: "https://www.tencentcloud.com/document/api/213/15726" },
  { id: "volcengine", name: "Volcengine", docsUrl: "https://www.volcengine.com/docs/6396" },
  { id: "lambda", name: "Lambda", adapter: "lambda", enabled: true, intervalMinutes: 60, credentialRequired: true, credentialEnv: "LAMBDA_API_KEY", docsUrl: "https://docs.lambda.ai/api/cloud", endpoints: [{ method: "GET", url: "https://cloud.lambda.ai/api/v1/instance-types", term: "On-demand", auth: "Authorization: Bearer header" }], supportedTerms: ["On-demand"], scope: "Lambda account's instance-type catalog. price_cents_per_hour is the complete instance rate; regional capacity is a boolean, never an available GPU count." },
  { id: "tensordock", name: "TensorDock", docsUrl: "https://dashboard.tensordock.com/api/docs" },
  { id: "coreweave", name: "CoreWeave", docsUrl: "https://docs.coreweave.com/" },
  { id: "cudo", name: "CUDO Compute", docsUrl: "https://docs.cudocompute.com/", scope:"Historical reference only: the public On-demand platform closed on March 31, 2026. Current access requires direct provider confirmation. Collection remains disabled." },
  { id: "verda", name: "Verda / DataCrunch", docsUrl: "https://docs.verda.com/" },
  { id: "digitalocean", name: "DigitalOcean", docsUrl: "https://docs.digitalocean.com/reference/api/" },
].map((provider) => ({
  adapter: null,
  enabled: false,
  intervalMinutes: 60,
  credentialRequired: true,
  credentialEnv: null,
  endpoints: [],
  supportedTerms: [],
  pendingTerms: ["On-demand", "Spot", "Reserved"],
  scope: "Registered for integration. Pricing adapter is not implemented; credentials alone do not enable data collection. Consult the linked provider API documentation.",
  ...provider,
  pendingTerms: provider.pendingTerms || ["On-demand", "Spot", "Reserved"].filter((term) => !(provider.supportedTerms || []).includes(term)),
}));

const AWS_REGIONS = [
  ["us-east-1", "US East (N. Virginia)"],
  ["us-east-2", "US East (Ohio)"],
  ["us-west-2", "US West (Oregon)"],
  ["eu-west-1", "EU (Ireland)"],
  ["eu-central-1", "EU (Frankfurt)"],
  ["ap-northeast-1", "Asia Pacific (Tokyo)"],
  ["ap-southeast-1", "Asia Pacific (Singapore)"],
  ["ap-south-1", "Asia Pacific (Mumbai)"],
];

module.exports = { PROVIDERS, AWS_REGIONS };
