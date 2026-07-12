// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_EXPIRES_COOKIE,
  AUTH_REFRESH_COOKIE,
  AUTH_SECURE_ACCESS_COOKIE,
  clearAuthSessionCookies,
  deriveAccessExpiresAt,
  readAuthSessionCookies,
  writeAuthSessionCookies,
} from "./authSession.mjs";

describe("HttpOnly auth session cookies", () => {
  it("sets strict HttpOnly cookies without Secure on local HTTP", () => {
    const res = responseRecorder();
    const expiresAt = writeAuthSessionCookies(
      { headers: {}, socket: {} },
      res,
      { accessToken: "access.token.value", refreshToken: "refresh/value", expiresIn: 3600 },
      { now: () => 1_000 },
    );

    expect(expiresAt).toBe(3_601_000);
    const cookies = res.headers.get("set-cookie");
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).not.toContain("Secure");
    }
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("sets Secure behind HTTPS and restores encoded cookie values", () => {
    const res = responseRecorder();
    writeAuthSessionCookies(
      { headers: { "x-forwarded-proto": "https" }, socket: {} },
      res,
      { accessToken: "access+token", refreshToken: "refresh/token", expiresIn: 60 },
      { now: () => 10_000 },
    );
    expect(res.headers.get("set-cookie").every((cookie) => cookie.includes("Secure"))).toBe(true);
    expect(res.headers.get("set-cookie")[0]).toContain(`${AUTH_SECURE_ACCESS_COOKIE}=`);

    expect(readAuthSessionCookies({
      headers: {
        cookie: `${AUTH_ACCESS_COOKIE}=access%2Btoken; ${AUTH_REFRESH_COOKIE}=refresh%2Ftoken; ${AUTH_EXPIRES_COOKIE}=70000`,
      },
    })).toEqual({
      accessToken: "access+token",
      refreshToken: "refresh/token",
      expiresAt: 70_000,
    });
  });

  it("uses the earlier signed JWT expiry and clears every cookie immediately", () => {
    const now = 1_000_000;
    const token = tokenFor({ exp: Math.floor((now + 120_000) / 1000) });
    expect(deriveAccessExpiresAt(token, 3600, now)).toBe(now + 120_000);

    const res = responseRecorder();
    clearAuthSessionCookies({ headers: { "x-forwarded-proto": "https" }, socket: {} }, res);
    const cookies = res.headers.get("set-cookie");
    expect(cookies).toHaveLength(3);
    expect(cookies.every((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes("Secure"))).toBe(true);
  });
});

function responseRecorder() {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
  };
}

function tokenFor(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
