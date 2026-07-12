import { ApiError } from "./apiErrors.mjs";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const DEFAULT_TIMEOUT_MS = 10_000;
const JWKS_CACHE_MS = 10 * 60 * 1000;
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export function createSupabaseGateway(options = {}) {
  const url = String(options.url || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey =
    options.publishableKey ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    options.anonKey ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  const secretKey =
    options.secretKey ||
    process.env.SUPABASE_SECRET_KEY ||
    options.serviceRoleKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  const fetchImpl = options.fetch || globalThis.fetch;
  const circuit = options.circuit || createCircuitState(options.circuitOptions);
  let jwksCache = null;

  function assertConfigured({ serviceRole = false } = {}) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL");
    if (!publishableKey) missing.push("SUPABASE_PUBLISHABLE_KEY");
    if (serviceRole && !secretKey) missing.push("SUPABASE_SECRET_KEY");
    if (missing.length) {
      throw new ApiError(503, "DATABASE_NOT_CONFIGURED", "데이터베이스 설정이 필요합니다.", {
        missing,
      });
    }
  }

  async function authenticate(accessToken, requestOptions = {}) {
    assertConfigured();
    if (!accessToken) {
      throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
    }

    const locallyVerified = await verifyAsymmetricJwt(accessToken, requestOptions.signal);
    if (locallyVerified) return locallyVerified;

    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/user`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
        signal: combineSignals(requestOptions.signal, DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(401, "INVALID_ACCESS_TOKEN", "로그인 세션이 유효하지 않습니다.");
    }
    if (!response.ok) {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
    }

    const user = await response.json();
    if (!user?.id) throw new ApiError(401, "INVALID_ACCESS_TOKEN", "로그인 세션이 유효하지 않습니다.");
    return { id: user.id, email: user.email || null, accessToken };
  }

  async function refreshSession(refreshToken, requestOptions = {}) {
    assertConfigured();
    if (!refreshToken) {
      throw new ApiError(401, "AUTH_REQUIRED", "A refresh session is required.");
    }

    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: combineSignals(requestOptions.signal, DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "The authentication service is unavailable.");
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new ApiError(401, "INVALID_REFRESH_TOKEN", "The login session can no longer be refreshed.");
    }
    if (!response.ok) {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "The authentication service is unavailable.");
    }
    const payload = await response.json().catch(() => null);
    const expiresIn = Number(payload?.expires_in);
    if (
      !payload?.access_token ||
      !payload?.refresh_token ||
      !Number.isInteger(expiresIn) ||
      expiresIn < 1 ||
      expiresIn > 86_400
    ) {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "The authentication service returned an invalid session.");
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn,
    };
  }

  async function logout(accessToken, requestOptions = {}) {
    assertConfigured();
    if (!accessToken) return { loggedOut: false };
    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: combineSignals(requestOptions.signal, DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "The authentication service is unavailable.");
    }
    if (response.status === 401 || response.status === 403) {
      return { loggedOut: true, alreadyExpired: true };
    }
    if (!response.ok) {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "The authentication service is unavailable.");
    }
    return { loggedOut: true, alreadyExpired: false };
  }

  async function verifyAsymmetricJwt(accessToken, signal) {
    let header;
    try {
      header = decodeProtectedHeader(accessToken);
    } catch {
      return null;
    }
    if (!header.kid || !["ES256", "RS256"].includes(String(header.alg))) return null;

    try {
      const now = Date.now();
      if (!jwksCache || jwksCache.expiresAt <= now) {
        jwksCache = await fetchJwks(signal);
      }
      let verified;
      try {
        verified = await verifyWith(jwksCache.keys);
      } catch (error) {
        if (String(error?.code || "") !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
        jwksCache = await fetchJwks(signal);
        verified = await verifyWith(jwksCache.keys);
      }
      const claims = verified.payload;
      if (!claims.sub || claims.role !== "authenticated") {
        throw new Error("JWT claims are not an authenticated Supabase session.");
      }
      return {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
        accessToken,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
      }
      throw new ApiError(401, "INVALID_ACCESS_TOKEN", "로그인 세션이 유효하지 않습니다.");
    }

    async function verifyWith(keys) {
      return jwtVerify(accessToken, createLocalJWKSet(keys), {
        algorithms: ["ES256", "RS256"],
        issuer: `${url}/auth/v1`,
        audience: "authenticated",
        clockTolerance: 5,
      });
    }
  }

  async function fetchJwks(signal) {
    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/.well-known/jwks.json`, {
        headers: { apikey: publishableKey, Accept: "application/json" },
        signal: combineSignals(signal, DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
    }
    if (!response.ok) {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
    }
    const keys = await response.json().catch(() => null);
    if (!Array.isArray(keys?.keys)) {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
    }
    return { keys, expiresAt: Date.now() + JWKS_CACHE_MS };
  }

  function forUser(accessToken) {
    assertConfigured();
    return createPostgrestClient({ url, apiKey: publishableKey, accessToken, fetchImpl, circuit });
  }

  function asServiceRole() {
    assertConfigured({ serviceRole: true });
    return createPostgrestClient({
      url,
      apiKey: secretKey,
      accessToken: looksLikeJwt(secretKey) ? secretKey : undefined,
      fetchImpl,
      circuit,
    });
  }

  async function deleteAuthUser(userId, requestOptions = {}) {
    assertConfigured({ serviceRole: true });
    const headers = { apikey: secretKey, Accept: "application/json" };
    if (looksLikeJwt(secretKey)) headers.Authorization = `Bearer ${secretKey}`;
    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers,
        signal: combineSignals(requestOptions.signal, DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.");
    }
    if (response.status === 404) return { deleted: true, alreadyMissing: true };
    if (!response.ok) {
      throw new ApiError(503, "ACCOUNT_DELETE_UNAVAILABLE", "계정을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
    return { deleted: true, alreadyMissing: false };
  }

  return {
    authenticate,
    refreshSession,
    logout,
    forUser,
    asServiceRole,
    deleteAuthUser,
    assertConfigured,
    purgeJwksCache() {
      jwksCache = null;
    },
  };
}

export function createPostgrestClient({
  url,
  apiKey,
  accessToken,
  fetchImpl = globalThis.fetch,
  circuit = createCircuitState(),
}) {
  return {
    async request(path, options = {}) {
      const headers = {
        apikey: apiKey,
        Accept: "application/json",
        ...(options.headers || {}),
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.prefer) headers.Prefer = options.prefer;

      const method = String(options.method || "GET").toUpperCase();
      const attempts = ["GET", "HEAD"].includes(method) ? 2 : 1;
      let response;

      if (circuit.isOpen()) {
        throw new ApiError(503, "DATABASE_UNAVAILABLE", "데이터베이스를 사용할 수 없습니다.", undefined, {
          "Retry-After": String(circuit.retryAfterSeconds()),
        });
      }

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          response = await fetchImpl(`${url}/rest/v1/${path}`, {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: combineSignals(options.signal, options.timeoutMs || DEFAULT_TIMEOUT_MS),
          });
          if (!TRANSIENT_STATUSES.has(response.status) || attempt === attempts - 1) break;
        } catch {
          if (options.signal?.aborted || attempt === attempts - 1) break;
        }
        await retryPause(options.signal, options.retryDelayMs ?? 25);
      }

      if (!response) {
        circuit.recordFailure();
        throw new ApiError(503, "DATABASE_UNAVAILABLE", "데이터베이스를 사용할 수 없습니다.", undefined, {
          ...(circuit.isOpen() ? { "Retry-After": String(circuit.retryAfterSeconds()) } : {}),
        });
      }

      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        if (TRANSIENT_STATUSES.has(response.status)) circuit.recordFailure();
        else circuit.recordSuccess();
        throw mapPostgrestError(response.status, payload);
      }
      circuit.recordSuccess();
      return payload;
    },
  };
}

export function createCircuitState(options = {}) {
  const threshold = Math.max(1, Number(options.threshold || 5));
  const cooldownMs = Math.max(100, Number(options.cooldownMs || 10_000));
  const now = options.now || Date.now;
  let failures = 0;
  let openUntil = 0;
  return {
    isOpen() {
      return openUntil > now();
    },
    retryAfterSeconds() {
      return Math.max(1, Math.ceil((openUntil - now()) / 1000));
    },
    recordFailure() {
      failures += 1;
      if (failures >= threshold) openUntil = now() + cooldownMs;
    },
    recordSuccess() {
      failures = 0;
      openUntil = 0;
    },
  };
}

function combineSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([signal, timeout])
    : signal || timeout;
}

function retryPause(signal, delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    };
    const timer = setTimeout(finish, delayMs);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function looksLikeJwt(value) {
  return String(value).split(".").length === 3;
}

function mapPostgrestError(status, payload) {
  const message = String(payload?.message || "");
  if (["PGRST202", "PGRST204", "PGRST205", "42P01", "42883"].includes(payload?.code)) {
    return new ApiError(503, "DATABASE_UNAVAILABLE", "데이터베이스 스키마를 사용할 수 없습니다.");
  }
  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return new ApiError(409, "IDEMPOTENCY_CONFLICT", "같은 키가 다른 분석 요청에 사용되었습니다.");
  }
  if (message.includes("RUN_NOT_ANNOTATABLE")) {
    return new ApiError(
      409,
      "RUN_NOT_ANNOTATABLE",
      "Only a succeeded analysis run can receive feedback.",
    );
  }
  if (
    message.includes("INVALID_ANNOTATION_") ||
    message.includes("ANNOTATION_TARGET_NOT_FOUND")
  ) {
    return new ApiError(
      400,
      "INVALID_ANNOTATION",
      "The feedback annotation is not valid for this analysis run.",
    );
  }
  if (message.includes("ANALYSIS_ARTIFACT_IMMUTABLE")) {
    return new ApiError(
      409,
      "ANALYSIS_ARTIFACT_IMMUTABLE",
      "Analysis workflow records are immutable.",
    );
  }
  if (message.includes("ANALYSIS_ALREADY_RUNNING") || payload?.code === "23505") {
    return new ApiError(409, "ANALYSIS_ALREADY_RUNNING", "이미 실행 중인 분석이 있습니다.");
  }
  if (message.includes("INVALID_SOURCE_SELECTION")) {
    return new ApiError(400, "INVALID_SOURCE_SELECTION", "선택한 기록을 사용할 수 없습니다.");
  }
  if (message.includes("ANALYSIS_INPUT_TOO_LARGE")) {
    return new ApiError(413, "ANALYSIS_INPUT_TOO_LARGE", "분석 입력은 총 100,000자 이하여야 합니다.");
  }
  if (message.includes("STORAGE_QUOTA_EXCEEDED") || message.includes("CONTEXT_GRAPH_QUOTA_EXCEEDED")) {
    return new ApiError(409, "STORAGE_QUOTA_EXCEEDED", "무료 데모 저장 한도에 도달했습니다. 보관 데이터를 삭제한 뒤 다시 시도해 주세요.");
  }
  if (message.includes("IMPORTED_SOURCE_IMMUTABLE")) {
    return new ApiError(
      409,
      "IMPORTED_SOURCE_IMMUTABLE",
      "가져온 원문의 내용과 시각은 변경할 수 없습니다.",
    );
  }
  if (
    message.includes("INVALID_IMPORT") ||
    message.includes("INVALID_SOURCE_SEGMENT") ||
    message.includes("INVALID_SEGMENT_") ||
    message.includes("INVALID_PARTICIPANTS") ||
    message.includes("INVALID_EXTERNAL_ID") ||
    message.includes("INVALID_SOURCE_") ||
    message.includes("SOURCE_SEGMENTS_TOO_LARGE")
  ) {
    return new ApiError(400, "INVALID_CONTEXT_IMPORT", "가져오기 데이터 형식이 올바르지 않습니다.");
  }
  if (message.includes("RATE_LIMITED")) {
    return new ApiError(429, "RATE_LIMITED", "요청 한도를 초과했습니다.", undefined, {
      "Retry-After": "3600",
    });
  }
  if (payload?.code === "PGRST116") {
    return new ApiError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  }
  if (status === 404) {
    return new ApiError(503, "DATABASE_UNAVAILABLE", "데이터베이스 API를 사용할 수 없습니다.");
  }
  if (status === 401 || status === 403 || payload?.code === "42501") {
    return new ApiError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  }
  if (status >= 500) {
    return new ApiError(503, "DATABASE_UNAVAILABLE", "데이터베이스를 사용할 수 없습니다.");
  }
  return new ApiError(400, "DATABASE_REQUEST_REJECTED", "데이터베이스 요청이 거부되었습니다.");
}
