// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createModuBrainServer } from "./server.mjs";

let rootDir;
let distDir;
let server;
let baseUrl;
let logger;

beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "modu-brain-server-"));
  distDir = join(rootDir, "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<!doctype html><title>모두의 뇌</title>", "utf8");
  await writeFile(join(distDir, "assets", "app.js"), "globalThis.__APP_READY__ = true;", "utf8");
  await writeFile(
    join(distDir, "assets", "index-AbCdEf12.js"),
    "globalThis.__HASHED_APP_READY__ = true;",
    "utf8",
  );

  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  server = createModuBrainServer({
    rootDir,
    distDir,
    logger,
    apiV1Options: { rateLimitIdentifierOptions: { secret: "test-ip-secret" } },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(rootDir, { recursive: true, force: true });
});

describe("static preview server", () => {
  it("serves the SPA entry point and known assets with safe content types", async () => {
    const indexResponse = await fetch(`${baseUrl}/`);
    const assetResponse = await fetch(`${baseUrl}/assets/app.js`);

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("content-type")).toContain("text/html");
    expect(await indexResponse.text()).toContain("모두의 뇌");
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
    expect(assetResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(indexResponse.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(indexResponse.headers.get("x-frame-options")).toBe("DENY");
    expect(indexResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(indexResponse.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(indexResponse.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
    );
    expect(await assetResponse.text()).toContain("__APP_READY__");
  });

  it("caches fingerprinted assets immutably", async () => {
    const response = await fetch(`${baseUrl}/assets/index-AbCdEf12.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await response.text()).toContain("__HASHED_APP_READY__");
  });

  it("falls back to index.html for extensionless client routes", async () => {
    const response = await fetch(`${baseUrl}/workspace/project-1`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("모두의 뇌");
  });

  it("sets HSTS only when the original request used HTTPS", async () => {
    const localResponse = await fetch(`${baseUrl}/`);
    const forwardedHttpsResponse = await fetch(`${baseUrl}/`, {
      headers: { "X-Forwarded-Proto": "https" },
    });

    expect(localResponse.headers.get("strict-transport-security")).toBeNull();
    expect(forwardedHttpsResponse.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("keeps the unauthenticated legacy analysis endpoint local even when the env requests OpenAI", async () => {
    vi.stubEnv("MODU_BRAIN_ANALYSIS_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const response = await fetch(`${baseUrl}/api/context-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle: "레거시 안전성",
          rawText:
            "민지는 공개 엔드포인트에서는 유료 모델을 호출하지 말자고 말했다. 팀은 로컬 분석만 사용하기로 결정했다. " +
            "다음 회의에서는 인증된 프로젝트 분석 흐름을 별도로 검증해야 한다. 이 기록은 충분한 입력 길이를 확보하기 위한 안전성 테스트 문장이다.",
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        provider: { name: "local-heuristic", usedExternalModel: false },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses the service-role public limiter RPC in production", async () => {
    const databaseRequest = vi.fn().mockResolvedValue(true);
    const gateway = { asServiceRole: () => ({ request: databaseRequest }) };
    const limitedServer = createModuBrainServer({
      rootDir,
      distDir,
      logger,
      production: true,
      automaticMaintenance: false,
      apiV1Options: { gateway },
      apiOptions: { rateLimitIdentifierSecret: "test-secret" },
    });
    await new Promise((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
    const address = limitedServer.address();

    try {
      const response = await nodeFetch(
        `http://127.0.0.1:${address.port}/api/context-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectTitle: "Persistent limiter",
            rawText:
              "A sufficiently long collaboration record is supplied for the local analysis path. ".repeat(3),
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(databaseRequest).toHaveBeenCalledWith(
        "rpc/app_consume_public_rate_limit",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            p_scope: "public-analysis:hour",
            p_subject_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            p_limit: 30,
            p_window_seconds: 3600,
          }),
          signal: expect.any(AbortSignal),
        }),
      );
      await limitedServer.moduBrainRunMaintenance();
      expect(databaseRequest).toHaveBeenCalledWith(
        "rpc/app_cleanup_rate_limit_buckets",
        expect.objectContaining({
          method: "POST",
          body: { p_retention_seconds: 172800, p_batch_size: 5000 },
        }),
      );
      expect(databaseRequest).toHaveBeenCalledWith(
        "rpc/app_cleanup_stale_analysis_runs",
        expect.objectContaining({
          method: "POST",
          body: { p_lease_seconds: 300, p_batch_size: 1000 },
        }),
      );
    } finally {
      await new Promise((resolve, reject) => {
        limitedServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("runs startup maintenance and coalesces concurrent cleanup attempts", async () => {
    let releaseRateLimitCleanup;
    let releaseStaleRunCleanup;
    const rateLimitGate = new Promise((resolve) => {
      releaseRateLimitCleanup = resolve;
    });
    const staleRunGate = new Promise((resolve) => {
      releaseStaleRunCleanup = resolve;
    });
    const cleanupPublicRateLimits = vi.fn(() => rateLimitGate);
    const cleanupStaleAnalysisRuns = vi.fn(() => staleRunGate);
    const maintenanceServer = createModuBrainServer({
      rootDir,
      distDir,
      logger,
      production: true,
      cleanupPublicRateLimits,
      cleanupStaleAnalysisRuns,
    });
    await new Promise((resolve) => maintenanceServer.listen(0, "127.0.0.1", resolve));

    await vi.waitFor(() => {
      expect(cleanupPublicRateLimits).toHaveBeenCalledOnce();
      expect(cleanupStaleAnalysisRuns).toHaveBeenCalledOnce();
    });
    const first = maintenanceServer.moduBrainRunMaintenance();
    const second = maintenanceServer.moduBrainRunMaintenance();
    expect(second).toBe(first);
    releaseRateLimitCleanup(2);
    releaseStaleRunCleanup(3);
    await expect(first).resolves.toMatchObject({
      persistentBucketsDeleted: 2,
      staleAnalysisRunsDeleted: 3,
    });
    expect(cleanupPublicRateLimits).toHaveBeenCalledOnce();
    expect(cleanupStaleAnalysisRuns).toHaveBeenCalledOnce();
    await maintenanceServer.moduBrainShutdown("TEST_COMPLETE", { timeoutMs: 2_000 });
  });

  it("injects safe account export and auth deletion operations", async () => {
    const databaseRequest = vi.fn().mockResolvedValue({
      projects: [{ id: "project-1" }],
      token_hash: "must-not-leak",
      nested: { refresh_token: "must-not-leak-either" },
    });
    const deleteAuthUser = vi.fn().mockResolvedValue(true);
    const gateway = {
      authenticate: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "verified@example.com",
        accessToken: "private-access-token",
      }),
      asServiceRole: () => ({ request: databaseRequest }),
      deleteAuthUser,
    };
    const accountServer = createModuBrainServer({
      rootDir,
      distDir,
      logger,
      production: true,
      automaticMaintenance: false,
      apiV1Options: { gateway },
    });
    await new Promise((resolve) => accountServer.listen(0, "127.0.0.1", resolve));
    const address = accountServer.address();
    const url = `http://127.0.0.1:${address.port}/api/v1/account`;

    try {
      const exported = await fetch(`${url}/export`, {
        headers: { Authorization: "Bearer private-access-token" },
      });
      expect(exported.status).toBe(200);
      const exportBody = await exported.json();
      expect(exportBody).toMatchObject({
        data: { projects: [{ id: "project-1" }], email: "verified@example.com" },
      });
      expect(JSON.stringify(exportBody)).not.toMatch(/must-not-leak|token_hash|refresh_token/);
      expect(databaseRequest).toHaveBeenCalledWith(
        "rpc/app_export_account",
        expect.objectContaining({
          method: "POST",
          body: { p_user_id: "user-1" },
          signal: expect.any(AbortSignal),
        }),
      );

      const deleted = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: "Bearer private-access-token",
          "X-Confirm-Account-Delete": "delete my account",
        },
      });
      expect(deleted.status).toBe(200);
      expect(deleteAuthUser).toHaveBeenCalledWith("user-1", {
        signal: expect.any(AbortSignal),
      });
    } finally {
      await new Promise((resolve, reject) => {
        accountServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("emits PII-free structured request logs", async () => {
    const response = await fetch(`${baseUrl}/workspace/33333333-3333-4333-8333-333333333333?email=private@example.com`);
    expect(response.status).toBe(200);
    await response.text();

    const entries = logger.info.mock.calls.map(([line]) => JSON.parse(line));
    const entry = entries.find((candidate) => candidate.route === "/workspace/:id");
    expect(entry).toMatchObject({
      event: "http_request",
      service: "modu-brain",
      runtime: "node",
      method: "GET",
      status: 200,
    });
    expect(JSON.stringify(entry)).not.toContain("private@example.com");
  });

  it("records validated first-party product events without PII", async () => {
    const response = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Ray": "safe-ray-1",
        "Rndr-Id": "safe-render-1",
      },
      body: JSON.stringify({
        name: "analysis_failed",
        occurredAt: new Date().toISOString(),
        path: "/demo",
        properties: { code: "private@example.com", stage: "provider" },
      }),
    });
    expect(response.status).toBe(202);

    const entries = logger.info.mock.calls.map(([line]) => JSON.parse(line));
    const event = entries.find((candidate) => candidate.event === "product_event");
    expect(event).toMatchObject({
      service: "modu-brain",
      runtime: "node",
      cfRay: "safe-ray-1",
      rndrId: "safe-render-1",
      productEvent: "analysis_failed",
      path: "/demo",
      properties: { stage: "provider" },
    });
    expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(event)).not.toContain("private@example.com");
  });

  it("caches readiness probes and reports the database dependency state", async () => {
    const readyCheck = vi.fn().mockResolvedValue(true);
    const readinessServer = createModuBrainServer({
      rootDir,
      distDir,
      logger,
      apiV1Options: { readyCheck },
    });
    await new Promise((resolve) => readinessServer.listen(0, "127.0.0.1", resolve));
    const address = readinessServer.address();
    const url = `http://127.0.0.1:${address.port}/api/health/ready`;

    try {
      const first = await fetch(url);
      const second = await fetch(url);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.headers.get("strict-transport-security")).toContain("max-age=31536000");
      expect(await first.json()).toMatchObject({
        data: {
          status: "ready",
          dependencies: { database: { status: "ready", cached: false } },
        },
      });
      expect(await second.json()).toMatchObject({
        data: { dependencies: { database: { status: "ready", cached: true } } },
      });
      expect(readyCheck).toHaveBeenCalledOnce();
    } finally {
      await new Promise((resolve, reject) => {
        readinessServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("drains the listener and aborts active request work", async () => {
    let resolveStarted;
    const started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    let providerSignal;
    const drainingServer = createModuBrainServer({
      rootDir,
      distDir,
      logger,
      apiOptions: {
        allowInMemoryRateLimit: true,
        analyze: async (_payload, { signal }) => {
          providerSignal = signal;
          resolveStarted();
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
    });
    await new Promise((resolve) => drainingServer.listen(0, "127.0.0.1", resolve));
    const address = drainingServer.address();
    const pending = fetch(`http://127.0.0.1:${address.port}/api/context-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectTitle: "Graceful drain",
        rawText: "This is a sufficiently long analysis record for graceful shutdown testing. ".repeat(4),
      }),
    });

    await started;
    const shutdown = drainingServer.moduBrainShutdown("SIGTERM", { timeoutMs: 2_000 });
    const response = await pending;
    await shutdown;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_CANCELLED" },
    });
    expect(providerSignal.aborted).toBe(true);
    expect(drainingServer.listening).toBe(false);
  });

  it("returns 404 for missing assets instead of serving HTML", async () => {
    const response = await fetch(`${baseUrl}/assets/missing.js`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("returns uniform JSON security headers for unknown API routes", async () => {
    const response = await fetch(`${baseUrl}/api/not-a-real-route`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("survives a malformed encoded path and continues serving assets", async () => {
    const malformedResponse = await fetch(`${baseUrl}/%E0%A4%A`);
    expect(malformedResponse.status).toBe(400);

    const assetResponse = await fetch(`${baseUrl}/assets/app.js`);
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toContain("__APP_READY__");
  });

  it.each(["/..%5C..%5Csecret.txt", "/C:%5CWindows%5Cwin.ini"])(
    "blocks encoded Windows path traversal: %s",
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`);

      expect(response.status).toBe(403);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );
});

function nodeFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: init.method || "GET", headers: init.headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: response.headers,
            }),
          );
        });
      },
    );
    request.once("error", reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}
