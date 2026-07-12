import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiV1Handler } from "./apiV1.mjs";
import {
  handleContextAnalysisRequest,
  runPublicRateLimitMaintenance,
} from "./contextAnalysisApi.mjs";
import { createCachedReadinessProbe, setApiHeaders } from "./httpJson.mjs";
import { createModuBrainRepository } from "./moduBrainRepository.mjs";
import {
  createRequestTrace,
  sanitizeAccountExportPayload,
  writeProductEventLog,
  writeStructuredLog,
} from "./security.mjs";
import { createSupabaseGateway } from "./supabaseGateway.mjs";

const moduleUrl = new URL(import.meta.url);
const modulePath = moduleUrl.protocol === "file:" ? fileURLToPath(moduleUrl) : "";
const defaultRootDir = modulePath ? resolve(dirname(modulePath), "..") : process.cwd();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
};

export function createModuBrainServer(options = {}) {
  const rootDir = options.rootDir || defaultRootDir;
  const buildRoot = join(rootDir, "dist");
  const distDir =
    options.distDir ||
    (existsSync(join(buildRoot, "client", "index.html"))
      ? join(buildRoot, "client")
      : buildRoot);
  const production =
    options.production ??
    (String(process.env.NODE_ENV || "").toLowerCase() === "production" ||
      String(process.env.RENDER || "").toLowerCase() === "true");
  const trustedProxyPlatform =
    options.trustedProxyPlatform || (String(process.env.RENDER || "").toLowerCase() === "true"
      ? "render"
      : "direct");
  const gateway =
    options.apiV1Options?.gateway || createSupabaseGateway(options.apiV1Options?.supabase || {});
  const persistentDatabaseConfigured = hasPersistentDatabaseConfiguration(options);
  let serviceRoleClient;
  const consumePublicRateLimit =
    options.apiOptions?.consumePublicRateLimit ||
    (persistentDatabaseConfigured
      ? async ({ scope, subjectHash, limit, windowSeconds, signal }) => {
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
        }
      : undefined);
  const cleanupPublicRateLimits =
    options.cleanupPublicRateLimits ||
    (persistentDatabaseConfigured
      ? async ({ retentionSeconds, batchSize, signal }) => {
          serviceRoleClient ||= gateway.asServiceRole();
          return serviceRoleClient.request("rpc/app_cleanup_rate_limit_buckets", {
            method: "POST",
            body: {
              p_retention_seconds: retentionSeconds,
              p_batch_size: batchSize,
            },
            signal,
          });
        }
      : undefined);
  const cleanupStaleAnalysisRuns =
    options.cleanupStaleAnalysisRuns ||
    (persistentDatabaseConfigured
      ? async ({ leaseSeconds, batchSize, signal }) => {
          serviceRoleClient ||= gateway.asServiceRole();
          return serviceRoleClient.request("rpc/app_cleanup_stale_analysis_runs", {
            method: "POST",
            body: {
              p_lease_seconds: leaseSeconds,
              p_batch_size: batchSize,
            },
            signal,
          });
        }
      : undefined);
  const readinessCheck =
    options.apiV1Options?.readyCheck ||
    (async () => {
      const repository = createModuBrainRepository(gateway.asServiceRole());
      await repository.ready();
    });
  const readinessProbe = createCachedReadinessProbe(readinessCheck, {
    successTtlMs:
      options.readinessSuccessTtlMs || process.env.MODU_BRAIN_READINESS_SUCCESS_TTL_MS || 15_000,
    failureTtlMs:
      options.readinessFailureTtlMs || process.env.MODU_BRAIN_READINESS_FAILURE_TTL_MS || 3_000,
  });
  const defaultAccountDataOperations = persistentDatabaseConfigured
    ? {
        export: async ({ user, req }) => {
          serviceRoleClient ||= gateway.asServiceRole();
          const payload = await serviceRoleClient.request("rpc/app_export_account", {
            method: "POST",
            body: { p_user_id: user.id },
            signal: req.moduBrainSignal,
          });
          return sanitizeAccountExportPayload(payload, user.email);
        },
        delete: async ({ user, req }) =>
          gateway.deleteAuthUser(user.id, { signal: req.moduBrainSignal }),
      }
    : undefined;
  const accountDataOperations = Object.hasOwn(
    options.apiV1Options || {},
    "accountDataOperations",
  )
    ? options.apiV1Options.accountDataOperations
    : defaultAccountDataOperations;
  const recordProductEvent = Object.hasOwn(
    options.apiV1Options || {},
    "recordProductEvent",
  )
    ? options.apiV1Options.recordProductEvent
    : (event, req) => writeProductEventLog(event, req.moduBrainTrace, { logger: options.logger });
  const handleApiV1 = createApiV1Handler({
    ...(options.apiV1Options || {}),
    accountDataOperations,
    recordProductEvent,
    rateLimitIdentifierOptions: {
      ...(options.apiV1Options?.rateLimitIdentifierOptions || {}),
      platform:
        options.apiV1Options?.rateLimitIdentifierOptions?.platform || trustedProxyPlatform,
      nodeEnv: options.apiV1Options?.rateLimitIdentifierOptions?.nodeEnv || "production",
      secret:
        options.apiV1Options?.rateLimitIdentifierOptions?.secret ||
        process.env.IP_HASH_SECRET ||
        process.env.RATE_LIMIT_IDENTIFIER_SECRET ||
        process.env.SAFETY_IDENTIFIER_SECRET,
    },
    analysisOptions: {
      ...(options.apiV1Options?.analysisOptions || {}),
      rateLimitIdentifierSecret:
        options.apiV1Options?.analysisOptions?.rateLimitIdentifierSecret ||
        process.env.IP_HASH_SECRET ||
        process.env.RATE_LIMIT_IDENTIFIER_SECRET ||
        process.env.SAFETY_IDENTIFIER_SECRET,
    },
  });
  const activeRequests = new Map();
  const requestDeadlineMs = boundedNumber(
    options.requestDeadlineMs || process.env.MODU_BRAIN_REQUEST_DEADLINE_MS,
    1_000,
    300_000,
    45_000,
  );
  let draining = false;
  let shutdownPromise;
  let maintenancePromise;
  let maintenanceTimer;

  const server = createServer(async (req, res) => {
    const trace = createRequestTrace(req, { runtime: "node" });
    const requestStartedAt = process.hrtime.bigint();
    const requestController = new AbortController();
    req.moduBrainSignal = requestController.signal;
    req.moduBrainTrace = trace;
    req.trustedProxyPlatform = trustedProxyPlatform;
    res.setHeader("X-Request-ID", trace.requestId);
    if (draining) res.setHeader("Connection", "close");

    const requestDeadline = setTimeout(
      () => requestController.abort(new DOMException("Request deadline exceeded", "TimeoutError")),
      requestDeadlineMs,
    );
    requestDeadline.unref?.();
    activeRequests.set(requestController, { res });
    let requestLogged = false;
    const finishRequest = () => {
      if (requestLogged) return;
      requestLogged = true;
      clearTimeout(requestDeadline);
      activeRequests.delete(requestController);
      const status = res.writableEnded ? res.statusCode : 499;
      writeStructuredLog(
        {
          ...trace,
          event: status >= 400 ? "http_error" : "http_request",
          method: req.method,
          route: req.url,
          status,
          durationMs: Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000,
          errorCode:
            res.moduBrainErrorCode || (status === 499 ? "CLIENT_DISCONNECTED" : undefined),
        },
        { logger: options.logger },
      );
    };
    res.once("finish", finishRequest);
    res.once("close", finishRequest);

    if (isSecureRequest(req)) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    let pathname;

    try {
      pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
    } catch {
      res.moduBrainErrorCode = "INVALID_REQUEST_URL";
      writeText(res, 400, "잘못된 요청 URL입니다.");
      return;
    }

    try {
      if (["/api/context-analysis", "/api/context-analysis/import"].includes(pathname)) {
        await handleContextAnalysisRequest(req, res, {
          ...(options.apiOptions || {}),
          production: options.apiOptions?.production ?? production,
          trustedProxyPlatform,
          rateLimitIdentifierSecret:
            options.apiOptions?.rateLimitIdentifierSecret ||
            process.env.IP_HASH_SECRET ||
            process.env.RATE_LIMIT_IDENTIFIER_SECRET ||
            process.env.SAFETY_IDENTIFIER_SECRET,
          consumePublicRateLimit,
          analysisOptions: {
            ...(options.apiOptions?.analysisOptions || {}),
            provider: "local-heuristic",
          },
        });
        return;
      }

      if (pathname === "/api/health/ready") {
        await handleReadinessRequest(req, res, readinessProbe);
        return;
      }

      if (await handleApiV1(req, res, pathname)) return;

      if (pathname.startsWith("/api/")) {
        writeApiFailure(res, 404, "NOT_FOUND", "API route not found.");
        return;
      }

      await serveStatic(pathname, res, {
        distDir,
        supabaseUrl:
          options.supabaseUrl || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      });
    } catch {
      res.moduBrainErrorCode = "INTERNAL_SERVER_ERROR";
      if (!res.headersSent) {
        if (pathname.startsWith("/api/")) {
          writeApiFailure(
            res,
            500,
            "INTERNAL_SERVER_ERROR",
            "The request could not be completed.",
          );
        } else {
          writeText(res, 500, "서버에서 요청을 처리하지 못했습니다.");
        }
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  server.headersTimeout = boundedNumber(options.headersTimeoutMs, 5_000, 120_000, 15_000);
  server.requestTimeout = boundedNumber(options.requestTimeoutMs, 5_000, 300_000, 60_000);
  server.keepAliveTimeout = boundedNumber(options.keepAliveTimeoutMs, 1_000, 30_000, 5_000);
  server.moduBrainAbortActiveRequests = (reason = "SERVER_DRAINING") => {
    for (const [controller, active] of activeRequests) {
      if (!active.res.headersSent) active.res.setHeader("Connection", "close");
      controller.abort(new DOMException(String(reason), "AbortError"));
    }
    return activeRequests.size;
  };
  server.moduBrainRunMaintenance = (maintenanceOptions = {}) => {
    if (maintenancePromise) return maintenancePromise;
    const rateLimitCleanup =
      maintenanceOptions.cleanupPublicRateLimits || cleanupPublicRateLimits;
    const staleRunCleanup =
      maintenanceOptions.cleanupStaleAnalysisRuns || cleanupStaleAnalysisRuns;
    maintenancePromise = (async () => {
      const [rateLimits, staleAnalysisRunsDeleted] = await Promise.all([
        runPublicRateLimitMaintenance({
          ...maintenanceOptions,
          cleanupPublicRateLimits: rateLimitCleanup,
        }),
        typeof staleRunCleanup === "function"
          ? staleRunCleanup({
              leaseSeconds: 300,
              batchSize: 1_000,
              signal: maintenanceOptions.signal,
            })
          : 0,
      ]);
      return {
        ...rateLimits,
        staleAnalysisRunsDeleted: Number(staleAnalysisRunsDeleted) || 0,
      };
    })().finally(() => {
      maintenancePromise = null;
    });
    return maintenancePromise;
  };
  server.moduBrainStartMaintenance = () => {
    if (maintenanceTimer) return false;
    const intervalMs = boundedNumber(
      options.maintenanceIntervalMs,
      1_000,
      24 * 60 * 60 * 1_000,
      6 * 60 * 60 * 1_000,
    );
    const runAutomaticMaintenance = () => {
      void server.moduBrainRunMaintenance().catch(() => {
        writeStructuredLog(
          {
            event: "runtime_maintenance_failed",
            runtime: "node",
            method: "SYSTEM",
            route: "/maintenance",
            status: 500,
            durationMs: 0,
            errorCode: "MAINTENANCE_FAILED",
          },
          { logger: options.logger },
        );
      });
    };
    runAutomaticMaintenance();
    maintenanceTimer = setInterval(runAutomaticMaintenance, intervalMs);
    maintenanceTimer.unref?.();
    return true;
  };
  server.moduBrainShutdown = (signalName = "SIGTERM", shutdownOptions = {}) => {
    if (shutdownPromise) return shutdownPromise;
    draining = true;
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
    const timeoutMs = boundedNumber(shutdownOptions.timeoutMs, 1_000, 60_000, 30_000);
    shutdownPromise = new Promise((resolveShutdown) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceClose);
        resolveShutdown();
      };
      const forceClose = setTimeout(() => {
        server.closeAllConnections?.();
        finish();
      }, timeoutMs);
      forceClose.unref?.();
      server.close(finish);
      server.closeIdleConnections?.();
      server.moduBrainAbortActiveRequests(signalName);
      if (!server.listening) finish();
    });
    return shutdownPromise;
  };

  if (
    production &&
    options.automaticMaintenance !== false &&
    (cleanupPublicRateLimits || cleanupStaleAnalysisRuns)
  ) {
    server.once("listening", () => server.moduBrainStartMaintenance());
  }

  return server;
}

async function handleReadinessRequest(req, res, readinessProbe) {
  setApiHeaders(res);
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.moduBrainErrorCode = "METHOD_NOT_ALLOWED";
    res.statusCode = 405;
    res.end(
      JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "GET is required." } }),
    );
    return;
  }

  const database = await readinessProbe();
  const ready = database.status === "ready";
  if (!ready) res.moduBrainErrorCode = "DATABASE_UNAVAILABLE";
  res.statusCode = ready ? 200 : 503;
  res.end(
    JSON.stringify({
      data: {
        status: ready ? "ready" : "not_ready",
        dependencies: { database },
      },
    }),
  );
}

function writeApiFailure(res, status, code, message) {
  setApiHeaders(res);
  res.moduBrainErrorCode = code;
  res.statusCode = status;
  res.end(JSON.stringify({ error: { code, message } }));
}

function hasPersistentDatabaseConfiguration(options) {
  if (options.apiV1Options?.gateway) return true;
  const supabase = options.apiV1Options?.supabase || {};
  const url = supabase.url || process.env.SUPABASE_URL;
  const publishableKey =
    supabase.publishableKey ||
    supabase.anonKey ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  const secretKey =
    supabase.secretKey ||
    supabase.serviceRoleKey ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && publishableKey && secretKey);
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export async function serveStatic(pathname, res, options = {}) {
  const distDir = options.distDir || join(defaultRootDir, "dist");

  if (!existsSync(distDir)) {
    writeText(res, 503, "dist directory not found. Run npm run build first.");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    writeText(res, 400, "잘못 인코딩된 요청 경로입니다.");
    return;
  }

  const portablePath = decodedPath.replace(/\\/g, "/");
  const relativePath = portablePath.replace(/^\/+/, "") || "index.html";

  if (
    portablePath.startsWith("//") ||
    /^[A-Za-z]:(?:\/|$)/.test(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    writeText(res, 403, "Forbidden");
    return;
  }

  let filePath = resolve(distDir, relativePath);
  const resolvedDistDir = resolve(distDir);

  if (filePath !== resolvedDistDir && !filePath.startsWith(`${resolvedDistDir}${sep}`)) {
    writeText(res, 403, "Forbidden");
    return;
  }

  let fileStat = await tryStat(filePath);

  if (fileStat?.isDirectory()) {
    filePath = join(filePath, "index.html");
    fileStat = await tryStat(filePath);
    if (!fileStat?.isFile()) {
      writeText(res, 404, "Not found");
      return;
    }
  } else if (!fileStat?.isFile()) {
    if (extname(relativePath)) {
      writeText(res, 404, "Not found");
      return;
    }

    filePath = join(resolvedDistDir, "index.html");
    fileStat = await tryStat(filePath);
    if (!fileStat?.isFile()) {
      writeText(res, 503, "dist index not found. Run npm run build first.");
      return;
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream");
  setStaticCacheHeaders(res, filePath);
  setSecurityHeaders(res, options);
  await pipeFile(filePath, res);
}

function setStaticCacheHeaders(res, filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    return;
  }
  if (/-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(filePath)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
}

function tryStat(filePath) {
  return stat(filePath).catch(() => null);
}

function pipeFile(filePath, res) {
  return new Promise((resolvePromise) => {
    const stream = createReadStream(filePath);

    stream.on("error", () => {
      if (!res.headersSent) {
        writeText(res, 500, "정적 파일을 읽을 수 없습니다.");
      } else if (!res.writableEnded) {
        res.end();
      }
      resolvePromise();
    });
    stream.on("end", resolvePromise);
    stream.pipe(res);
  });
}

function writeText(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  setSecurityHeaders(res);
  res.end(message);
}

function setSecurityHeaders(res, options = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  let connectSource = "'self'";
  try {
    if (options.supabaseUrl) connectSource += ` ${new URL(options.supabaseUrl).origin}`;
  } catch {
    // Invalid optional configuration must not weaken the default same-origin CSP.
  }
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${connectSource}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  );
}

function isSecureRequest(req) {
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(req.socket?.encrypted) || forwardedProtocol === "https";
}

if (modulePath && process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  const server = createModuBrainServer();
  server.listen(port, host, () => {
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "server_listening",
        service: "modu-brain",
        runtime: "node",
        port,
      }),
    );
  });
  let shutdownStarted = false;
  const shutdown = async (signalName) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        event: "server_draining",
        service: "modu-brain",
        runtime: "node",
        signal: signalName,
      }),
    );
    await server.moduBrainShutdown(signalName);
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
