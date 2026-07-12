import { performance } from "node:perf_hooks";

const baseUrl = new URL(process.env.LOAD_TEST_BASE_URL || "http://127.0.0.1:4173");
const allowRemote = process.env.LOAD_TEST_ALLOW_REMOTE === "true";
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (!localHosts.has(baseUrl.hostname) && !allowRemote) {
  throw new Error("Remote load tests are disabled. Use a disposable staging target and set LOAD_TEST_ALLOW_REMOTE=true.");
}

const phases = (process.env.LOAD_TEST_PHASES || "5:10,25:10,50:10,75:10")
  .split(",")
  .map((phase) => {
    const [rps, seconds] = phase.split(":").map(Number);
    if (!Number.isFinite(rps) || !Number.isFinite(seconds) || rps <= 0 || seconds <= 0) {
      throw new Error(`Invalid LOAD_TEST_PHASES entry: ${phase}`);
    }
    return { rps, seconds };
  });

const requestTimeoutMs = Number(process.env.LOAD_TEST_REQUEST_TIMEOUT_MS || 5000);
const p95LimitMs = Number(process.env.LOAD_TEST_P95_MS || 500);
const maxErrorRate = Number(process.env.LOAD_TEST_MAX_ERROR_RATE || 0.01);
const requestPath = process.env.LOAD_TEST_PATH || "/api/health/live";
const method = process.env.LOAD_TEST_METHOD || "GET";
const bearer = process.env.LOAD_TEST_BEARER_TOKEN;
const body = process.env.LOAD_TEST_BODY;
const durations = [];
let requests = 0;
let failures = 0;
const statuses = new Map();

async function runRequest() {
  const startedAt = performance.now();
  requests += 1;
  try {
    const response = await fetch(new URL(requestPath, baseUrl), {
      method,
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    await response.arrayBuffer();
    statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
    if (response.status < 200 || response.status >= 400) failures += 1;
  } catch {
    failures += 1;
    statuses.set("network", (statuses.get("network") || 0) + 1);
  } finally {
    durations.push(performance.now() - startedAt);
  }
}

for (const phase of phases) {
  const pending = [];
  const intervalMs = 1000 / phase.rps;
  const total = Math.floor(phase.rps * phase.seconds);
  const phaseStartedAt = performance.now();
  for (let index = 0; index < total; index += 1) {
    const targetAt = phaseStartedAt + index * intervalMs;
    const waitMs = targetAt - performance.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    pending.push(runRequest());
  }
  await Promise.all(pending);
  console.log(`Completed ${phase.rps} RPS x ${phase.seconds}s (${total} requests).`);
}

durations.sort((left, right) => left - right);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] || 0;
const p50 = percentile(0.5);
const p95 = percentile(0.95);
const errorRate = requests === 0 ? 1 : failures / requests;

console.log(JSON.stringify({
  target: `${baseUrl.origin}${requestPath}`,
  requests,
  statuses: Object.fromEntries(statuses),
  p50Ms: Number(p50.toFixed(1)),
  p95Ms: Number(p95.toFixed(1)),
  errorRate: Number(errorRate.toFixed(4)),
}, null, 2));

if (p95 > p95LimitMs || errorRate > maxErrorRate) {
  process.exitCode = 1;
  console.error(`Threshold failed (p95 <= ${p95LimitMs}ms, error rate <= ${maxErrorRate}).`);
}
