export const AUTH_ACCESS_COOKIE = "modu_brain_access";
export const AUTH_REFRESH_COOKIE = "modu_brain_refresh";
export const AUTH_EXPIRES_COOKIE = "modu_brain_expires";
export const AUTH_SECURE_ACCESS_COOKIE = `__Host-${AUTH_ACCESS_COOKIE}`;
export const AUTH_SECURE_REFRESH_COOKIE = `__Host-${AUTH_REFRESH_COOKIE}`;
export const AUTH_SECURE_EXPIRES_COOKIE = `__Host-${AUTH_EXPIRES_COOKIE}`;
export const AUTH_REFRESH_LEAD_MS = 60_000;

const REFRESH_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function readAuthSessionCookies(req) {
  const cookies = parseCookies(req?.headers?.cookie);
  const names = cookieNames(isHttpsRequest(req));
  const expiresAt = Number(cookies.get(names.expires));
  return {
    accessToken: cookies.get(names.access) || null,
    refreshToken: cookies.get(names.refresh) || null,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
  };
}

export function writeAuthSessionCookies(
  req,
  res,
  { accessToken, refreshToken, expiresIn },
  options = {},
) {
  const now = options.now?.() ?? Date.now();
  const expiresAt = deriveAccessExpiresAt(accessToken, expiresIn, now);
  const accessMaxAge = Math.max(1, Math.ceil((expiresAt - now) / 1000));
  const secure = isHttpsRequest(req);
  const names = cookieNames(secure);
  res.setHeader("Set-Cookie", [
    serializeCookie(names.access, accessToken, { maxAge: accessMaxAge, secure }),
    serializeCookie(names.refresh, refreshToken, {
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
      secure,
    }),
    serializeCookie(names.expires, String(expiresAt), {
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
      secure,
    }),
  ]);
  setAuthSessionCacheHeaders(res);
  return expiresAt;
}

export function clearAuthSessionCookies(req, res) {
  const secure = isHttpsRequest(req);
  const names = cookieNames(secure);
  res.setHeader("Set-Cookie", [
    expireCookie(names.access, secure),
    expireCookie(names.refresh, secure),
    expireCookie(names.expires, secure),
  ]);
  setAuthSessionCacheHeaders(res);
}

export function authSessionCacheHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
    Vary: "Cookie",
  };
}

export function setAuthSessionCacheHeaders(res) {
  for (const [name, value] of Object.entries(authSessionCacheHeaders())) {
    res.setHeader(name, value);
  }
}

export function deriveAccessExpiresAt(accessToken, expiresIn, now = Date.now()) {
  const durationSeconds = boundedExpiresIn(expiresIn);
  const fallback = now + durationSeconds * 1000;
  const jwtExpiresAt = jwtExpiration(accessToken);
  return jwtExpiresAt && jwtExpiresAt > now ? Math.min(jwtExpiresAt, fallback) : fallback;
}

export function isHttpsRequest(req) {
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(req?.socket?.encrypted) || forwarded === "https";
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || cookies.has(name)) continue;
    try {
      cookies.set(name, decodeURIComponent(part.slice(separator + 1).trim()));
    } catch {
      // Ignore malformed cookie values; authentication will fail closed.
    }
  }
  return cookies;
}

function serializeCookie(name, value, { maxAge, secure }) {
  return [
    `${name}=${encodeURIComponent(String(value))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function expireCookie(name, secure) {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function boundedExpiresIn(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 86_400) return 3_600;
  return number;
}

function jwtExpiration(token) {
  try {
    const encoded = String(token).split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return Number.isFinite(payload?.exp) ? Number(payload.exp) * 1000 : null;
  } catch {
    return null;
  }
}

function cookieNames(secure) {
  return secure
    ? {
        access: AUTH_SECURE_ACCESS_COOKIE,
        refresh: AUTH_SECURE_REFRESH_COOKIE,
        expires: AUTH_SECURE_EXPIRES_COOKIE,
      }
    : {
        access: AUTH_ACCESS_COOKIE,
        refresh: AUTH_REFRESH_COOKIE,
        expires: AUTH_EXPIRES_COOKIE,
      };
}
