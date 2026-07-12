import { analyzeProjectContext } from "./contextAnalysisCore.mjs";
import { ContextAnalysisApiError } from "./contextAnalysisErrors.mjs";
import { ApiError } from "./apiErrors.mjs";
import { normalizeContextImport } from "./contextImport.mjs";
import { createRequestAbortContext, setApiHeaders } from "./httpJson.mjs";
import { rateLimitIdentifier } from "./security.mjs";

// rawText is limited by characters in the domain validator. Keep enough byte
// headroom for 20,000 Korean characters plus the surrounding JSON payload.
const MAX_REQUEST_BODY_BYTES = 100_000;
const MAX_IMPORT_REQUEST_BODY_BYTES = 256 * 1024;
const PUBLIC_ANALYSIS_LIMIT = 30;
const PUBLIC_IMPORT_LIMIT = 20;
const PUBLIC_WINDOW_SECONDS = 60 * 60;
const PUBLIC_WINDOW_MS = PUBLIC_WINDOW_SECONDS * 1000;
const MAX_MEMORY_BUCKETS = 10_000;
const MAX_CLEANUP_DELETIONS = 128;
const CLEANUP_INTERVAL_MS = 60_000;
const publicRateLimitBuckets = new Map();
let nextMemoryCleanupAt = 0;

export function createContextAnalysisApiMiddleware(options = {}) {
  return async function contextAnalysisApiMiddleware(req, res, next) {
    const pathname = (req.url || "").split("?")[0];

    if (!["/api/context-analysis", "/api/context-analysis/import"].includes(pathname)) {
      next();
      return;
    }

    await handleContextAnalysisRequest(req, res, options);
  };
}

export async function handleContextAnalysisRequest(req, res, options = {}) {
  setApiHeaders(res);
  const pathname = (req.url || "").split("?")[0];
  const isImportRequest = pathname === "/api/context-analysis/import";

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    writeJson(res, 405, {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "POST 메서드만 지원합니다.",
      },
    });
    return;
  }

  const abortContext = createRequestAbortContext(req, res, {
    timeoutMs: options.requestTimeoutMs || process.env.MODU_BRAIN_PUBLIC_REQUEST_TIMEOUT_MS || 45_000,
  });

  try {
    const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
    if (contentType && !contentType.includes("application/json")) {
      throw new ContextAnalysisApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type은 application/json이어야 합니다.",
      );
    }

    if (isImportRequest) {
      assertSameOrigin(req);
    }

    await enforcePublicRateLimit(req, options, {
      isImportRequest,
      signal: abortContext.signal,
    });

    const payload = await readJsonBody(
      req,
      isImportRequest ? MAX_IMPORT_REQUEST_BODY_BYTES : MAX_REQUEST_BODY_BYTES,
    );
    const analyze = options.analyze || analyzeProjectContext;
    const normalizedImport = isImportRequest ? normalizeContextImport(payload) : null;
    const analysisPayload = normalizedImport
      ? { projectTitle: normalizedImport.title, rawText: normalizedImport.content }
      : payload;
    const result = await analyze(analysisPayload, {
      ...(options.analysisOptions || {}),
      signal: abortContext.signal,
    });
    if (abortContext.signal.aborted || res.destroyed) return;
    writeJson(
      res,
      200,
      normalizedImport
        ? {
            import: {
              provider: normalizedImport.provider,
              title: normalizedImport.title,
              content: normalizedImport.content,
              participantCount: normalizedImport.participants.length,
              segmentCount: normalizedImport.segments.length,
            },
            result,
          }
        : result,
    );
  } catch (error) {
    if (abortContext.signal.aborted && (req.aborted || res.destroyed)) return;

    if (abortContext.timedOut) {
      writeJson(res, 504, {
        error: {
          code: "ANALYSIS_DEADLINE_EXCEEDED",
          message: "The analysis request exceeded its total deadline.",
        },
      });
      return;
    }

    if (abortContext.signal.aborted) {
      writeJson(res, 503, {
        error: {
          code: "REQUEST_CANCELLED",
          message: "The server stopped the request before completion.",
        },
      });
      return;
    }

    const apiError = error instanceof ApiError
      ? new ContextAnalysisApiError(
        error.status,
        error.code,
        error.message,
        error.details,
      )
      : error;

    if (apiError instanceof ContextAnalysisApiError) {
      if (["PUBLIC_IMPORT_RATE_LIMITED", "PUBLIC_ANALYSIS_RATE_LIMITED"].includes(apiError.code)) {
        res.setHeader("Retry-After", "3600");
      }
      writeJson(res, apiError.status, {
        error: {
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
        },
      });
      return;
    }

    writeJson(res, 500, {
      error: {
        code: "INTERNAL_ANALYSIS_ERROR",
        message: "맥락 분석 중 서버 오류가 발생했습니다.",
      },
    });
  } finally {
    abortContext.dispose();
  }
}

function writeJson(res, statusCode, payload) {
  setApiHeaders(res);
  res.moduBrainErrorCode = payload?.error?.code || null;
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = MAX_REQUEST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodyBytes = 0;
    let settled = false;

    const contentLength = Number(req.headers?.["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      settled = true;
      req.resume();
      reject(new ContextAnalysisApiError(413, "REQUEST_TOO_LARGE", "요청 본문이 너무 큽니다."));
      return;
    }

    req.on("data", (chunk) => {
      if (settled) return;

      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBytes) {
        settled = true;
        reject(new ContextAnalysisApiError(413, "REQUEST_TOO_LARGE", "요청 본문이 너무 큽니다."));
        return;
      }

      body += chunk;
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new ContextAnalysisApiError(400, "INVALID_JSON", "요청 본문을 JSON으로 파싱할 수 없습니다."));
      }
    });

    req.on("error", () => {
      if (settled) return;
      settled = true;
      reject(new ContextAnalysisApiError(400, "REQUEST_STREAM_ERROR", "요청 본문을 읽을 수 없습니다."));
    });
  });
}

function assertSameOrigin(req) {
  const origin = String(req.headers?.origin || "").trim();
  if (!origin) return;

  const trustForwardedHeaders =
    req.trustedProxyPlatform && req.trustedProxyPlatform !== "direct";
  const forwardedHost = trustForwardedHeaders
    ? String(req.headers?.["x-forwarded-host"] || "").split(",")[0].trim()
    : "";
  const host = forwardedHost || String(req.headers?.host || "").trim();
  const forwardedProtocol = trustForwardedHeaders
    ? String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim()
    : "";
  const protocol = forwardedProtocol || (req.socket?.encrypted ? "https" : "http");

  let expectedOrigin;
  try {
    expectedOrigin = new URL(`${protocol}://${host}`).origin;
  } catch {
    throw new ContextAnalysisApiError(403, "INVALID_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  let requestOrigin;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    throw new ContextAnalysisApiError(403, "INVALID_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  if (requestOrigin !== expectedOrigin) {
    throw new ContextAnalysisApiError(403, "INVALID_ORIGIN", "같은 사이트에서 보낸 요청만 허용합니다.");
  }
}

async function enforcePublicRateLimit(req, options, context) {
  const scope = context.isImportRequest ? "public-import:hour" : "public-analysis:hour";
  const limit = context.isImportRequest ? PUBLIC_IMPORT_LIMIT : PUBLIC_ANALYSIS_LIMIT;
  const now = Date.now();
  const subjectHash = rateLimitIdentifier(req, {
    platform: options.trustedProxyPlatform,
    secret: options.rateLimitIdentifierSecret,
    nodeEnv: options.production === true ? "production" : process.env.NODE_ENV,
    allowDevelopmentFallback: options.allowDevelopmentIdentifierFallback === true,
  });

  let allowed;
  if (typeof options.consumePublicRateLimit === "function") {
    allowed = await options.consumePublicRateLimit({
      scope,
      subjectHash,
      limit,
      windowSeconds: PUBLIC_WINDOW_SECONDS,
      now,
      signal: context.signal,
    });
  } else if (context.isImportRequest && typeof options.consumeImportRateLimit === "function") {
    allowed = await options.consumeImportRateLimit(subjectHash, now);
  } else if (allowMemoryFallback(options)) {
    allowed = consumeMemoryRateLimit(`${scope}:${subjectHash}`, limit, now);
  } else {
    throw new ContextAnalysisApiError(
      503,
      "PUBLIC_RATE_LIMIT_BACKEND_UNAVAILABLE",
      "The public request limiter is not configured.",
    );
  }

  if (!allowed) {
    throw new ContextAnalysisApiError(
      429,
      context.isImportRequest ? "PUBLIC_IMPORT_RATE_LIMITED" : "PUBLIC_ANALYSIS_RATE_LIMITED",
      "The hourly public request limit has been reached. Try again later.",
    );
  }
}

function allowMemoryFallback(options) {
  if (options.allowInMemoryRateLimit === true) return true;
  if (String(process.env.MODU_BRAIN_ALLOW_IN_MEMORY_PUBLIC_LIMITER || "").toLowerCase() === "true") {
    return true;
  }
  if (options.production === true) return false;
  return String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
}

function consumeMemoryRateLimit(key, limit, now) {
  cleanupExpiredMemoryBuckets(now);
  const current = publicRateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && publicRateLimitBuckets.size >= MAX_MEMORY_BUCKETS) {
      const oldestKey = publicRateLimitBuckets.keys().next().value;
      if (oldestKey !== undefined) publicRateLimitBuckets.delete(oldestKey);
    }
    publicRateLimitBuckets.set(key, { count: 1, resetAt: now + PUBLIC_WINDOW_MS });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function cleanupExpiredMemoryBuckets(now, force = false) {
  if (!force && now < nextMemoryCleanupAt) return 0;
  nextMemoryCleanupAt = now + CLEANUP_INTERVAL_MS;
  let deleted = 0;
  for (const [key, bucket] of publicRateLimitBuckets) {
    if (bucket.resetAt <= now) {
      publicRateLimitBuckets.delete(key);
      deleted += 1;
      if (deleted >= MAX_CLEANUP_DELETIONS) break;
    }
  }
  return deleted;
}

export async function runPublicRateLimitMaintenance(options = {}) {
  const memoryBucketsDeleted = cleanupExpiredMemoryBuckets(Date.now(), true);
  let persistentBucketsDeleted = 0;
  if (typeof options.cleanupPublicRateLimits === "function") {
    persistentBucketsDeleted = Number(
      await options.cleanupPublicRateLimits({
        retentionSeconds: 172_800,
        batchSize: 5_000,
        signal: options.signal,
      }),
    ) || 0;
  }
  return { memoryBucketsDeleted, persistentBucketsDeleted };
}

export function resetPublicRateLimitBucketsForTest() {
  publicRateLimitBuckets.clear();
  nextMemoryCleanupAt = 0;
}

export function publicRateLimitBucketCountForTest() {
  return publicRateLimitBuckets.size;
}
