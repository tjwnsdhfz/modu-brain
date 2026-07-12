import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthRequestError,
  COOKIE_SESSION_SENTINEL,
  SupabaseRestAuthService,
} from "./auth";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/login");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SupabaseRestAuthService", () => {
  it("requests a passwordless link with the configured public key only", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(authResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService({
      url: "https://demo.supabase.co/",
      publishableKey: "publishable",
    });

    await expect(
      service.sendMagicLink("team@example.com", "https://demo.example/login"),
    ).resolves.toEqual({ email: "team@example.com" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://demo.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fdemo.example%2Flogin",
    );
    expect(init?.headers).toEqual(expect.objectContaining({ apikey: "publishable" }));
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("hands callback tokens to the BFF once and clears the fragment immediately", async () => {
    window.history.replaceState(
      null,
      "",
      "/login#access_token=access-secret&refresh_token=refresh-secret&expires_in=3600",
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sessionResponse({ id: "user-1", email: "team@example.com" }, 3_600_000),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();

    const pending = service.consumeCallback(window.location.hash);
    expect(window.location.hash).toBe("");
    await expect(pending).resolves.toEqual({
      accessToken: COOKIE_SESSION_SENTINEL,
      expiresAt: 3_600_000,
      user: { id: "user-1", email: "team@example.com" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
          expiresIn: 3600,
        }),
      }),
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).not.toContain("access-secret");
    expect(JSON.stringify(sessionStorage)).not.toContain("refresh-secret");
  });

  it("reuses the in-flight callback exchange during a StrictMode-style remount", async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pendingResponse);
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();

    const first = service.consumeCallback(
      "#access_token=access-once&refresh_token=refresh-once&expires_in=3600",
    );
    const second = service.consumeCallback("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(sessionResponse({ id: "user-1", email: "team@example.com" }, 3_600_000));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ accessToken: COOKIE_SESSION_SENTINEL }),
      expect.objectContaining({ accessToken: COOKIE_SESSION_SENTINEL }),
    ]);
  });

  it("does not consume or clear the read-only share fragment", async () => {
    window.history.replaceState(null, "", "/share#token=share-secret");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();

    await expect(service.consumeCallback(window.location.hash)).resolves.toBeNull();
    expect(window.location.hash).toBe("#token=share-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears an expired magic-link error fragment without exposing its description", async () => {
    window.history.replaceState(
      null,
      "",
      "/login#error=access_denied&error_code=otp_expired&error_description=private+upstream+detail",
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();

    await expect(service.consumeCallback(window.location.hash)).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        message: "로그인 링크가 만료되었습니다. 새 링크를 요청해 주세요.",
      }),
    );
    expect(window.location.hash).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the cookie session and removes the legacy token cache", async () => {
    localStorage.setItem("modu-brain.auth-session.v1", "legacy-access-secret");
    sessionStorage.setItem("modu-brain.auth-session.v1", "legacy-refresh-secret");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sessionResponse({ id: "user-1", email: "team@example.com" }, 7_200_000),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();

    await expect(service.restoreSession()).resolves.toMatchObject({
      accessToken: COOKIE_SESSION_SENTINEL,
      expiresAt: 7_200_000,
    });
    expect(localStorage.getItem("modu-brain.auth-session.v1")).toBeNull();
    expect(sessionStorage.getItem("modu-brain.auth-session.v1")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("refreshes through the BFF without exposing a refresh token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sessionResponse({ id: "user-1", email: "team@example.com" }, 9_000_000),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();
    const session = {
      accessToken: COOKIE_SESSION_SENTINEL,
      expiresAt: 1,
      user: { id: "user-1", email: "team@example.com" },
    };

    await expect(service.refreshSession(session)).resolves.toMatchObject({
      accessToken: COOKIE_SESSION_SENTINEL,
      expiresAt: 9_000_000,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/auth/refresh");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("treats a missing cookie session as signed out", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      bffResponse({ error: { message: "A login session is required." } }, 401),
    ));
    const service = new SupabaseRestAuthService();
    await expect(service.restoreSession()).resolves.toBeNull();
  });

  it("clears the server cookie session on logout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      { ok: true, status: 204, headers: new Headers() } as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new SupabaseRestAuthService();

    await service.signOut(null);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("preserves Supabase Retry-After for a friendly magic-link cooldown", async () => {
    const service = new SupabaseRestAuthService({
      url: "https://demo.supabase.co",
      publishableKey: "publishable",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        authResponse(
          { msg: "For security purposes, you can only request this after 60 seconds" },
          429,
          { "Retry-After": "75" },
        ),
      ),
    );

    await expect(service.sendMagicLink("team@example.com", "https://demo.example/login"))
      .rejects.toEqual(expect.objectContaining<Partial<AuthRequestError>>({
        status: 429,
        retryAfterSeconds: 75,
      }));
  });
});

function sessionResponse(user: { id: string; email: string }, expiresAt: number) {
  return bffResponse({ data: { user, expiresAt } });
}

function bffResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function authResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}
