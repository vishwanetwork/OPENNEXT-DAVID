"use strict";

// Public catalog prices only. An entry is not a guarantee of deployable stock.
// Vultr quotes per instance: consumers normalize hourly_cost / gpu_count.
const SOURCE_URL = "https://api.vultr.com/v2/plans-metal";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const WINDOWS_FETCH_TIMEOUT_MS = 4000;
const SNAPSHOT_AT = "2026-10-12T13:27:14.000Z";

// Exact public API observation, retained for an offline local preview.
// Empty locations are deliberately retained, rather than invented availability.
const SNAPSHOT = [
  { gpu_type: "NVIDIA_A100", gpu_count: 4, hourly_cost: 9.589, hourly_cost_preemptible: 9.589, locations: [], deploy_ondemand: true, deploy_preemptible: true },
  { gpu_type: "NVIDIA_H100", gpu_count: 8, hourly_cost: 23.92, hourly_cost_preemptible: 18.4, locations: [], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "NVIDIA_A100_SXM", gpu_count: 8, hourly_cost: 22.4, hourly_cost_preemptible: 11.92, locations: [], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "NVIDIA_L40S", gpu_count: 8, hourly_cost: 13.368, hourly_cost_preemptible: 11.92, locations: [], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "NVIDIA_GH200", gpu_count: 1, hourly_cost: 1.99, hourly_cost_preemptible: 1.99, locations: ["fra"], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "AMD_MI300X", gpu_count: 8, hourly_cost: 31.92, hourly_cost_preemptible: 14.8, locations: [], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "AMD_MI325X", gpu_count: 8, hourly_cost: 36.92, hourly_cost_preemptible: 16, locations: [], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "NVIDIA_B200", gpu_count: 8, hourly_cost: 68, hourly_cost_preemptible: 25.6, locations: [], deploy_ondemand: false, deploy_preemptible: true },
  { gpu_type: "AMD_MI355X", gpu_count: 8, hourly_cost: 20.72, hourly_cost_preemptible: 20.72, locations: [], deploy_ondemand: false, deploy_preemptible: true },
];

let cachedPlans = SNAPSHOT;
let fetchedAt = SNAPSHOT_AT;
let lastAttemptAt = 0;
let pendingRefresh = null;

function marketResult(status) {
  return {
    status,
    fetchedAt,
    source: SOURCE_URL,
    rateUnit: "USD/instance-hour",
    plans: cachedPlans.map((plan) => ({ ...plan, locations: [...plan.locations] })),
  };
}

function normalizePlans(payload) {
  if (!payload || !Array.isArray(payload.plans_metal)) {
    throw new Error("Invalid public GPU catalog response");
  }
  const plans = payload.plans_metal
    .filter((plan) => typeof plan.gpu_type === "string" && /^(NVIDIA|AMD)_/.test(plan.gpu_type))
    .map((plan) => {
      const gpuCount = Number(plan.gpu_count);
      const hourly = Number(plan.hourly_cost);
      const preemptible = Number(plan.hourly_cost_preemptible);
      if (!Number.isFinite(gpuCount) || gpuCount <= 0 || !Number.isFinite(hourly) || hourly < 0) return null;
      return {
        gpu_type: plan.gpu_type,
        gpu_count: gpuCount,
        hourly_cost: hourly,
        hourly_cost_preemptible: Number.isFinite(preemptible) && preemptible >= 0 ? preemptible : null,
        locations: Array.isArray(plan.locations) ? plan.locations.filter((region) => typeof region === "string") : [],
        deploy_ondemand: plan.deploy_ondemand === true,
        deploy_preemptible: plan.deploy_preemptible === true,
      };
    })
    .filter(Boolean);
  if (!plans.length) throw new Error("Public GPU catalog contains no valid GPU plans");
  return plans;
}

async function fetchPublicCatalog() {
  const abort = new AbortController();
  let timer;
  try {
    if (typeof fetch !== "function") throw new Error("Native fetch is unavailable");
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("Public GPU catalog request timed out"));
      }, FETCH_TIMEOUT_MS);
    });
    const request = (async () => {
      const response = await fetch(SOURCE_URL, {
        signal: abort.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Public GPU catalog HTTP ${response.status}`);
      return normalizePlans(await response.json());
    })();
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function fetchPublicCatalogOnWindows() {
  if (process.platform !== "win32") return Promise.reject(new Error("Windows network fallback is unavailable"));
  const { execFile } = require("node:child_process");
  const powershell = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  // No user values, credentials, files, or private account endpoints enter this command.
  // Native Windows HTTPS respects the system proxy used by this local preview host.
  const command = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -Uri 'https://api.vultr.com/v2/plans-metal' -UseBasicParsing -TimeoutSec 3).Content";
  return new Promise((resolve, reject) => {
    execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      timeout: WINDOWS_FETCH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        resolve(normalizePlans(JSON.parse(stdout.replace(/^\uFEFF/, "").trim())));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function refreshMarket() {
  lastAttemptAt = Date.now();
  try {
    try {
      cachedPlans = await fetchPublicCatalog();
    } catch {
      cachedPlans = await fetchPublicCatalogOnWindows();
    }
    fetchedAt = new Date().toISOString();
    return marketResult("live");
  } catch {
    // Preserve the previous verified response and its original observation time.
    return marketResult("cached");
  }
}

async function getMarket() {
  if (pendingRefresh) return pendingRefresh;
  if (Date.now() - lastAttemptAt < CACHE_TTL_MS) return marketResult("cached");
  pendingRefresh = refreshMarket().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

module.exports = { getMarket };
