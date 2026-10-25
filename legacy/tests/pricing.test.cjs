"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPricingService, normalizeAws, normalizeVultr, normalizeLambda, normalizeShadeform, AWS_INSTANCE_SPECS } = require("../OpenNEXT-pricing-service.cjs");

const AT = "2026-10-13T01:00:00.000Z";
const URL = "https://example.test/pricing";
const AWS_FIXTURE = {
  manifest: { hawkFilePublicationDate: "2026-10-12T19:39:25Z" },
  regions: { "US East (N. Virginia)": {
    b200: { "Instance Type": "p6-b200.48xlarge", "Operating System": "Linux", "Pre Installed S/W": "NA", price: "80.00" },
    h100: { "Instance Type": "p5.48xlarge", "Operating System": "Linux", "Pre Installed S/W": "NA", price: "40.00" },
    single: { "Instance Type": "p5.4xlarge", "Operating System": "Linux", "Pre Installed S/W": "NA", price: "6.00" },
    windows: { "Instance Type": "p5.48xlarge", "Operating System": "Windows", price: "44.00" },
    sql: { "Instance Type": "p5.48xlarge", "Operating System": "Linux", "Pre Installed S/W": "SQL Std", price: "50.00" },
    cpu: { "Instance Type": "m6g.xlarge", "Operating System": "Linux", price: "0.50" },
  } },
};
function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) }; }
async function fixture(t, fetchImpl, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opennext-pricing-test-"));
  const service = createPricingService({ dataDir: dir, clock: () => AT, fetchImpl, timeoutMs: 100, ...overrides });
  t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, dir };
}
async function settled(service, run) {
  for (let i = 0; i < 100; i++) { const current = service.getRun(run.id); if (current.status !== "running") return current; await new Promise((resolve) => setTimeout(resolve, 2)); }
  throw new Error("Fixture collection did not settle");
}

test("AWS normalization uses verified GPU counts, Linux/shared/no-software scope and per-instance prices", () => {
  const payload = JSON.parse(JSON.stringify(AWS_FIXTURE));
  payload.regions["US East (N. Virginia)"].future = { "Instance Type": "p9.unknown", "Operating System": "Linux", price: "1.00" };
  const result = normalizeAws(payload, "us-east-1", URL, AT);
  assert.equal(result.records.length, 3);
  const b200 = result.records.find((row) => row.gpuModel === "B200");
  assert.equal(b200.instanceHourly, 80);
  assert.equal(b200.perGpuHourly, 10);
  assert.equal(b200.gpuCount, 8);
  assert.equal(b200.availability, null);
  assert.equal(b200.operatingSystem, "Linux");
  assert.equal(b200.tenancy, "Shared");
  assert.equal(b200.effectiveAt, "2026-10-12T19:39:25Z");
  assert.equal(result.unknownGpuTypes, 1);
  assert.deepEqual(result.unmappedInstanceTypes, ["p9.unknown"]);
  assert.equal(result.records.find((row) => row.instanceType === "p5.4xlarge").gpuCount, 1);
  assert.equal(AWS_INSTANCE_SPECS["p6e-gb200.36xlarge"].gpuCount, 4);
  assert.equal(AWS_INSTANCE_SPECS["p6e-gb200.36xlarge"].gpuModel, "GB200");
});

test("Vultr keeps public On-demand and preemptible prices distinct and never infers stock", () => {
  const rows = normalizeVultr({ plans_metal: [{ id: "gpu-8-a100", gpu_type: "NVIDIA_A100_SXM", gpu_count: 8, hourly_cost: 24, hourly_cost_preemptible: 12, locations: [], deploy_ondemand: false, deploy_preemptible: true }] }, URL, AT);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].gpuModel, "A100");
  assert.equal(rows[0].region, "unspecified");
  assert.equal(rows[0].availability, null);
  assert.equal(rows[0].formFactor, "SXM");
  assert.equal(rows[0].gpuMemoryGb, null);
  assert.equal(rows[0].deploymentAllowed, false);
  assert.equal(rows[0].perGpuHourly, 3);
  assert.equal(rows[1].term, "Spot");
  assert.equal(rows[1].perGpuHourly, 1.5);
  assert.notEqual(rows[0].recordId, rows[1].recordId);
});

test("Lambda cents describe the whole instance and missing capacity is not fictional regions", () => {
  const rows = normalizeLambda({ data: { gpu_8x_h100: { instance_type: { name: "gpu_8x_h100", gpu_description: "H100 (80 GB SXM5)", price_cents_per_hour: 3200, specs: { gpus: 8 } }, regions_with_capacity_available: [{ name: "us-east-1" }] }, gpu_1x_a100: { instance_type: { name: "gpu_1x_a100", gpu_description: "A100", price_cents_per_hour: 100, specs: { gpus: 1 } }, regions_with_capacity_available: [] } } }, URL, AT);
  assert.equal(rows[0].instanceHourly, 32);
  assert.equal(rows[0].perGpuHourly, 4);
  assert.equal(rows[0].gpuMemoryGb, 80);
  assert.equal(rows[0].formFactor, "SXM5");
  assert.deepEqual(rows[0].availability, { available: true, quantity: null });
  assert.equal(rows[1].region, "unspecified");
  assert.equal(rows[1].availability, null);
});

test("Shadeform regional decimal USD overrides never divide Spot by 100 or borrow On-demand prices", () => {
  const result = normalizeShadeform({ instance_types: [{ cloud: "hyperstack", cloud_instance_type: "gpu_8x_a100", configuration: { gpu_type: "A100", num_gpus: 8 }, hourly_price: 1600, availability: [{ region: "us-central-1", available: true, rental_type: "on_demand" }, { region: "us-central-1", available: false, rental_type: "spot", hourly_price: "8.00" }, { region: "us-central-2", rental_type: "spot" }] }] }, URL, AT);
  assert.equal(result.records.length, 2);
  assert.equal(result.missingSpotPrices, 1);
  assert.equal(result.records[0].instanceHourly, 16);
  assert.equal(result.records[1].instanceHourly, 8);
  assert.equal(result.records[1].perGpuHourly, 1);
  assert.equal(result.records[1].underlyingProvider, "hyperstack");
  assert.equal(result.records[1].priceKind, "marketplace_quote");
  assert.deepEqual(result.records[1].availability, { available: false, quantity: null });
});

test("cached public reads never fetch, jobs are single-flight, and unsupported providers stay honest", async (t) => {
  let calls = 0;
  const { service } = await fixture(t, async () => { calls++; return response(AWS_FIXTURE); });
  assert.equal(service.getPrices({ provider: "aws" }).records.length, 0);
  assert.equal(service.getHistory({ gpuModel: "B200" }).series.length, 0);
  assert.equal(calls, 0);
  const run = service.startRun("aws");
  assert.equal(service.startRun("aws").id, run.id);
  const result = await settled(service, run);
  assert.equal(result.status, "completed");
  assert.ok(calls > 0);
  const prices = service.getPrices({ provider: "aws", gpuModel: "B200", gpuCount: 8, region: "us-east-1", term: "On-demand" });
  assert.equal(prices.records.length, 1);
  assert.equal(prices.records[0].perGpuHourly, 10);
  assert.equal(service.getPrices({ provider: "aws", gpuModel: "RTX 4090" }).records.length, 0);
  assert.equal(service.getPrices({ provider: "aws", term: "Spot" }).meta.status, "needs_credentials");
  assert.equal(service.getPrices({ provider: "aws", term: "Reserved" }).meta.status, "not_implemented");
  const before = calls;
  const unsupported = service.startRun("gcp");
  assert.equal(unsupported.status, "failed");
  assert.equal(calls, before);
  assert.equal(service.listProviders().providers.find((item) => item.id === "gcp").adapterStatus, "not_implemented");
});

test("On-demand history begins at actual collection time and survives restart without backfilling", async (t) => {
  let current = AT;
  const { service, dir } = await fixture(t, async () => response(AWS_FIXTURE), { clock: () => current });
  await settled(service, service.startRun("aws"));
  current = "2026-10-14T01:00:00.000Z";
  await settled(service, service.startRun("aws"));
  const result = service.getHistory({ gpuModel: "B200", region: "us-east-1", gpuCount: 8, term: "On-demand", period: "1Y" });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].points.length, 2);
  assert.equal(result.series[0].points[0].time, AT);
  assert.equal(result.meta.actualFrom, AT);
  assert.equal(result.meta.synthetic, false);
  assert.equal(result.meta.historyKind, "observed_catalog_snapshots");
  await service.close();
  const restarted = createPricingService({ dataDir: dir, fetchImpl: async () => { throw new Error("should not fetch"); }, clock: () => current });
  assert.equal(restarted.getHistory({ gpuModel: "B200", region: "us-east-1", gpuCount: 8, term: "On-demand", period: "1Y" }).series[0].points.length, 2);
  await restarted.close();
});

test("legacy recorded-history service recognizes 3D without falling back to its monthly internal default", async t => {
  let current=AT;
  const {service}=await fixture(t,async()=>response(AWS_FIXTURE),{clock:()=>current});
  for(const time of [AT,'2026-10-14T01:00:00.000Z','2026-10-17T01:00:00.000Z']){
    current=time;await settled(service,service.startRun('aws'));
  }
  const query={gpuModel:'B200',region:'us-east-1',gpuCount:8,term:'On-demand',period:'3D'};
  const result=service.getHistory(query);
  assert.equal(result.meta.requestedFrom,'2026-10-14T01:00:00.000Z');
  assert.equal(result.meta.requestedTo,current);
  assert.deepEqual(result.series[0].points.map(point=>point.time),['2026-10-14T01:00:00.000Z','2026-10-17T01:00:00.000Z']);
  assert.equal(service.getHistory({...query,period:'1M'}).series[0].points.length,3);
});

test("partial AWS regional failure retains that region's last successful cache and marks gaps", async (t) => {
  let fail = false;
  let current = AT;
  const { service } = await fixture(t, async (url) => {
    if (fail && url.includes("Virginia")) return response({}, 503);
    return response(AWS_FIXTURE);
  }, { clock: () => current });
  await settled(service, service.startRun("aws"));
  fail = true;
  current = "2026-10-13T02:00:00.000Z";
  const second = await settled(service, service.startRun("aws"));
  assert.equal(second.status, "completed_with_gaps");
  assert.equal(service.getPrices({ provider: "aws", region: "us-east-1", gpuModel: "B200" }).records[0].observedAt, AT);
  assert.equal(service.getPrices({ provider: "aws", region: "us-east-2", gpuModel: "B200" }).records[0].observedAt, current);
  assert.ok(second.scope.failedRegions.includes("us-east-1"));
});

test("keys are server-memory-only, sent only in provider auth header, and redacted from snapshots and failures", async (t) => {
  const key = "test-secret-never-store-123";
  let captured;
  const { service, dir } = await fixture(t, async (url, options) => {
    captured = { url, options };
    return response({ data: { gpu_1x_h100: { instance_type: { name: "gpu_1x_h100", gpu_description: "H100", price_cents_per_hour: 400, specs: { gpus: 1 } }, regions_with_capacity_available: [{ name: "us-east-1" }] } }, api_key: key, reflection: key });
  });
  service.setCredential("lambda", key);
  await settled(service, service.startRun("lambda"));
  assert.equal(captured.url, "https://cloud.lambda.ai/api/v1/instance-types");
  assert.equal(captured.options.headers.Authorization, `Bearer ${key}`);
  assert.equal(JSON.stringify(service.listProviders()).includes(key), false);
  assert.equal(fs.readFileSync(path.join(dir, "pricing-state.json"), "utf8").includes(key), false);
  assert.equal(fs.readFileSync(path.join(dir, "raw", "lambda.json"), "utf8").includes(key), false);
  assert.equal(service.getPrices({ provider: "lambda" }).records.length, 1);
  await service.close();
  const restarted = createPricingService({ dataDir: dir, clock: () => AT, fetchImpl: async () => response({}) });
  assert.equal(restarted.listProviders().providers.find((item) => item.id === "lambda").credentialConfigured, !!process.env.LAMBDA_API_KEY);
  await restarted.close();
});

test("authentication failure never returns provider body or thrown secret-bearing errors", async (t) => {
  const key = "bad-secret-fixture-key";
  const { service } = await fixture(t, async () => response({ error: `invalid ${key}` }, 401));
  service.setCredential("shadeform", key);
  const result = await settled(service, service.startRun("shadeform"));
  assert.equal(result.status, "needs_credentials");
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.match(result.logs.join(" "), /authentication/);
});

test("provider preferences validate input and do not let request bodies persist credentials", async (t) => {
  const { service, dir } = await fixture(t, async () => response({}));
  assert.throws(() => service.updateProvider("aws", { intervalMinutes: 0 }), /intervalMinutes/);
  assert.throws(() => service.updateProvider("aws", { enabled: "yes" }), /enabled/);
  assert.throws(() => service.startRun("unknown"), /Unknown provider/);
  const provider = service.updateProvider("aws", { enabled: false, intervalMinutes: 30, apiKey: "ignored-key" });
  assert.equal(provider.enabled, false);
  assert.equal(provider.intervalMinutes, 30);
  assert.equal(fs.readFileSync(path.join(dir, "pricing-state.json"), "utf8").includes("ignored-key"), false);
});

test("Vultr follows same-origin pagination and rejects off-origin links without requesting them", async (t) => {
  const calls = [];
  const plan = (id, cost) => ({ id, gpu_type: "NVIDIA_H100", gpu_count: 8, hourly_cost: cost, locations: ["fra"] });
  const { service } = await fixture(t, async (url) => {
    calls.push(url);
    if (url.includes("cursor=")) return response({ plans_metal: [plan("second", 32)], meta: { links: { next: "https://untrusted.test/collect" } } });
    return response({ plans_metal: [plan("first", 40)], meta: { links: { next: "https://api.vultr.com/v2/plans-metal?cursor=next" } } });
  });
  const run = await settled(service, service.startRun("vultr"));
  assert.equal(run.status, "completed_with_gaps");
  assert.equal(service.getPrices({ provider: "vultr" }).records.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((url) => url.includes("untrusted")), false);
});

test("per-region stale prices are flagged even when another region has a fresh quote", async (t) => {
  let current = AT;
  let fail = false;
  const { service } = await fixture(t, async (url) => fail && url.includes("Virginia") ? response({}, 503) : response(AWS_FIXTURE), { clock: () => current });
  await settled(service, service.startRun("aws"));
  current = "2026-10-13T03:00:00.000Z";
  fail = true;
  await settled(service, service.startRun("aws"));
  const result = service.getPrices({ provider: "aws", gpuModel: "B200" });
  assert.equal(result.meta.stale, true);
  assert.equal(result.meta.staleCount, 1);
  assert.equal(result.records.find((row) => row.region === "us-east-1").stale, true);
  assert.equal(result.records.find((row) => row.region === "us-east-2").stale, false);
});

test("fresh history is not stale merely because its chart contains older observations", async (t) => {
  let current = AT;
  const { service } = await fixture(t, async () => response(AWS_FIXTURE), { clock: () => current });
  await settled(service, service.startRun("aws"));
  current = "2026-10-13T03:00:00.000Z";
  await settled(service, service.startRun("aws"));
  const history = service.getHistory({ gpuModel: "B200", period: "1D" });
  assert.ok(history.series[0].points.length >= 2);
  assert.equal(history.meta.stale, false);
  assert.equal(history.meta.staleCount, 0);
});

test("A100 40 GB and 80 GB allocations stay distinct and unknown form factor cannot match PCIe", async (t) => {
  const payload = JSON.parse(JSON.stringify(AWS_FIXTURE));
  const region = payload.regions["US East (N. Virginia)"];
  region.a100_40 = { "Instance Type": "p4d.24xlarge", "Operating System": "Linux", "Pre Installed S/W": "NA", price: "16.00" };
  region.a100_80 = { "Instance Type": "p4de.24xlarge", "Operating System": "Linux", "Pre Installed S/W": "NA", price: "24.00" };
  const { service } = await fixture(t, async () => response(payload));
  await settled(service, service.startRun("aws"));
  const all = service.getPrices({ provider: "aws", region: "us-east-1", gpuModel: "A100" }).records;
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((row) => row.gpuMemoryGb).sort((a, b) => a - b), [40, 80]);
  const eighty = service.getPrices({ provider: "aws", region: "us-east-1", gpuModel: "A100", gpuMemoryGb: 80 }).records;
  assert.equal(eighty.length, 1);
  assert.equal(eighty[0].instanceType, "p4de.24xlarge");
  assert.equal(eighty[0].perGpuHourly, 3);
  assert.equal(service.getPrices({ provider: "aws", gpuModel: "H100", formFactor: "PCIe" }).records.length, 0);
  const history = service.getHistory({ gpuModel: "A100", gpuMemoryGb: 80, region: "us-east-1" });
  assert.equal(history.series.length, 1);
  assert.equal(history.series[0].gpuMemoryGb, 80);
});
