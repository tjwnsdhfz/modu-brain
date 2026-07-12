import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const fallbackTargets = [
  "https://modu-brain-n031.ksjun29.chatgpt.site/api/health/live",
  "https://modu-brain-demo.onrender.com/api/health/live",
];

const configuredTargets = process.env.MONITOR_TARGETS?.trim();
const parsedTargets = (configuredTargets || fallbackTargets.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const targets = parsedTargets.length > 0 ? parsedTargets : fallbackTargets;

const configuredTimeoutMs = Number(process.env.MONITOR_TIMEOUT_MS || 90000);
const timeoutMs = Number.isFinite(configuredTimeoutMs)
  ? Math.min(120000, Math.max(1000, configuredTimeoutMs))
  : 90000;
const configuredAttempts = Number(process.env.MONITOR_ATTEMPTS || 3);
const maxAttempts = Number.isInteger(configuredAttempts)
  ? Math.min(5, Math.max(1, configuredAttempts))
  : 3;
const configuredRetryDelayMs = Number(process.env.MONITOR_RETRY_DELAY_MS || 5000);
const retryDelayMs = Number.isFinite(configuredRetryDelayMs)
  ? Math.min(30000, Math.max(0, configuredRetryDelayMs))
  : 5000;

function safeEndpoint(url) {
  return `${url.origin}${url.pathname}`;
}

async function checkTarget(target) {
  const startedAt = performance.now();
  let endpoint = "invalid target";

  try {
    const url = new URL(target);
    endpoint = safeEndpoint(url);

    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
    if (url.protocol !== "https:" && !localHostnames.has(url.hostname)) {
      throw new Error("remote monitor targets must use HTTPS");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error("monitor targets must not include credentials, query strings, or fragments");
    }

    let lastResult = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const elapsedMs = performance.now() - startedAt;
      const remainingMs = Math.max(1, timeoutMs - elapsedMs);

      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "modu-brain-free-monitor/2",
          },
          redirect: "error",
          signal: AbortSignal.timeout(remainingMs),
        });
        const payload = await response.json().catch(() => null);
        const health = payload?.data || payload;
        const healthy = response.ok && health?.status === "ok";
        lastResult = {
          target: endpoint,
          healthy,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
          attempts: attempt,
          commit: typeof health?.commit === "string" ? health.commit : null,
        };
        if (healthy) return lastResult;
      } catch (error) {
        lastResult = {
          target: endpoint,
          healthy: false,
          status: null,
          durationMs: Math.round(performance.now() - startedAt),
          attempts: attempt,
          error: error instanceof Error ? error.name : "MonitorError",
        };
      }

      const timeAfterAttemptMs = performance.now() - startedAt;
      if (attempt < maxAttempts && timeAfterAttemptMs + retryDelayMs < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        break;
      }
    }

    return lastResult;
  } catch (error) {
    return {
      target: endpoint,
      healthy: false,
      status: null,
      durationMs: Math.round(performance.now() - startedAt),
      attempts: 0,
      error: error instanceof Error ? error.name : "MonitorError",
    };
  }
}

const results = await Promise.all(targets.map(checkTarget));
const healthyCount = results.filter((result) => result.healthy).length;
const report = {
  checkedAt: new Date().toISOString(),
  targetCount: results.length,
  healthyCount,
  results,
};
const serializedReport = `${JSON.stringify(report, null, 2)}\n`;

const outputPath = process.env.MONITOR_OUTPUT_PATH?.trim();
if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, serializedReport, "utf8");
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
if (summaryPath) {
  const rows = results.map((result) => {
    const state = result.healthy ? "healthy" : "unhealthy";
    const status = result.status ?? result.error ?? "request failed";
    const commit = result.commit ? `\`${result.commit.replaceAll("`", "")}\`` : "-";
    return `| ${state} | \`${result.target.replaceAll("`", "")}\` | ${status} | ${result.durationMs} ms | ${result.attempts} | ${commit} |`;
  });
  const summary = [
    "## Modu Brain uptime",
    "",
    `Checked ${results.length} endpoint(s): ${healthyCount} healthy, ${results.length - healthyCount} unhealthy.`,
    "",
    "| State | Endpoint | HTTP/error | Duration | Attempts | Commit |",
    "| --- | --- | --- | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
  await appendFile(summaryPath, summary, "utf8");
}

console.log(serializedReport.trimEnd());
if (healthyCount !== results.length) {
  console.error(`${results.length - healthyCount} of ${results.length} live-health endpoint(s) failed.`);
  process.exitCode = 1;
}
