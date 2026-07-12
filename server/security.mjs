import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { ApiError } from "./apiErrors.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TRACE_VALUE = /^[A-Za-z0-9._:-]{1,128}$/;
const DEVELOPMENT_IDENTIFIER_SECRET = "modu-brain-development-only";
const SAFE_ROUTE_SEGMENTS = new Set([
  "api",
  "v1",
  "health",
  "live",
  "ready",
  "context-analysis",
  "import",
  "projects",
  "sources",
  "source-segments",
  "analysis-runs",
  "share-links",
  "shared",
  "resolve",
  "capabilities",
  "telemetry",
  "annotations",
  "steps",
  "events",
  "graph",
  "backlinks",
  "login",
  "share",
  "demo",
  "workspace",
]);
const PRODUCT_EVENT_PROPERTIES = {
  demo_opened: new Set(["sampleReady"]),
  sample_loaded: new Set(["entryPoint"]),
  analysis_started: new Set(["mode", "inputCharacters", "sourceCount"]),
  analysis_succeeded: new Set(["provider", "durationMs", "evidenceCount"]),
  analysis_failed: new Set(["code", "stage"]),
  evidence_opened: new Set(["referenceCount", "sourceCount"]),
  comparison_opened: new Set(["hasPrevious", "addedCount", "changedCount", "resolvedCount"]),
  share_link_created: new Set(["expiresInDays"]),
};
const PRODUCT_EVENT_PATHS = new Set([
  "/",
  "/demo",
  "/login",
  "/projects",
  "/projects/:projectId",
  "/share",
]);

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function createShareToken() {
  return randomBytes(32).toString("base64url");
}

export function privacyIdentifier(userId, secret = undefined, options = {}) {
  return hmacIdentifier(userId, {
    ...options,
    secret: secret || process.env.SAFETY_IDENTIFIER_SECRET,
    missingSecretCode: "SAFETY_IDENTIFIER_SECRET_MISSING",
  });
}

export function rateLimitIdentifier(req, options = {}) {
  return hmacIdentifier(clientIp(req, options), {
    ...options,
    secret:
      options.secret ||
      process.env.IP_HASH_SECRET ||
      process.env.RATE_LIMIT_IDENTIFIER_SECRET ||
      process.env.SAFETY_IDENTIFIER_SECRET,
    missingSecretCode: "RATE_LIMIT_IDENTIFIER_SECRET_MISSING",
  });
}

export function sanitizeAccountExportPayload(payload, email) {
  const sanitized = sanitizeExportValue(payload);
  const resource = sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized
    : {};
  return { ...resource, email: typeof email === "string" ? email : null };
}

export function requireUuid(value, fieldName = "id") {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new ApiError(400, "INVALID_IDENTIFIER", `${fieldName} 형식이 올바르지 않습니다.`);
  }
  return String(value);
}

export function clientIp(req, options = {}) {
  const platform = resolveProxyPlatform(req, options);
  const headers = req?.headers || {};

  if (platform === "cloudflare") {
    return firstValidIp(headers["cf-connecting-ip"]) || directAddress(req);
  }

  if (platform === "render") {
    return firstValidIp(headers["x-forwarded-for"]) || directAddress(req);
  }

  if (platform === "trusted-proxy") {
    return lastValidIp(headers["x-forwarded-for"]) || directAddress(req);
  }

  return directAddress(req);
}

export function resolveProxyPlatform(req, options = {}) {
  const explicit = String(
    options.platform || req?.trustedProxyPlatform || process.env.MODU_BRAIN_TRUST_PROXY || "",
  )
    .trim()
    .toLowerCase();

  if (["cloudflare", "render", "trusted-proxy", "direct"].includes(explicit)) {
    return explicit;
  }
  if (String(process.env.RENDER || "").toLowerCase() === "true") return "render";
  return "direct";
}

export function createRequestTrace(req, options = {}) {
  const requestId = randomUUID();
  const headers = req?.headers || {};
  return {
    requestId,
    cfRay: safeTraceValue(headers["cf-ray"]),
    rndrId: safeTraceValue(headers["rndr-id"] || headers["x-render-request-id"]),
    runtime: options.runtime || "node",
  };
}

export function routeTemplate(pathname) {
  const cleanPath = String(pathname || "/").split("?")[0];
  if (cleanPath === "/") return "/";
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments[0] === "assets") return "/assets/:asset";
  return `/${segments
    .map((segment) => {
      if (SAFE_ROUTE_SEGMENTS.has(segment)) return segment;
      if (UUID_PATTERN.test(segment) || /^\d+$/.test(segment)) return ":id";
      return ":segment";
    })
    .join("/")}`;
}

export function writeStructuredLog(entry, options = {}) {
  const logger = options.logger || console;
  const status = Number(entry.status || 0);
  const level = entry.level || (status >= 500 ? "error" : status >= 400 ? "warn" : "info");
  const payload = {
    timestamp: entry.timestamp || new Date().toISOString(),
    level,
    event: entry.event || "http_request",
    service: "modu-brain",
    runtime: entry.runtime || "node",
    requestId: safeTraceValue(entry.requestId),
    cfRay: safeTraceValue(entry.cfRay),
    rndrId: safeTraceValue(entry.rndrId),
    method: safeMethod(entry.method),
    route: routeTemplate(entry.route),
    status: Number.isInteger(status) ? status : 0,
    durationMs: finiteNonNegative(entry.durationMs),
    ...(safeErrorCode(entry.errorCode) ? { errorCode: safeErrorCode(entry.errorCode) } : {}),
  };
  const sink =
    (typeof logger[level] === "function" && logger[level]) ||
    (typeof logger.log === "function" && logger.log) ||
    console[level] ||
    console.log;
  sink.call(logger, JSON.stringify(payload));
  return payload;
}

export function writeProductEventLog(event, trace = {}, options = {}) {
  const allowedProperties = PRODUCT_EVENT_PROPERTIES[event?.name];
  const productEvent = allowedProperties ? event.name : "unknown";
  const path = PRODUCT_EVENT_PATHS.has(event?.path) ? event.path : "unknown";
  const properties = {};
  if (allowedProperties && event?.properties && typeof event.properties === "object") {
    for (const [key, value] of Object.entries(event.properties)) {
      if (!allowedProperties.has(key)) continue;
      const sanitized = sanitizeProductProperty(key, value);
      if (sanitized !== undefined) properties[key] = sanitized;
    }
  }
  const payload = {
    timestamp: new Date().toISOString(),
    level: "info",
    event: "product_event",
    service: "modu-brain",
    runtime: trace.runtime || options.runtime || "node",
    requestId: safeTraceValue(trace.requestId),
    cfRay: safeTraceValue(trace.cfRay),
    rndrId: safeTraceValue(trace.rndrId),
    productEvent,
    path,
    properties,
  };
  const logger = options.logger || console;
  const sink =
    (typeof logger.info === "function" && logger.info) ||
    (typeof logger.log === "function" && logger.log) ||
    console.info;
  sink.call(logger, JSON.stringify(payload));
  return payload;
}

function hmacIdentifier(value, options) {
  const secret = resolveIdentifierSecret(options);
  return createHmac("sha256", secret).update(String(value || "unknown"), "utf8").digest("hex");
}

function sanitizeExportValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (!value || typeof value !== "object") return value;
  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (
      normalizedKey.includes("token") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("password") ||
      normalizedKey.endsWith("apikey") ||
      normalizedKey === "servicerolekey"
    ) {
      continue;
    }
    sanitized[key] = sanitizeExportValue(nestedValue);
  }
  return sanitized;
}

function sanitizeProductProperty(key, value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  if (key === "entryPoint") return ["hero", "input"].includes(value) ? value : undefined;
  if (key === "mode") {
    return ["public-local", "public-import", "local", "openai"].includes(value)
      ? value
      : undefined;
  }
  if (key === "provider") {
    if (value === "local-heuristic") return value;
    if (value.startsWith("openai:")) return "openai";
    return undefined;
  }
  if (key === "code") return /^[A-Z0-9_]{3,80}$/.test(value) ? value : undefined;
  if (key === "stage") return /^[a-z0-9_-]{1,40}$/.test(value) ? value : undefined;
  return undefined;
}

function resolveIdentifierSecret(options = {}) {
  if (options.secret) return String(options.secret);
  const environment = String(options.nodeEnv || process.env.NODE_ENV || "development").toLowerCase();
  if (environment !== "production" || options.allowDevelopmentFallback === true) {
    return DEVELOPMENT_IDENTIFIER_SECRET;
  }
  throw new ApiError(
    503,
    options.missingSecretCode || "IDENTIFIER_SECRET_MISSING",
    "The privacy identifier secret is not configured.",
  );
}

function directAddress(req) {
  return firstValidIp(req?.socket?.remoteAddress) || "unknown";
}

function safeTraceValue(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = String(candidate || "").trim();
  return SAFE_TRACE_VALUE.test(normalized) ? normalized : null;
}

function safeMethod(value) {
  const method = String(value || "").toUpperCase();
  return /^[A-Z]{1,12}$/.test(method) ? method : "UNKNOWN";
}

function safeErrorCode(value) {
  const code = String(value || "");
  return /^[A-Z0-9_]{3,80}$/.test(code) ? code : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

function firstValidIp(value) {
  const candidate = String(value || "").split(",")[0].trim();
  return isIP(candidate) ? candidate : null;
}

function lastValidIp(value) {
  const candidates = String(value || "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => isIP(candidate));
  return candidates.at(-1) || null;
}
