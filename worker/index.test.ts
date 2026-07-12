import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { resetWorkerMaintenanceForTest } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetWorkerMaintenanceForTest();
});

describe("Sites Worker asset routing", () => {
  it("serves index.html for direct SPA route navigation", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchAsset = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/index.html") {
        return new Response("<!doctype html><title>Modu Brain</title>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response(null, { status: 404 });
    });

    const response = await worker.fetch(
      new Request("https://modu-brain.example/projects/abc", {
        headers: { Accept: "text/html" },
      }),
      {
        ASSETS: { fetch: fetchAsset },
        SUPABASE_URL: "https://demo.supabase.co",
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Modu Brain");
    expect(fetchAsset).toHaveBeenCalledTimes(2);
    expect(response.headers.get("content-security-policy")).toContain(
      "https://demo.supabase.co",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("caches fingerprinted assets immutably", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await worker.fetch(
      new Request("https://modu-brain.example/assets/index-AbCdEf12.js"),
      {
        ASSETS: {
          fetch: vi.fn().mockResolvedValue(
            new Response("globalThis.ready = true", {
              headers: { "Content-Type": "text/javascript" },
            }),
          ),
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("applies uniform API headers and a server-owned request ID", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await worker.fetch(
      new Request("https://modu-brain.example/api/health/live"),
      { ASSETS: { fetch: vi.fn() }, IP_HASH_SECRET: "telemetry-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("records validated product events without logging PII", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await worker.fetch(
      new Request("https://modu-brain.example/api/v1/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Ray": "worker-ray-1",
        },
        body: JSON.stringify({
          name: "analysis_failed",
          occurredAt: new Date().toISOString(),
          path: "/demo",
          properties: { code: "private@example.com", stage: "provider" },
        }),
      }),
      { ASSETS: { fetch: vi.fn() }, IP_HASH_SECRET: "telemetry-secret" },
    );

    expect(response.status).toBe(202);
    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    const event = entries.find((candidate) => candidate.event === "product_event");
    expect(event).toMatchObject({
      runtime: "cloudflare-worker",
      cfRay: "worker-ray-1",
      productEvent: "analysis_failed",
      path: "/demo",
      properties: { stage: "provider" },
    });
    expect(JSON.stringify(event)).not.toContain("private@example.com");
  });

  it("uses the service-role limiter RPC for public analysis", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchDatabase = vi.fn().mockResolvedValue(
      new Response("true", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchDatabase);
    const response = await worker.fetch(
      new Request("https://modu-brain.example/api/context-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.9",
        },
        body: JSON.stringify({
          projectTitle: "Worker limiter",
          rawText:
            "A sufficiently long collaboration record is supplied for local structured analysis. ".repeat(3),
        }),
      }),
      {
        ASSETS: { fetch: vi.fn() },
        SUPABASE_URL: "https://demo.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-test",
        SUPABASE_SECRET_KEY: "secret-test",
        RATE_LIMIT_IDENTIFIER_SECRET: "rate-limit-secret",
        MODU_BRAIN_MAINTENANCE_ENABLED: "false",
      },
    );

    expect(response.status).toBe(200);
    expect(fetchDatabase).toHaveBeenCalledOnce();
    const [url, request] = fetchDatabase.mock.calls[0];
    expect(url).toBe("https://demo.supabase.co/rest/v1/rpc/app_consume_public_rate_limit");
    expect(JSON.parse(request.body)).toMatchObject({
      p_scope: "public-analysis:hour",
      p_subject_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_limit: 30,
      p_window_seconds: 3600,
    });
  });

  it("provides safe account export and auth deletion operations", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchRuntime = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ id: "worker-user", email: "verified@example.com" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/rest/v1/rpc/app_export_account")) {
        return new Response(
          JSON.stringify({ projects: [{ id: "p1" }], token_hash: "must-not-leak" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/auth/v1/admin/users/worker-user")) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchRuntime);
    const env = {
      ASSETS: { fetch: vi.fn() },
      SUPABASE_URL: "https://account.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      SUPABASE_SECRET_KEY: "secret-test",
      MODU_BRAIN_MAINTENANCE_ENABLED: "false",
    };

    const exported = await worker.fetch(
      new Request("https://modu-brain.example/api/v1/account/export", {
        headers: { Authorization: "Bearer opaque-access-token" },
      }),
      env,
    );
    expect(exported.status).toBe(200);
    const exportBody = await exported.json();
    expect(exportBody).toMatchObject({
      data: { projects: [{ id: "p1" }], email: "verified@example.com" },
    });
    expect(JSON.stringify(exportBody)).not.toMatch(/must-not-leak|token_hash/);

    const deleted = await worker.fetch(
      new Request("https://modu-brain.example/api/v1/account", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer opaque-access-token",
          "X-Confirm-Account-Delete": "delete my account",
        },
      }),
      env,
    );
    expect(deleted.status).toBe(200);
    expect(fetchRuntime.mock.calls.map(([url]) => url)).toContain(
      "https://account.supabase.co/auth/v1/admin/users/worker-user",
    );
  });

  it("caches readiness probes and reports dependency state", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchDatabase = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchDatabase);
    const env = {
      ASSETS: { fetch: vi.fn() },
      SUPABASE_URL: "https://demo.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      SUPABASE_SECRET_KEY: "secret-test",
      MODU_BRAIN_MAINTENANCE_ENABLED: "false",
    };

    const first = await worker.fetch(
      new Request("https://modu-brain.example/api/health/ready"),
      env,
    );
    const second = await worker.fetch(
      new Request("https://modu-brain.example/api/health/ready"),
      env,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      data: {
        status: "ready",
        dependencies: { database: { status: "ready", cached: false } },
      },
    });
    await expect(second.json()).resolves.toMatchObject({
      data: { dependencies: { database: { cached: true } } },
    });
    expect(fetchDatabase).toHaveBeenCalledOnce();
  });

  it("runs bounded maintenance through waitUntil only once per interval", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchDatabase = vi.fn().mockResolvedValue(
      new Response("1", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchDatabase);
    const env = {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response("ok", { headers: { "Content-Type": "text/plain" } }),
        ),
      },
      SUPABASE_URL: "https://maintenance.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      SUPABASE_SECRET_KEY: "secret-test",
    };
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => waitUntilPromises.push(promise)),
    };

    await worker.fetch(new Request("https://modu-brain.example/health.txt"), env, ctx);
    await Promise.all(waitUntilPromises);
    await worker.fetch(new Request("https://modu-brain.example/again.txt"), env, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    expect(fetchDatabase).toHaveBeenCalledTimes(2);
    expect(fetchDatabase.mock.calls.map(([url]) => url)).toEqual([
      "https://maintenance.supabase.co/rest/v1/rpc/app_cleanup_rate_limit_buckets",
      "https://maintenance.supabase.co/rest/v1/rpc/app_cleanup_stale_analysis_runs",
    ]);
    expect(JSON.parse(fetchDatabase.mock.calls[0][1].body)).toEqual({
      p_retention_seconds: 172800,
      p_batch_size: 5000,
    });
    expect(JSON.parse(fetchDatabase.mock.calls[1][1].body)).toEqual({
      p_lease_seconds: 300,
      p_batch_size: 1000,
    });
  });
});
