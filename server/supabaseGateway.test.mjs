// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createCircuitState,
  createPostgrestClient,
  createSupabaseGateway,
} from "./supabaseGateway.mjs";

describe("Supabase gateway", () => {
  it("verifies a bearer token with Auth and creates scoped PostgREST clients", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { id: "user-1", email: "a@example.com" }));
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co/",
      publishableKey: "publishable-key",
      secretKey: "opaque-service-key-for-tests",
      fetch: fetchMock,
    });
    const user = await gateway.authenticate("access-token");
    expect(user).toEqual({ id: "user-1", email: "a@example.com", accessToken: "access-token" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/user",
      expect.objectContaining({ headers: { apikey: "publishable-key", Authorization: "Bearer access-token" } }),
    );

    fetchMock.mockResolvedValue(response(200, []));
    await gateway.forUser("access-token").request("projects?select=id");
    await gateway.asServiceRole().request("projects?select=id");
    expect(fetchMock.mock.calls.at(-2)[1].headers.Authorization).toBe("Bearer access-token");
    expect(fetchMock.mock.calls.at(-1)[1].headers.apikey).toBe("opaque-service-key-for-tests");
    expect(fetchMock.mock.calls.at(-1)[1].headers).not.toHaveProperty("Authorization");
  });

  it("rejects missing/invalid tokens and unavailable auth without leaking upstream bodies", async () => {
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      anonKey: "anon",
      fetch: vi.fn().mockResolvedValue(response(401, { message: "secret jwt detail" })),
    });
    await expect(gateway.authenticate()).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    await expect(gateway.authenticate("bad")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_ACCESS_TOKEN",
    });

    const unavailable = createSupabaseGateway({
      url: "https://project.supabase.co",
      anonKey: "anon",
      fetch: vi.fn().mockRejectedValue(new Error("network secret")),
    });
    await expect(unavailable.authenticate("token")).rejects.toMatchObject({
      status: 503,
      code: "AUTH_SERVICE_UNAVAILABLE",
    });
  });

  it("rotates a refresh token with the publishable apikey and no Authorization secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    }));
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_browser",
      secretKey: "sb_secret_server_only",
      fetch: fetchMock,
    });

    await expect(gateway.refreshSession("old-refresh")).resolves.toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/token?grant_type=refresh_token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "sb_publishable_browser" }),
        body: JSON.stringify({ refresh_token: "old-refresh" }),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("logs out only the current user session and never uses the opaque server secret as bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(204));
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_browser",
      secretKey: "sb_secret_server_only",
      fetch: fetchMock,
    });

    await expect(gateway.logout("user-access-token")).resolves.toEqual({
      loggedOut: true,
      alreadyExpired: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/logout?scope=local",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "sb_publishable_browser",
          Authorization: "Bearer user-access-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).not.toContain("sb_secret_server_only");
  });

  it("maps rejected refresh tokens without exposing the upstream response", async () => {
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "publishable",
      fetch: vi.fn().mockResolvedValue(response(401, { message: "private refresh detail" })),
    });
    await expect(gateway.refreshSession("expired-refresh")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("fails closed when rotation omits the replacement refresh token", async () => {
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "publishable",
      fetch: vi.fn().mockResolvedValue(response(200, {
        access_token: "new-access",
        expires_in: 3600,
      })),
    });
    await expect(gateway.refreshSession("old-refresh")).rejects.toMatchObject({
      status: 503,
      code: "AUTH_SERVICE_UNAVAILABLE",
    });
  });

  it("reports missing deployment configuration", () => {
    const gateway = createSupabaseGateway({ url: "", publishableKey: "", secretKey: "" });
    expect(() => gateway.assertConfigured()).toThrow(expect.objectContaining({ code: "DATABASE_NOT_CONFIGURED" }));
    const partial = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "publishable",
    });
    expect(() => partial.asServiceRole()).toThrow(
      expect.objectContaining({ details: { missing: ["SUPABASE_SECRET_KEY"] } }),
    );
  });

  it("keeps legacy JWT service-role keys in Authorization while opaque secrets use apikey only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, []));
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      anonKey: "legacy-anon",
      serviceRoleKey: "header.payload.signature",
      fetch: fetchMock,
    });
    await gateway.asServiceRole().request("projects?select=id");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      apikey: "header.payload.signature",
      Authorization: "Bearer header.payload.signature",
    });
  });

  it("deletes the authenticated account through the server-only Auth admin endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { id: "user-1" }));
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "publishable",
      secretKey: "sb_secret_server_only",
      fetch: fetchMock,
    });

    await expect(gateway.deleteAuthUser("user-1")).resolves.toEqual({
      deleted: true,
      alreadyMissing: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/admin/users/user-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ apikey: "sb_secret_server_only" }),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("verifies asymmetric Supabase JWTs locally and caches JWKS for ten minutes", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "ES256" };
    const token = await new SignJWT({ role: "authenticated", email: "local@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer("https://project.supabase.co/auth/v1")
      .setAudience("authenticated")
      .setSubject("user-local")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const fetchMock = vi.fn().mockResolvedValue(response(200, { keys: [publicJwk] }));
    const gateway = createSupabaseGateway({
      url: "https://project.supabase.co",
      publishableKey: "publishable",
      fetch: fetchMock,
    });

    await expect(gateway.authenticate(token)).resolves.toMatchObject({
      id: "user-local",
      email: "local@example.com",
    });
    await gateway.authenticate(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://project.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });
});

describe("PostgREST client", () => {
  it("sends JSON with return preferences and parses successful responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(201, [{ id: "one" }]));
    const client = createPostgrestClient({
      url: "https://project.supabase.co",
      apiKey: "anon",
      accessToken: "jwt",
      fetchImpl: fetchMock,
    });
    await expect(
      client.request("projects", { method: "POST", body: { title: "x" }, prefer: "return=representation" }),
    ).resolves.toEqual([{ id: "one" }]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "x" }),
      headers: expect.objectContaining({ Prefer: "return=representation", "Content-Type": "application/json" }),
    });
  });

  it.each([
    [400, { message: "IDEMPOTENCY_CONFLICT" }, 409, "IDEMPOTENCY_CONFLICT"],
    [400, { message: "RUN_NOT_ANNOTATABLE" }, 409, "RUN_NOT_ANNOTATABLE"],
    [400, { message: "INVALID_ANNOTATION_TARGET" }, 400, "INVALID_ANNOTATION"],
    [400, { message: "ANNOTATION_TARGET_NOT_FOUND" }, 400, "INVALID_ANNOTATION"],
    [400, { message: "ANALYSIS_ARTIFACT_IMMUTABLE" }, 409, "ANALYSIS_ARTIFACT_IMMUTABLE"],
    [409, { code: "23505" }, 409, "ANALYSIS_ALREADY_RUNNING"],
    [400, { message: "INVALID_SOURCE_SELECTION" }, 400, "INVALID_SOURCE_SELECTION"],
    [400, { message: "RATE_LIMITED" }, 429, "RATE_LIMITED"],
    [400, { message: "INVALID_SOURCE_SEGMENT_TEXT" }, 400, "INVALID_CONTEXT_IMPORT"],
    [400, { message: "IMPORTED_SOURCE_IMMUTABLE" }, 409, "IMPORTED_SOURCE_IMMUTABLE"],
    [406, { code: "PGRST116" }, 404, "NOT_FOUND"],
    [404, { code: "PGRST205" }, 503, "DATABASE_UNAVAILABLE"],
    [404, { message: "missing API route" }, 503, "DATABASE_UNAVAILABLE"],
    [403, { code: "42501" }, 404, "NOT_FOUND"],
    [500, { message: "postgres unavailable secret" }, 503, "DATABASE_UNAVAILABLE"],
    [400, { message: "constraint" }, 400, "DATABASE_REQUEST_REJECTED"],
  ])("maps PostgREST %i to a stable API error", async (status, payload, expectedStatus, code) => {
    const client = createPostgrestClient({
      url: "https://project.supabase.co",
      apiKey: "anon",
      accessToken: "jwt",
      fetchImpl: vi.fn().mockResolvedValue(response(status, payload)),
    });
    await expect(client.request("rpc/test")).rejects.toMatchObject({ status: expectedStatus, code });
  });

  it("maps network failures to database unavailability", async () => {
    const client = createPostgrestClient({
      url: "https://project.supabase.co",
      apiKey: "anon",
      accessToken: "jwt",
      fetchImpl: vi.fn().mockRejectedValue(new Error("socket failed")),
    });
    await expect(client.request("projects")).rejects.toMatchObject({
      status: 503,
      code: "DATABASE_UNAVAILABLE",
    });
  });

  it("retries safe reads once but never retries a mutation", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(response(200, [{ id: "recovered" }]))
      .mockRejectedValueOnce(new Error("mutation failed"));
    const client = createPostgrestClient({
      url: "https://project.supabase.co",
      apiKey: "anon",
      fetchImpl: fetchMock,
    });

    await expect(client.request("projects", { retryDelayMs: 0 })).resolves.toEqual([
      { id: "recovered" },
    ]);
    await expect(client.request("projects", {
      method: "POST",
      body: { title: "one" },
      retryDelayMs: 0,
    })).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("opens a short circuit after repeated upstream failures", async () => {
    let now = 1_000;
    const circuit = createCircuitState({ threshold: 2, cooldownMs: 5_000, now: () => now });
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    const client = createPostgrestClient({
      url: "https://project.supabase.co",
      apiKey: "anon",
      fetchImpl: fetchMock,
      circuit,
    });

    await expect(client.request("projects", { retryDelayMs: 0 })).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    await expect(client.request("projects", { retryDelayMs: 0 })).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    const callsBeforeOpenRequest = fetchMock.mock.calls.length;
    await expect(client.request("projects")).rejects.toMatchObject({
      headers: { "Retry-After": "5" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeOpenRequest);

    now += 5_001;
    await expect(client.request("projects", { retryDelayMs: 0 })).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeOpenRequest);
  });
});

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (payload === undefined ? "" : JSON.stringify(payload)),
  };
}
