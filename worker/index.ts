// @ts-expect-error The existing API is intentionally shared from JavaScript modules.
import { createApiV1Handler } from "../server/apiV1.mjs";
// @ts-expect-error The legacy compatibility handler is a JavaScript module.
import { handleContextAnalysisRequest } from "../server/contextAnalysisApi.mjs";
// @ts-expect-error Runtime helpers are intentionally shared from JavaScript modules.
import { createCachedReadinessProbe, setApiHeaders } from "../server/httpJson.mjs";
// @ts-expect-error Runtime repositories are intentionally shared from JavaScript modules.
import { createModuBrainRepository } from "../server/moduBrainRepository.mjs";
// @ts-expect-error Runtime security helpers are intentionally shared from JavaScript modules.
import { createRequestTrace, sanitizeAccountExportPayload, writeProductEventLog, writeStructuredLog } from "../server/security.mjs";
// @ts-expect-error Runtime gateway is intentionally shared from JavaScript modules.
import { createSupabaseGateway } from "../server/supabaseGateway.mjs";
import {
  createNodeHttpAdapters,
  type NodeRequestAdapter,
  type NodeResponseAdapter,
} from "./node-http-adapter";

type AssetsBinding = {
  fetch(request: Request): Promise<Response>;
};

type SitesEnvironment = {
  ASSETS: AssetsBinding;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MODU_BRAIN_ANALYSIS_PROVIDER?: string;
  MODU_BRAIN_OPENAI_ENABLED?: string;
  MODU_BRAIN_OPENAI_MODEL?: string;
  MODU_BRAIN_OPENAI_REASONING_EFFORT?: string;
  OPENAI_API_KEY?: string;
  SAFETY_IDENTIFIER_SECRET?: string;
  IP_HASH_SECRET?: string;
  RATE_LIMIT_IDENTIFIER_SECRET?: string;
  MODU_BRAIN_MAINTENANCE_ENABLED?: string;
};

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type AccountOperationContext = {
  user: { id: string; email?: string | null };
  req: NodeRequestAdapter;
};

type RuntimeResponse = Response & { moduBrainErrorCode?: string | null };

const runtimeByEnvironment = new WeakMap<object, ReturnType<typeof createWorkerRuntime>>();
const WORKER_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
let workerMaintenanceLastStartedAt = 0;
let workerMaintenancePromise: Promise<unknown> | null = null;

const worker = {
  async fetch(request: Request, env: SitesEnvironment, ctx?: ExecutionContextLike) {
    const url = new URL(request.url);
    const runtime = getWorkerRuntime(env);
    scheduleWorkerMaintenance(runtime, ctx);
    const trace = createRequestTrace(
      { headers: Object.fromEntries(request.headers.entries()) },
      { runtime: "cloudflare-worker" },
    );
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await dispatchWorkerRequest(request, env, url, runtime, trace);
    } catch {
      response = createWorkerErrorResponse(request, env, url.pathname.startsWith("/api/"));
    }

    const responseErrorCode = (response as RuntimeResponse).moduBrainErrorCode;
    response = withResponseHeader(response, "X-Request-ID", trace.requestId);
    writeStructuredLog({
      ...trace,
      event: response.status >= 400 ? "http_error" : "http_request",
      method: request.method,
      route: url.pathname,
      status: response.status,
      durationMs: performance.now() - startedAt,
      errorCode:
        responseErrorCode || (response.status >= 500
          ? "INTERNAL_OR_UPSTREAM_ERROR"
          : response.status >= 400
            ? "REQUEST_REJECTED"
            : undefined),
    });
    return response;
  },
};

async function dispatchWorkerRequest(
  request: Request,
  env: SitesEnvironment,
  url: URL,
  runtime: ReturnType<typeof createWorkerRuntime>,
  trace: { requestId: string; cfRay: string | null; rndrId: string | null; runtime: string },
) {
  if (["/api/context-analysis", "/api/context-analysis/import"].includes(url.pathname)) {
    return runNodeHandler(request, async (nodeRequest, nodeResponse) => {
      await handleContextAnalysisRequest(nodeRequest, nodeResponse, {
        production: true,
        trustedProxyPlatform: "cloudflare",
        rateLimitIdentifierSecret:
          env.IP_HASH_SECRET ||
          env.RATE_LIMIT_IDENTIFIER_SECRET ||
          env.SAFETY_IDENTIFIER_SECRET,
        consumePublicRateLimit: runtime.consumePublicRateLimit,
        analysisOptions: { provider: "local-heuristic" },
      });
      return true;
    }, trace);
  }

  if (url.pathname === "/api/health/ready") {
    return runNodeHandler(request, async (nodeRequest, nodeResponse) => {
      await handleWorkerReadiness(nodeRequest, nodeResponse, runtime.readinessProbe);
      return true;
    }, trace);
  }

  if (url.pathname.startsWith("/api/")) {
    return runNodeHandler(request, async (nodeRequest, nodeResponse) => {
      const handled = await runtime.handler(nodeRequest, nodeResponse, url.pathname);
      if (!handled) {
        setApiHeaders(nodeResponse);
        nodeResponse.statusCode = 404;
        nodeResponse.moduBrainErrorCode = "NOT_FOUND";
        nodeResponse.end(
          JSON.stringify({ error: { code: "NOT_FOUND", message: "API route not found." } }),
        );
      }
      return true;
    }, trace);
  }

  return serveAssetOrSpa(request, env);
}

function getWorkerRuntime(env: SitesEnvironment) {
  let runtime = runtimeByEnvironment.get(env);
  if (!runtime) {
    runtime = createWorkerRuntime(env);
    runtimeByEnvironment.set(env, runtime);
  }
  return runtime;
}

function createWorkerRuntime(env: SitesEnvironment) {
  const persistentDatabaseConfigured = Boolean(
    env.SUPABASE_URL &&
      (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY) &&
      (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY),
  );
  const gateway = createSupabaseGateway({
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY,
    secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  });
  let serviceRoleClient: ReturnType<ReturnType<typeof createSupabaseGateway>["asServiceRole"]> | undefined;
  const consumePublicRateLimit = async ({
    scope,
    subjectHash,
    limit,
    windowSeconds,
    signal,
  }: {
    scope: string;
    subjectHash: string;
    limit: number;
    windowSeconds: number;
    signal?: AbortSignal;
  }) => {
    serviceRoleClient ||= gateway.asServiceRole();
    const result = await serviceRoleClient.request("rpc/app_consume_public_rate_limit", {
      method: "POST",
      body: {
        p_scope: scope,
        p_subject_hash: subjectHash,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      },
      signal,
    });
    return result === true || result?.[0]?.app_consume_public_rate_limit === true;
  };
  const readinessProbe = createCachedReadinessProbe(
    async () => {
      const repository = createModuBrainRepository(gateway.asServiceRole());
      await repository.ready();
    },
    { successTtlMs: 15_000, failureTtlMs: 3_000 },
  );
  const runMaintenance = async () => {
    serviceRoleClient ||= gateway.asServiceRole();
    const [rateLimitBucketsDeleted, staleAnalysisRunsDeleted] = await Promise.all([
      serviceRoleClient.request("rpc/app_cleanup_rate_limit_buckets", {
        method: "POST",
        body: { p_retention_seconds: 172_800, p_batch_size: 5_000 },
      }),
      serviceRoleClient.request("rpc/app_cleanup_stale_analysis_runs", {
        method: "POST",
        body: { p_lease_seconds: 300, p_batch_size: 1_000 },
      }),
    ]);
    return {
      rateLimitBucketsDeleted: Number(rateLimitBucketsDeleted) || 0,
      staleAnalysisRunsDeleted: Number(staleAnalysisRunsDeleted) || 0,
    };
  };
  const handler = createApiV1Handler({
    gateway,
    openAIEnabled:
      String(env.MODU_BRAIN_OPENAI_ENABLED || "").toLowerCase() === "true" &&
      Boolean(env.OPENAI_API_KEY) &&
      Boolean(env.MODU_BRAIN_OPENAI_MODEL),
    analysisOptions: {
      apiKey: env.OPENAI_API_KEY,
      model: env.MODU_BRAIN_OPENAI_MODEL || "gpt-5.6-terra",
      reasoningEffort: env.MODU_BRAIN_OPENAI_REASONING_EFFORT || "low",
      safetyIdentifierSecret: env.SAFETY_IDENTIFIER_SECRET || "",
      rateLimitIdentifierSecret:
        env.IP_HASH_SECRET ||
        env.RATE_LIMIT_IDENTIFIER_SECRET ||
        env.SAFETY_IDENTIFIER_SECRET,
    },
    recordProductEvent: (event: unknown, req: NodeRequestAdapter) =>
      writeProductEventLog(event, req.moduBrainTrace, { runtime: "cloudflare-worker" }),
    rateLimitIdentifierOptions: {
      platform: "cloudflare",
      nodeEnv: "production",
      secret:
        env.IP_HASH_SECRET ||
        env.RATE_LIMIT_IDENTIFIER_SECRET ||
        env.SAFETY_IDENTIFIER_SECRET,
    },
    accountDataOperations: persistentDatabaseConfigured
      ? {
          export: async ({ user, req }: AccountOperationContext) => {
            serviceRoleClient ||= gateway.asServiceRole();
            const payload = await serviceRoleClient.request("rpc/app_export_account", {
              method: "POST",
              body: { p_user_id: user.id },
              signal: req.moduBrainSignal,
            });
            return sanitizeAccountExportPayload(payload, user.email);
          },
          delete: async ({ user, req }: AccountOperationContext) =>
            gateway.deleteAuthUser(user.id, { signal: req.moduBrainSignal }),
        }
      : undefined,
  });
  return {
    consumePublicRateLimit,
    readinessProbe,
    handler,
    runMaintenance,
    maintenanceEnabled:
      persistentDatabaseConfigured &&
      String(env.MODU_BRAIN_MAINTENANCE_ENABLED || "true").toLowerCase() !== "false",
  };
}

function scheduleWorkerMaintenance(
  runtime: ReturnType<typeof createWorkerRuntime>,
  ctx?: ExecutionContextLike,
) {
  const now = Date.now();
  if (
    !runtime.maintenanceEnabled ||
    workerMaintenancePromise ||
    now - workerMaintenanceLastStartedAt < WORKER_MAINTENANCE_INTERVAL_MS
  ) {
    return false;
  }

  workerMaintenanceLastStartedAt = now;
  workerMaintenancePromise = runtime
    .runMaintenance()
    .catch(() => {
      writeStructuredLog({
        event: "runtime_maintenance_failed",
        runtime: "cloudflare-worker",
        method: "SYSTEM",
        route: "/maintenance",
        status: 500,
        durationMs: 0,
        errorCode: "MAINTENANCE_FAILED",
      });
    })
    .finally(() => {
      workerMaintenancePromise = null;
    });
  if (ctx?.waitUntil) ctx.waitUntil(workerMaintenancePromise);
  return true;
}

export function resetWorkerMaintenanceForTest() {
  workerMaintenanceLastStartedAt = 0;
  workerMaintenancePromise = null;
}

async function handleWorkerReadiness(
  req: NodeRequestAdapter,
  res: NodeResponseAdapter,
  readinessProbe: () => Promise<{
    status: string;
    checkedAt: string;
    latencyMs: number;
    cached: boolean;
  }>,
) {
  setApiHeaders(res);
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.statusCode = 405;
    res.moduBrainErrorCode = "METHOD_NOT_ALLOWED";
    res.end(
      JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "GET is required." } }),
    );
    return;
  }
  const database = await readinessProbe();
  const ready = database.status === "ready";
  res.statusCode = ready ? 200 : 503;
  if (!ready) res.moduBrainErrorCode = "DATABASE_UNAVAILABLE";
  res.end(
    JSON.stringify({
      data: {
        status: ready ? "ready" : "not_ready",
        dependencies: { database },
      },
    }),
  );
}

function createWorkerErrorResponse(
  request: Request,
  env: SitesEnvironment,
  apiRequest: boolean,
) {
  if (!apiRequest) {
    return secureAssetResponse(
      new Response("Internal server error", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      }),
      request,
      env,
    );
  }
  return new Response(
    JSON.stringify({
      error: { code: "INTERNAL_SERVER_ERROR", message: "The request could not be completed." },
    }),
    {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    },
  );
}

function withResponseHeader(response: Response, name: string, value: string) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveAssetOrSpa(request: Request, env: SitesEnvironment) {
  let response = await env.ASSETS.fetch(request);

  if (
    response.status === 404 &&
    request.method === "GET" &&
    (request.headers.get("accept") || "").includes("text/html")
  ) {
    const indexUrl = new URL("/index.html", request.url);
    response = await env.ASSETS.fetch(
      new Request(indexUrl, { method: "GET", headers: request.headers }),
    );
  }

  return secureAssetResponse(response, request, env);
}

async function runNodeHandler(
  request: Request,
  handler: (
    nodeRequest: NodeRequestAdapter,
    nodeResponse: NodeResponseAdapter,
  ) => Promise<boolean>,
  trace?: { requestId: string; cfRay: string | null; rndrId: string | null; runtime: string },
) {
  const adapters = await createNodeHttpAdapters(request);
  adapters.request.moduBrainTrace = trace;
  try {
    await handler(adapters.request, adapters.response);
    return adapters.response.toResponse();
  } finally {
    adapters.dispose();
  }
}

function secureAssetResponse(
  response: Response,
  request: Request,
  env: SitesEnvironment,
) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  const pathname = new URL(request.url).pathname;
  if (response.status >= 400) {
    headers.set("Cache-Control", "no-store");
  } else if (
    pathname.endsWith(".html") ||
    String(headers.get("content-type") || "").includes("text/html")
  ) {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  } else if (/-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname)) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    headers.set("Cache-Control", "public, max-age=3600");
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  let connectSource = "'self'";
  try {
    if (env.SUPABASE_URL) connectSource += ` ${new URL(env.SUPABASE_URL).origin}`;
  } catch {
    // Invalid optional configuration must not weaken the same-origin default.
  }
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${connectSource}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
