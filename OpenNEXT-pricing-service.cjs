"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PROVIDERS, AWS_REGIONS } = require("./OpenNEXT-pricing-registry.cjs");

const DAY = 86400000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_OBSERVATIONS = 200000;
const SPEC_SOURCE = "https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html";
const AWS_INSTANCE_SPECS = {};
function specs(family, model, counts, memoryGb = null) {
  for (const [size, count] of Object.entries(counts)) AWS_INSTANCE_SPECS[`${family}.${size}`] = { gpuModel: model, gpuCount: count, gpuMemoryGb: memoryGb };
}
// Counts come from AWS instance specifications, never from vCPU ratios or prices.
// P4 memory variants are explicitly verified at https://aws.amazon.com/ec2/instance-types/p4/ .
specs("p4d", "A100", { "24xlarge": 8 }, 40);
specs("p4de", "A100", { "24xlarge": 8 }, 80);
specs("p5", "H100", { "4xlarge": 1, "48xlarge": 8 }, 80);
specs("p5e", "H200", { "48xlarge": 8 }, 141);
specs("p5en", "H200", { "48xlarge": 8 }, 141);
specs("p6-b200", "B200", { "48xlarge": 8 });
specs("p6-b300", "B300", { "48xlarge": 8 });
// GB200 is a Grace Blackwell platform: do not merge its four B200 GPUs with HGX B200 quotes.
specs("p6e-gb200", "GB200", { "36xlarge": 4 });
const STANDARD_COUNTS = { xlarge: 1, "2xlarge": 1, "4xlarge": 1, "8xlarge": 1, "12xlarge": 4, "16xlarge": 1, "24xlarge": 4, "48xlarge": 8 };
specs("g5", "A10G", STANDARD_COUNTS);
specs("g6", "L4", STANDARD_COUNTS);
specs("g6e", "L40S", STANDARD_COUNTS);
specs("gr6", "L4", { "4xlarge": 1, "8xlarge": 1 });
specs("g4dn", "T4", { xlarge: 1, "2xlarge": 1, "4xlarge": 1, "8xlarge": 1, "12xlarge": 4, "16xlarge": 1, metal: 8 });
specs("g4ad", "V520", { xlarge: 1, "2xlarge": 1, "4xlarge": 1, "8xlarge": 2, "16xlarge": 4 });
specs("g5g", "T4G", { xlarge: 1, "2xlarge": 1, "4xlarge": 1, "8xlarge": 1, "16xlarge": 2, metal: 2 });
specs("g7", "RTX PRO 4500", { "2xlarge": 1, "4xlarge": 1, "8xlarge": 1, "12xlarge": 2, "24xlarge": 4, "48xlarge": 8 });
specs("g7e", "RTX PRO 6000", { "2xlarge": 1, "4xlarge": 1, "8xlarge": 1, "12xlarge": 2, "24xlarge": 4, "48xlarge": 8 });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeText(value, max = 180) { return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").slice(0, max) : ""; }
function gpuModel(value) {
  const text = safeText(value).toUpperCase().replace(/^(NVIDIA|AMD)[ _-]*/, "").replace(/_/g, " ");
  const match = text.match(/\b(GB200|GH200|H200|H100|B300|B200|A100|A10G|A10|L40S|L40|L4|A6000|A5000|MI355X|MI325X|MI300X|V100|T4G|T4|V520)\b/);
  return match ? match[1] : text.replace(/_/g, " ");
}
function termName(value) {
  if (/^(spot|preemptible)$/i.test(String(value))) return "Spot";
  if (/^(reserved|reservation)$/i.test(String(value))) return "Reserved";
  if (/^(on[-_ ]?demand|ondemand)$/i.test(String(value))) return "On-demand";
  return safeText(value, 40);
}
function positiveNumber(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function descriptionMemory(value) { const match = safeText(value).match(/\b(\d+(?:\.\d+)?)\s*GB\b/i); return match ? positiveNumber(match[1]) : null; }
function descriptionFormFactor(value) { const match = safeText(value).match(/(?:\b|_)(SXM\d*|PCI[eE])(?:\b|_)/i); return match ? match[1].toUpperCase().replace("PCIE", "PCIe") : null; }
function makeRecord(input) {
  const price = Number(input.instanceHourly);
  const count = Number(input.gpuCount);
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(count) || count <= 0 || !input.gpuModel || !input.instanceType) return null;
  const record = {
    provider: input.provider, gpuModel: gpuModel(input.gpuModel), instanceType: safeText(input.instanceType),
    region: safeText(input.region) || "unspecified", zone: input.zone ? safeText(input.zone) : null,
    term: termName(input.term), gpuCount: count, instanceHourly: price, perGpuHourly: Number((price / count).toFixed(10)),
    gpuMemoryGb: positiveNumber(input.gpuMemoryGb), gpuDescription: safeText(input.gpuDescription) || null,
    formFactor: input.formFactor ? safeText(input.formFactor, 40) : null,
    reportedGpuVramGb: positiveNumber(input.reportedGpuVramGb),
    currency: "USD", unit: "USD/GPU-hour", instanceUnit: "USD/instance-hour",
    observedAt: input.observedAt, effectiveAt: input.effectiveAt || null, sourceUrl: input.sourceUrl,
    priceKind: input.priceKind || "public_catalog", availability: input.availability ?? null,
    underlyingProvider: input.underlyingProvider ? safeText(input.underlyingProvider) : null,
    operatingSystem: input.operatingSystem || null, tenancy: input.tenancy || null,
    preinstalledSoftware: input.preinstalledSoftware || null, specSourceUrl: input.specSourceUrl || null,
    deploymentAllowed: typeof input.deploymentAllowed === "boolean" ? input.deploymentAllowed : null,
  };
  const identity = [record.provider, record.underlyingProvider, record.instanceType, record.region, record.zone, record.term, record.operatingSystem, record.tenancy, record.preinstalledSoftware];
  record.recordId = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  return record;
}

function normalizeAws(payload, region, sourceUrl, observedAt) {
  if (!payload || !payload.regions || typeof payload.regions !== "object") throw new Error("invalid_schema");
  const records = [];
  let unknownGpuTypes = 0;
  const unmappedInstanceTypes = new Set();
  for (const entries of Object.values(payload.regions)) {
    for (const row of Object.values(entries || {})) {
      if (!row || typeof row !== "object") continue;
      const type = row["Instance Type"];
      const spec = AWS_INSTANCE_SPECS[type];
      if (!spec) { if (/^(p\d|g\d|gr\d)/.test(type || "")) { unknownGpuTypes++; unmappedInstanceTypes.add(safeText(type)); } continue; }
      if (row["Operating System"] !== "Linux" || (row["Pre Installed S/W"] && row["Pre Installed S/W"] !== "NA")) continue;
      if (row.Tenancy && row.Tenancy !== "Shared") continue;
      const record = makeRecord({ provider: "aws", ...spec, instanceType: type, region, term: "On-demand", instanceHourly: row.price,
        observedAt, effectiveAt: payload.manifest?.hawkFilePublicationDate || null, sourceUrl, priceKind: "public_catalog",
        operatingSystem: "Linux", tenancy: "Shared", preinstalledSoftware: "NA", specSourceUrl: SPEC_SOURCE });
      if (record) records.push(record);
    }
  }
  return { records, unknownGpuTypes, unmappedInstanceTypes: [...unmappedInstanceTypes].sort() };
}

function normalizeVultr(payload, sourceUrl, observedAt) {
  if (!Array.isArray(payload?.plans_metal)) throw new Error("invalid_schema");
  const records = [];
  for (const row of payload.plans_metal) {
    if (!row.gpu_type || Number(row.gpu_count) <= 0) continue;
    const locations = Array.isArray(row.locations) && row.locations.length ? row.locations : ["unspecified"];
    for (const region of locations) {
      // A catalog rate remains meaningful when deploy_ondemand is false; retain that flag instead of claiming stock.
      for (const [term, field, flag] of [["On-demand", "hourly_cost", "deploy_ondemand"], ["Spot", "hourly_cost_preemptible", "deploy_preemptible"]]) {
        if (row[field] === undefined || row[field] === null) continue;
        const record = makeRecord({ provider: "vultr", gpuModel: row.gpu_type, gpuCount: row.gpu_count, instanceType: row.id,
          region, term, instanceHourly: row[field], observedAt, sourceUrl, deploymentAllowed: row[flag],
          gpuDescription: row.gpu_type, formFactor: descriptionFormFactor(row.gpu_type),
          // Preserve provider VRAM as reported. It may be aggregate allocation, so never label it per-GPU.
          reportedGpuVramGb: row.gpu_vram_gb, gpuMemoryGb: row.vram_per_gpu_in_gb });
        if (record) records.push(record);
      }
    }
  }
  return records;
}

function normalizeLambda(payload, sourceUrl, observedAt) {
  if (!payload?.data || typeof payload.data !== "object" || Array.isArray(payload.data)) throw new Error("invalid_schema");
  const records = [];
  for (const [key, row] of Object.entries(payload.data)) {
    const type = row.instance_type;
    if (!type) continue;
    const available = Array.isArray(row.regions_with_capacity_available) ? row.regions_with_capacity_available : [];
    const regions = available.length ? available : [{ name: "unspecified" }];
    for (const region of regions) {
      const record = makeRecord({ provider: "lambda", gpuModel: type.gpu_description, gpuCount: type.specs?.gpus,
        instanceType: type.name || key, region: region.name, term: "On-demand", instanceHourly: Number(type.price_cents_per_hour) / 100,
        observedAt, sourceUrl, priceKind: "account_catalog", availability: available.length ? { available: true, quantity: null } : null,
        gpuMemoryGb: descriptionMemory(type.gpu_description), gpuDescription: type.gpu_description, formFactor: descriptionFormFactor(type.gpu_description) });
      if (record) records.push(record);
    }
  }
  return records;
}

function normalizeShadeform(payload, sourceUrl, observedAt) {
  if (!Array.isArray(payload?.instance_types)) throw new Error("invalid_schema");
  const records = [];
  let missingSpotPrices = 0;
  for (const row of payload.instance_types) {
    const availability = Array.isArray(row.availability) && row.availability.length ? row.availability : [{ region: "unspecified", rental_type: "on_demand" }];
    for (const item of availability) {
      if (item.rental_type && !["spot", "on_demand"].includes(item.rental_type)) continue;
      const term = item.rental_type === "spot" ? "Spot" : "On-demand";
      // Shadeform's top-level integer is cents. The regional override is a decimal USD string (including Spot).
      // Never fall back to the on-demand top-level price for a Spot entry without its own quote.
      let hourly;
      if (item.hourly_price !== undefined && item.hourly_price !== null) hourly = Number(item.hourly_price);
      else if (term === "On-demand") hourly = Number(row.hourly_price) / 100;
      else { missingSpotPrices++; continue; }
      const record = makeRecord({ provider: "shadeform", underlyingProvider: row.cloud, gpuModel: row.configuration?.gpu_type,
        gpuCount: row.configuration?.num_gpus, instanceType: row.cloud_instance_type || row.shade_instance_type,
        region: item.region, term, instanceHourly: hourly, observedAt, sourceUrl, priceKind: "marketplace_quote",
        availability: typeof item.available === "boolean" ? { available: item.available, quantity: null } : null,
        gpuMemoryGb: row.configuration?.vram_per_gpu_in_gb, gpuDescription: row.configuration?.gpu_type,
        formFactor: descriptionFormFactor(row.configuration?.interconnect) });
      if (record) records.push(record);
    }
  }
  return { records, missingSpotPrices };
}

function createPricingService(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.OPENNEXT_PRICING_DATA_DIR || path.join(__dirname, ".opennext-data"));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const clock = options.clock || (() => new Date());
  const isoNow = () => new Date(clock()).toISOString();
  const millisNow = () => new Date(clock()).getTime();
  const statePath = path.join(dataDir, "pricing-state.json");
  const credentials = new Map();
  const pending = new Map();
  const controllers = new Set();
  let timer = null;
  let closed = false;
  let writeError = false;
  fs.mkdirSync(path.join(dataDir, "raw"), { recursive: true, mode: 0o700 });
  let state = { version: 1, preferences: {}, records: [], observations: [], runs: [] };
  try {
    const loaded = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (loaded.version === 1 && Array.isArray(loaded.records) && Array.isArray(loaded.runs) && Array.isArray(loaded.observations)) {
      state = { version: 1, preferences: loaded.preferences || {}, records: loaded.records, observations: loaded.observations, runs: loaded.runs };
      for (const run of state.runs) if (run.status === "running") { run.status = "failed"; run.finishedAt = isoNow(); run.logs = ["Collection interrupted by server restart; cached observations preserved."]; }
    }
  } catch (error) { if (error.code !== "ENOENT") writeError = true; }

  function persist() {
    try {
      const tmp = `${statePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(tmp, statePath);
      writeError = false;
    } catch (_) { writeError = true; }
  }
  function providerById(id) {
    const item = PROVIDERS.find((provider) => provider.id === id);
    if (!item) { const error = new Error("Unknown provider"); error.statusCode = 404; throw error; }
    return item;
  }
  function intervalFor(id) { return state.preferences[id]?.intervalMinutes || providerById(id).intervalMinutes; }
  function credential(provider) { return credentials.has(provider.id) ? credentials.get(provider.id) : (provider.credentialEnv ? process.env[provider.credentialEnv] || "" : ""); }
  function redactedPayload(value) {
    const knownKeys = PROVIDERS.map(credential).filter(Boolean);
    function visit(item) {
      if (typeof item === "string") {
        let output = item;
        for (const key of knownKeys) output = output.split(key).join("[REDACTED]");
        return output;
      }
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, /(^|_)(api[_-]?key|secret|password|authorization|access[_-]?token|private[_-]?key)($|_)/i.test(key) ? "[REDACTED]" : visit(val)]));
      return item;
    }
    return visit(value);
  }
  function providerView(provider) {
    const prefs = state.preferences[provider.id] || {};
    const latestRun = state.runs.find((run) => run.provider === provider.id) || null;
    const keyReady = !!credential(provider);
    let status = !provider.adapter ? "not_implemented" : provider.credentialRequired && !keyReady ? "needs_credentials" : latestRun?.status || "not_synced";
    return { ...provider, ...prefs, credentialConfigured: keyReady, adapterStatus: provider.adapter ? "implemented" : "not_implemented",
      status, recordCount: state.records.filter((row) => row.provider === provider.id).length,
      latestRun: latestRun ? clone(latestRun) : null,
      termStates: Object.fromEntries(["On-demand", "Spot", "Reserved"].map((term) => [term, provider.supportedTerms.includes(term) ? (provider.credentialRequired && !keyReady ? "needs_credentials" : "available") : provider.id === "aws" && term === "Spot" ? "needs_credentials" : "not_implemented"])),
      message: !provider.adapter ? "Adapter not implemented; no prices have been collected." : provider.credentialRequired && !keyReady ? "Configure a server-side API key to collect real quotes." : provider.id === "aws" ? "Public On-demand feed enabled. AWS Spot needs an IAM account and optional SDK; Reserved pricing is not yet ingested." : provider.scope };
  }
  function listProviders() { return { providers: PROVIDERS.map(providerView), updatedAt: isoNow(), scope: "Actual cached source observations only; registered suppliers are not necessarily connected." }; }
  function updateProvider(id, patch = {}) {
    const provider = providerById(id);
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") { const error = new Error("enabled must be boolean"); error.statusCode = 400; throw error; }
    if (patch.intervalMinutes !== undefined && (!Number.isInteger(patch.intervalMinutes) || patch.intervalMinutes < 5 || patch.intervalMinutes > 1440)) { const error = new Error("intervalMinutes must be an integer from 5 to 1440"); error.statusCode = 400; throw error; }
    const preference = { ...(state.preferences[id] || {}) };
    if (patch.enabled !== undefined) preference.enabled = patch.enabled;
    if (patch.intervalMinutes !== undefined) preference.intervalMinutes = patch.intervalMinutes;
    state.preferences[id] = preference;
    persist();
    return providerView(provider);
  }
  function setCredential(id, key) {
    const provider = providerById(id);
    if (!provider.adapter || !provider.credentialEnv) { const error = new Error("This provider does not accept API keys in this adapter"); error.statusCode = 400; throw error; }
    if (typeof key !== "string" || key.length > 4096 || /[\r\n\u0000]/.test(key)) { const error = new Error("Invalid API key"); error.statusCode = 400; throw error; }
    credentials.set(id, key.trim());
    // Deliberately never persist credentials; environment variables are the durable deployment path.
    return { ...providerView(provider), credentialStorage: "server_memory_until_restart" };
  }
  function rawSnapshot(name, payload) {
    try { fs.writeFileSync(path.join(dataDir, "raw", `${name}.json`), JSON.stringify(redactedPayload(payload)), { mode: 0o600 }); }
    catch (_) { writeError = true; }
  }
  async function fetchJson(url, headers = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    let timeout;
    try {
      const operation = (async () => {
        const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json", ...headers }, signal: controller.signal, redirect: "error" });
        if (!response.ok) { const error = new Error(`http_${response.status}`); error.httpStatus = response.status; throw error; }
        if (Number(response.headers?.get?.("content-length")) > MAX_BODY_BYTES) throw new Error("response_too_large");
        let raw;
        if (response.body && typeof response.body.getReader === "function") {
          const reader = response.body.getReader();
          const chunks = [];
          let bytes = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("response_too_large"); }
            chunks.push(Buffer.from(next.value));
          }
          raw = Buffer.concat(chunks).toString("utf8");
        } else if (typeof response.text === "function") raw = await response.text();
        else return redactedPayload(await response.json());
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error("response_too_large");
        return redactedPayload(JSON.parse(raw));
      })();
      return await Promise.race([operation, new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error("request_timeout")); }, options.timeoutMs || 18000); })]);
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function safeFailure(error) {
    if (error.httpStatus === 401 || error.httpStatus === 403) return "Provider rejected authentication or account permissions (HTTP 401/403).";
    if (error.httpStatus === 429) return "Provider rate limit reached (HTTP 429); cached prices preserved and scheduler backs off.";
    if (error.httpStatus) return `Provider returned HTTP ${error.httpStatus}; cached prices preserved.`;
    if (error.message === "invalid_schema") return "Provider response schema did not match the verified pricing adapter.";
    if (error.message === "response_too_large") return "Provider response exceeded the safe payload limit.";
    return "Provider request failed or timed out; cached prices preserved. Check server network and provider status.";
  }
  function awsRegions() {
    const configured = (process.env.OPENNEXT_AWS_REGIONS || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!configured.length) return AWS_REGIONS;
    return AWS_REGIONS.filter(([id]) => configured.includes(id));
  }
  async function collectAws(observedAt, run) {
    const records = [];
    const scopes = [];
    const failures = [];
    let unknown = 0;
    const unmappedInstanceTypes = new Set();
    const regions = awsRegions();
    if (!regions.length) throw new Error("invalid_schema");
    // Two parallel regional requests keep collection bounded and do not block cached public GET routes.
    for (let offset = 0; offset < regions.length; offset += 2) {
      await Promise.all(regions.slice(offset, offset + 2).map(async ([id, location]) => {
        const url = `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${encodeURIComponent(location)}/Linux/index.json`;
        try {
          const payload = await fetchJson(url);
          const normalized = normalizeAws(payload, id, url, observedAt);
          if (!normalized.records.length) throw new Error("invalid_schema");
          records.push(...normalized.records);
          unknown += normalized.unknownGpuTypes;
          normalized.unmappedInstanceTypes.forEach((type) => unmappedInstanceTypes.add(type));
          scopes.push({ region: id, term: "On-demand" });
          rawSnapshot(`aws-${id}`, { fetchedAt: observedAt, sourceUrl: url, payload });
          run.logs.push(`${id}: collected ${normalized.records.length} verified GPU catalog rates.`);
        } catch (error) { failures.push(id); run.logs.push(`${id}: ${safeFailure(error)}`); }
      }));
    }
    if (unknown) run.logs.push(`${unknown} unverified GPU instance entries excluded; specifications must be verified before normalization.`);
    // Optional SDK integration uses only AWS's credential chain, not browser-submitted access keys.
    if (process.env.OPENNEXT_AWS_SPOT_ENABLED === "1") {
      try {
        const result = await collectAwsSpot(observedAt, run, regions);
        records.push(...result.records); scopes.push(...result.scopes);
        if (result.gaps) failures.push("spot");
      } catch (_) { failures.push("spot"); run.logs.push("Spot not collected: configure AWS IAM ec2:DescribeSpotPriceHistory and install the optional @aws-sdk/client-ec2 dependency. On-demand remains independent."); }
    } else run.logs.push("Spot not requested: no AWS IAM account configured. Reserved pricing is not ingested. No historical prices were fabricated.");
    return { records, scopes, gaps: failures.length > 0 || unknown > 0, scope: { configuredRegions: regions.map(([id]) => id), collectedRegions: scopes.filter((item) => item.term === "On-demand").map((item) => item.region), failedRegions: failures, excludedUnverifiedGpuEntries: unknown, unmappedInstanceTypes: [...unmappedInstanceTypes].sort(), terms: [...new Set(scopes.map((item) => item.term))], os: "Linux", tenancy: "Shared", software: "NA" } };
  }
  async function collectAwsSpot(observedAt, run, regions) {
    const { EC2Client, DescribeSpotPriceHistoryCommand } = require("@aws-sdk/client-ec2");
    const records = [];
    const scopes = [];
    let gaps = false;
    for (const [region] of regions) {
      const client = new EC2Client({ region, maxAttempts: 2 });
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 18000);
      try {
        let nextToken;
        let pages = 0;
        do {
          const response = await client.send(new DescribeSpotPriceHistoryCommand({ InstanceTypes: Object.keys(AWS_INSTANCE_SPECS), ProductDescriptions: ["Linux/UNIX"], StartTime: new Date(millisNow() - 90 * DAY), EndTime: new Date(observedAt), MaxResults: 1000, NextToken: nextToken }), { abortSignal: controller.signal });
          for (const item of response.SpotPriceHistory || []) {
            const spec = AWS_INSTANCE_SPECS[item.InstanceType];
            if (!spec) continue;
            const row = makeRecord({ provider: "aws", ...spec, instanceType: item.InstanceType, region, zone: item.AvailabilityZone, term: "Spot", instanceHourly: item.SpotPrice, observedAt, effectiveAt: new Date(item.Timestamp).toISOString(), sourceUrl: "https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html", priceKind: "spot_history", operatingSystem: "Linux", tenancy: "Shared", specSourceUrl: SPEC_SOURCE });
            if (row) records.push(row);
          }
          nextToken = response.NextToken;
          pages++;
          if (pages >= 50 && nextToken) { gaps = true; break; }
        } while (nextToken);
        scopes.push({ region, term: "Spot" });
        run.logs.push(`${region}: collected authenticated Spot history (maximum 90 days; pagination bounded).`);
      } catch (_) { gaps = true; run.logs.push(`${region}: Spot authorization or SDK request failed; no substitutes generated.`); }
      finally { clearTimeout(timeout); controllers.delete(controller); client.destroy(); }
    }
    return { records, scopes, gaps };
  }
  async function collect(provider, observedAt, run) {
    if (provider.id === "aws") return collectAws(observedAt, run);
    const endpoint = provider.endpoints[0].url;
    const headers = provider.id === "lambda" ? { Authorization: `Bearer ${credential(provider)}` } : provider.id === "shadeform" ? { "X-API-KEY": credential(provider) } : {};
    let payload = await fetchJson(endpoint, headers);
    let records;
    let gaps = false;
    if (provider.id === "vultr") {
      if (!Array.isArray(payload?.plans_metal)) throw new Error("invalid_schema");
      const pages = [payload];
      const seen = new Set([endpoint]);
      let next = payload.meta?.links?.next;
      while (next) {
        const nextUrl = new URL(next, endpoint);
        // Provider-controlled paging links cannot turn this adapter into an SSRF relay.
        if (nextUrl.origin !== "https://api.vultr.com" || nextUrl.pathname !== "/v2/plans-metal" || nextUrl.username || nextUrl.password || seen.has(nextUrl.href) || pages.length >= 50) { gaps = true; break; }
        seen.add(nextUrl.href);
        try {
          const page = await fetchJson(nextUrl.href, headers);
          if (!Array.isArray(page?.plans_metal)) throw new Error("invalid_schema");
          pages.push(page);
          next = page.meta?.links?.next;
        } catch (error) { gaps = true; run.logs.push(`Pagination interrupted: ${safeFailure(error)}`); break; }
      }
      payload = { plans_metal: pages.flatMap((page) => page.plans_metal), meta: { pages: pages.length, truncated: gaps } };
      records = normalizeVultr(payload, endpoint, observedAt);
      if (gaps) run.logs.push("Catalog pagination was incomplete; this run is marked completed_with_gaps.");
    }
    if (provider.id === "lambda") records = normalizeLambda(payload, endpoint, observedAt);
    if (provider.id === "shadeform") {
      const result = normalizeShadeform(payload, endpoint, observedAt);
      records = result.records; gaps = result.missingSpotPrices > 0;
      if (gaps) run.logs.push(`${result.missingSpotPrices} Spot entries missing their own price were excluded; On-demand prices were not substituted.`);
    }
    rawSnapshot(provider.id, { fetchedAt: observedAt, sourceUrl: endpoint, payload });
    if (!records?.length) throw new Error("invalid_schema");
    return { records, scopes: null, gaps, scope: { endpoint, terms: [...new Set(records.map((row) => row.term))] } };
  }
  function storeCollection(provider, result) {
    const fresh = new Map();
    // Spot history can contain multiple prices for a record; cache only the latest effective quote.
    for (const row of result.records) {
      const old = fresh.get(row.recordId);
      if (!old || Date.parse(row.effectiveAt || row.observedAt) >= Date.parse(old.effectiveAt || old.observedAt)) fresh.set(row.recordId, row);
    }
    state.records = state.records.filter((row) => row.provider !== provider.id || (result.scopes && !result.scopes.some((scope) => scope.region === row.region && scope.term === row.term)) || (result.gaps && !fresh.has(row.recordId))).concat([...fresh.values()]);
    const existing = new Set(state.observations.map((row) => `${row.recordId}|${row.historyAt || row.observedAt}|${row.instanceHourly}`));
    for (const row of result.records) {
      // Public catalogs are sampled observations, not effective-date historical series.
      const time = row.priceKind === "spot_history" ? row.effectiveAt : row.observedAt;
      const sample = { ...row, historyAt: time };
      const id = `${row.recordId}|${row.priceKind === "spot_history" ? row.effectiveAt : row.observedAt}|${row.instanceHourly}`;
      if (!existing.has(id)) { existing.add(id); state.observations.push(sample); }
    }
    state.observations = state.observations.filter((row) => Date.parse(row.historyAt || row.observedAt) >= millisNow() - 365 * DAY).sort((a, b) => Date.parse(a.historyAt || a.observedAt) - Date.parse(b.historyAt || b.observedAt)).slice(-MAX_OBSERVATIONS);
  }
  function startRun(id) {
    const provider = providerById(id);
    if (closed) { const error = new Error("Pricing service is closed"); error.statusCode = 503; throw error; }
    if (pending.has(id)) return clone(state.runs.find((run) => run.id === pending.get(id).id));
    const run = { id: crypto.randomUUID(), provider: id, status: "running", mode: "incremental", startedAt: isoNow(), finishedAt: null, records: 0, logs: [], scope: null };
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, 500);
    if (!provider.adapter) { run.status = "failed"; run.logs.push("Adapter is registered but not implemented. No provider API was called."); run.finishedAt = isoNow(); persist(); return clone(run); }
    if (provider.credentialRequired && !credential(provider)) { run.status = "needs_credentials"; run.logs.push("No server-side API key configured. Credentials are never requested by public Terminal endpoints."); run.finishedAt = isoNow(); persist(); return clone(run); }
    persist();
    const promise = Promise.resolve().then(async () => {
      try {
        const result = await collect(provider, run.startedAt, run);
        if (closed) return;
        if (!result.records.length) { run.status = "failed"; run.logs.push("No valid source prices collected. Existing cache preserved."); }
        else { storeCollection(provider, result); run.status = result.gaps ? "completed_with_gaps" : "completed"; run.records = result.records.length; run.scope = result.scope; run.logs.push(`Stored ${result.records.length} real pricing observations; no capacity quantities inferred.`); }
      } catch (error) { run.status = error.httpStatus === 401 || error.httpStatus === 403 ? "needs_credentials" : "failed"; run.logs.push(safeFailure(error)); }
      finally { run.finishedAt = isoNow(); run.logs = run.logs.slice(-40); pending.delete(id); persist(); }
    });
    pending.set(id, { id: run.id, promise });
    return clone(run);
  }
  function testProvider(id) { return startRun(id); }
  function listRuns(filters = {}) { providerByIdIfPresent(filters.provider); return { runs: clone(state.runs.filter((run) => !filters.provider || run.provider === filters.provider).slice(0, 100)) }; }
  function getRun(id) { const run = state.runs.find((item) => item.id === id); if (!run) { const error = new Error("Unknown run"); error.statusCode = 404; throw error; } return clone(run); }
  function providerByIdIfPresent(id) { if (id && id !== "all" && id !== "All providers") providerById(id); }
  function matches(row, filters) {
    const requestedGpu = filters.gpuModel || filters.gpu;
    const requestedCount = filters.gpuCount || filters.count;
    const requestedRegion = filters.region;
    const requestedProvider = filters.provider;
    if (requestedProvider && requestedProvider !== "all" && row.provider !== requestedProvider) return false;
    if (requestedGpu && requestedGpu !== "all" && row.gpuModel !== gpuModel(requestedGpu)) return false;
    if (requestedRegion && !/^(all|all regions)$/i.test(requestedRegion) && row.region !== requestedRegion) return false;
    if (filters.zone && row.zone !== filters.zone) return false;
    if (filters.instanceType && row.instanceType !== filters.instanceType) return false;
    if (filters.gpuMemoryGb && row.gpuMemoryGb !== Number(filters.gpuMemoryGb)) return false;
    if (filters.formFactor && (!row.formFactor || row.formFactor.toLowerCase() !== String(filters.formFactor).toLowerCase())) return false;
    if (requestedCount && requestedCount !== "all" && row.gpuCount !== Number(requestedCount)) return false;
    if (filters.term && filters.term !== "all" && row.term !== termName(filters.term)) return false;
    return true;
  }
  function metaFor(filters, records) {
    const providers = filters.provider && filters.provider !== "all" ? [providerView(providerById(filters.provider))] : PROVIDERS.map(providerView);
    const times = records.map((row) => row.observedAt).filter(Boolean).sort();
    const latest = times.at(-1) || null;
    const staleCount = records.filter((row) => millisNow() - Date.parse(row.observedAt) > intervalFor(row.provider) * 3 * 60000).length;
    const stale = staleCount > 0;
    const requestedTerm = termName(filters.term || "On-demand");
    let status = records.length ? stale ? "stale" : "ready" : providers.some((item) => item.latestRun?.status === "running") ? "collecting" : "empty";
    if (!records.length && filters.provider === "aws" && requestedTerm === "Spot") status = "needs_credentials";
    if (!records.length && requestedTerm === "Reserved") status = "not_implemented";
    return { status, stale, staleCount, fetchedAt: latest, generatedAt: isoNow(), count: records.length, currency: "USD", unit: "USD/GPU-hour", instanceUnit: "USD/instance-hour", inventoryKnown: false, storageWarning: writeError ? "Pricing persistence unavailable; inspect server data directory permissions." : null,
      source: "server-side provider adapters", configuredAwsRegions: awsRegions().map(([id]) => id),
      message: status === "needs_credentials" ? "AWS Spot history requires an AWS IAM account. No Spot prices or history are synthesized." : status === "not_implemented" ? "Reserved/commitment pricing is not ingested by this adapter." : !records.length ? "No real cached prices match these filters. Synchronize the provider or choose an available catalog model/region/count." : "Public catalog or account quote, not an executable procurement offer. Taxes, storage, network and negotiated discounts may differ.",
      providers: providers.map((item) => ({ id: item.id, status: item.status, latestRun: item.latestRun, recordCount: item.recordCount, termStates: item.termStates })) };
  }
  function getPrices(filters = {}) {
    providerByIdIfPresent(filters.provider);
    const records = state.records.filter((row) => matches(row, filters)).sort((a, b) => a.perGpuHourly - b.perGpuHourly);
    const limit = Math.max(1, Math.min(5000, Number(filters.limit) || 1000));
    return { records: clone(records.slice(0, limit).map((row) => ({ ...row, stale: millisNow() - Date.parse(row.observedAt) > intervalFor(row.provider) * 3 * 60000 }))), meta: { ...metaFor(filters, records), total: records.length, truncated: records.length > limit } };
  }
  function getHistory(filters = {}) {
    // Terminal curves deliberately use AWS only, never a blend of unrelated supplier quotes.
    const query = { ...filters, provider: "aws" };
    const periods = { "1D": 1, "3D": 3, "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };
    const period = String(filters.period || "1M").toUpperCase();
    const days = periods[period] || 30;
    const from = millisNow() - days * DAY;
    const rows = state.observations.filter((row) => matches(row, query) && Date.parse(row.historyAt || row.observedAt) >= from && Date.parse(row.historyAt || row.observedAt) <= millisNow());
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.recordId)) groups.set(row.recordId, { id: row.recordId, recordId: row.recordId, provider: row.provider, region: row.region, zone: row.zone, instanceType: row.instanceType, gpuModel: row.gpuModel, gpuCount: row.gpuCount, gpuMemoryGb: row.gpuMemoryGb ?? null, formFactor: row.formFactor ?? null, term: row.term, currency: row.currency, unit: row.unit, sourceUrl: row.sourceUrl, priceKind: row.priceKind, points: [] });
      groups.get(row.recordId).points.push({ time: row.historyAt || row.observedAt, value: row.perGpuHourly, perGpuHourly: row.perGpuHourly, instanceHourly: row.instanceHourly, observedAt: row.observedAt, effectiveAt: row.effectiveAt });
    }
    const series = [...groups.values()].map((group) => {
      group.points.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      // Only downsample actual stored points. Never interpolate or backfill a missing time range.
      if (group.points.length > 1000) { const points = group.points; group.points = Array.from({ length: 1000 }, (_, index) => points[Math.round(index * (points.length - 1) / 999)]); }
      return group;
    });
    const observed = rows.map((row) => row.historyAt || row.observedAt).sort();
    const latestRows = new Map();
    for (const row of rows) { const previous = latestRows.get(row.recordId); if (!previous || Date.parse(row.observedAt) > Date.parse(previous.observedAt)) latestRows.set(row.recordId, row); }
    const meta = { ...metaFor(query, [...latestRows.values()]), period, requestedFrom: new Date(from).toISOString(), requestedTo: isoNow(), actualFrom: observed[0] || null, actualTo: observed.at(-1) || null, pointCount: series.reduce((sum, item) => sum + item.points.length, 0), seriesCount: series.length, retentionDays: 365, maxStoredObservations: MAX_OBSERVATIONS, storageCapReached: state.observations.length >= MAX_OBSERVATIONS, synthetic: false,
      historyKind: termName(query.term || "On-demand") === "Spot" ? "provider_event_history" : "observed_catalog_snapshots",
      message: !rows.length ? metaFor(query, rows).message : "AWS observations saved after collection began. On-demand is a sampled catalog history, not a retrospective market curve; missing history is never fabricated." };
    return { series: clone(series), meta };
  }
  function tick() {
    if (closed) return;
    for (const provider of PROVIDERS) {
      const view = providerView(provider);
      if (!view.enabled || !provider.adapter || (provider.credentialRequired && !credential(provider)) || pending.has(provider.id)) continue;
      const latest = view.latestRun;
      const failures = state.runs.filter((run) => run.provider === provider.id).slice(0, 5).findIndex((run) => ["completed", "completed_with_gaps"].includes(run.status));
      const factor = latest && ["failed", "needs_credentials"].includes(latest.status) ? Math.pow(2, Math.min(4, failures < 0 ? 4 : failures)) : 1;
      if (!latest || millisNow() - Date.parse(latest.startedAt) >= view.intervalMinutes * 60000 * factor) startRun(provider.id);
    }
  }
  function startScheduler() { if (!timer && !closed) { tick(); timer = setInterval(tick, 30000); timer.unref?.(); } }
  async function close() { closed = true; if (timer) clearInterval(timer); timer = null; for (const controller of controllers) controller.abort(); await Promise.allSettled([...pending.values()].map((item) => item.promise)); credentials.clear(); persist(); }
  return { listProviders, getPrices, getHistory, listRuns, getRun, startRun, updateProvider, setCredential, testProvider, startScheduler, close };
}

module.exports = { createPricingService, normalizeAws, normalizeVultr, normalizeLambda, normalizeShadeform, makeRecord, AWS_INSTANCE_SPECS };
