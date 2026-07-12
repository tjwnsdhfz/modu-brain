const defaultTargets = [
  "https://modu-brain-n031.ksjun29.chatgpt.site/api/health/live",
  "https://modu-brain-demo.onrender.com/api/health/live",
];
const targets = (process.env.MONITOR_TARGETS || defaultTargets.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const timeoutMs = Math.max(1000, Number(process.env.MONITOR_TIMEOUT_MS || 30000));
const results = [];

for (const target of targets) {
  const startedAt = performance.now();
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      throw new Error("remote monitor targets must use HTTPS");
    }
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "modu-brain-free-monitor/1" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    const health = payload?.data || payload;
    const healthy = response.ok && health?.status === "ok";
    results.push({
      target: url.origin,
      healthy,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      commit: typeof health?.commit === "string" ? health.commit : null,
    });
  } catch (error) {
    results.push({
      target,
      healthy: false,
      status: null,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : "MonitorError",
    });
  }
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some((result) => !result.healthy)) process.exitCode = 1;
