import { ApiError } from "./apiErrors.mjs";

export const MAX_JSON_BODY_BYTES = 256 * 1024;

export function setApiHeaders(res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

export function writeData(res, status, data, headers = undefined) {
  setApiHeaders(res);
  setResponseHeaders(res, headers);
  res.statusCode = status;
  res.end(JSON.stringify({ data }));
}

export function writeApiError(res, error) {
  setApiHeaders(res);
  setResponseHeaders(res, error.headers);
  res.moduBrainErrorCode = error.code || "INTERNAL_SERVER_ERROR";
  res.statusCode = error.status || 500;
  res.end(
    JSON.stringify({
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        message: error.message || "요청을 처리하지 못했습니다.",
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    }),
  );
}

export function createRequestAbortContext(req, res, options = {}) {
  const controller = new AbortController();
  const parentSignal = options.signal || req?.moduBrainSignal;
  let timedOut = false;

  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const abortFromParent = () => abort(parentSignal?.reason);
  const abortFromClient = () => abort(new DOMException("Request cancelled", "AbortError"));
  const abortFromClose = () => {
    if (!res?.writableEnded) abortFromClient();
  };

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  req?.once?.("aborted", abortFromClient);
  res?.once?.("close", abortFromClose);

  const timeoutMs = boundedInteger(options.timeoutMs, 1, 300_000, 45_000);
  const timeout = setTimeout(() => {
    timedOut = true;
    abort(new DOMException("Request deadline exceeded", "TimeoutError"));
  }, timeoutMs);
  timeout.unref?.();

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
      req?.off?.("aborted", abortFromClient);
      res?.off?.("close", abortFromClose);
    },
  };
}

export function createCachedReadinessProbe(check, options = {}) {
  const successTtlMs = boundedInteger(options.successTtlMs, 1_000, 60_000, 15_000);
  const failureTtlMs = boundedInteger(options.failureTtlMs, 500, 10_000, 3_000);
  const now = options.now || Date.now;
  let cache = null;
  let inFlight = null;

  return async function probe() {
    const startedAt = now();
    if (cache && cache.expiresAt > startedAt) return { ...cache.value, cached: true };
    if (inFlight) return { ...(await inFlight), cached: true };

    inFlight = (async () => {
      const probeStartedAt = now();
      let status = "ready";
      try {
        await check();
      } catch {
        status = "unavailable";
      }
      const probeFinishedAt = now();
      const value = {
        status,
        checkedAt: new Date(probeFinishedAt).toISOString(),
        latencyMs: Math.max(0, probeFinishedAt - probeStartedAt),
        cached: false,
      };
      cache = {
        value,
        expiresAt: probeFinishedAt + (status === "ready" ? successTtlMs : failureTtlMs),
      };
      return value;
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };
}

export async function readJson(req, options = {}) {
  const maxBytes = options.maxBytes || MAX_JSON_BODY_BYTES;
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new ApiError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.resume();
    throw new ApiError(413, "REQUEST_TOO_LARGE", "요청 본문이 너무 큽니다.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) {
      throw new ApiError(413, "REQUEST_TOO_LARGE", "요청 본문이 너무 큽니다.");
    }
    chunks.push(chunk);
  }

  try {
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "INVALID_JSON", "올바른 JSON 본문이 아닙니다.");
  }
}

export function allowOnly(req, res, methods) {
  if (req.method === "OPTIONS") {
    setApiHeaders(res);
    res.setHeader("Allow", [...methods, "OPTIONS"].join(", "));
    res.statusCode = 204;
    res.end();
    return false;
  }

  if (!methods.includes(req.method)) {
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "지원하지 않는 요청 메서드입니다.",
      undefined,
      { Allow: [...methods, "OPTIONS"].join(", ") },
    );
  }
  return true;
}

function setResponseHeaders(res, headers) {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}
