// @vitest-environment node

import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiErrors.mjs";
import { createApiV1Handler } from "./apiV1.mjs";
import { providerTelemetrySymbol } from "./contextAnalysisCore.mjs";
import { sha256 } from "./security.mjs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const SHARE_ID = "55555555-5555-4555-8555-555555555555";
const IMPORT_ID = "66666666-6666-4666-8666-666666666666";
const SEGMENT_ID = "77777777-7777-4777-8777-777777777777";
const STEP_EVENT_ID = "88888888-8888-4888-8888-888888888888";
const ANNOTATION_ID = "99999999-9999-4999-8999-999999999999";
const now = "2026-07-11T00:00:00.000Z";
const content = "민지는 입력 흐름을 단순하게 만들자고 제안했다. 서준은 결정 근거와 질문을 함께 보여주자고 말했다. 팀은 직접 입력 방식으로 시작하기로 결정했다. 다음 회의에서 공유 범위를 검토하기로 했다.";

let server;
let baseUrl;
let repository;
let publicRepository;
let analyze;
let openAIFlag;
let buildCommit;
let activeResponse;
let recordProductEvent;
let authGatewayAuthenticate;
let authGatewayRefresh;
let authGatewayLogout;
let authNow;

beforeEach(() => {
  repository = createFakeRepository();
  publicRepository = {
    consumeRateLimit: vi.fn().mockResolvedValue(true),
    resolveShare: vi.fn().mockResolvedValue({
      project_title: "테스트 프로젝트",
      result_jsonb: {
        ...sampleAnalysis(),
        provider: { mode: "llm", model: "private-model" },
        decisions: [
          {
            id: "decision_public",
            evidence: [{ sourceRecordId: SOURCE_ID, sourceTitle: "회의록", quote: "근거" }],
          },
        ],
      },
      completed_at: now,
      expires_at: "2026-07-18T00:00:00.000Z",
    }),
  };
  analyze = vi.fn().mockResolvedValue(sampleAnalysis());
  openAIFlag = true;
  buildCommit = null;
  recordProductEvent = vi.fn();
  authNow = new Date("2026-07-11T00:00:00.000Z").getTime();
  authGatewayAuthenticate = vi.fn(async (accessToken) => {
    if (!accessToken) throw new ApiError(401, "AUTH_REQUIRED", "A login session is required.");
    return { id: USER_ID, email: "team@example.com", accessToken };
  });
  authGatewayRefresh = vi.fn().mockResolvedValue({
    accessToken: "rotated-access",
    refreshToken: "rotated-refresh",
    expiresIn: 3600,
  });
  authGatewayLogout = vi.fn().mockResolvedValue({ loggedOut: true });
});

beforeAll(async () => {
  const handler = createApiV1Handler({
    gateway: {
      authenticate: (...args) => authGatewayAuthenticate(...args),
      refreshSession: (...args) => authGatewayRefresh(...args),
      logout: (...args) => authGatewayLogout(...args),
    },
    authenticate: async (_req, accessToken) => {
      if (accessToken !== "valid-token") {
        throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      }
      return { id: USER_ID, accessToken: "valid-token" };
    },
    repositoryFactory: async () => repository,
    serviceRepositoryFactory: async () => repository,
    get publicRepository() {
      return publicRepository;
    },
    analyze: (...args) => analyze(...args),
    get openAIEnabled() {
      return openAIFlag;
    },
    get buildCommit() {
      return buildCommit;
    },
    recordProductEvent: (...args) => recordProductEvent(...args),
    readyCheck: async () => true,
    authNow: () => authNow,
    authLogoutWaitMs: 200,
  });
  server = createServer(async (req, res) => {
    activeResponse = res;
    req.moduBrainSignal = new AbortController().signal;
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    const handled = await handler(req, res, pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("v1 API", () => {
  it("reports liveness/readiness and returns JSON 405/OPTIONS responses", async () => {
    const live = await fetch(`${baseUrl}/api/health/live`);
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({ data: { status: "ok", commit: null } });

    buildCommit = "ABCDEF1234567";
    const versionedLive = await fetch(`${baseUrl}/api/health/live`);
    await expect(versionedLive.json()).resolves.toEqual({
      data: { status: "ok", commit: "abcdef1234567" },
    });

    const previousRenderCommit = process.env.RENDER_GIT_COMMIT;
    try {
      buildCommit = "not-a-commit";
      process.env.RENDER_GIT_COMMIT = "F".repeat(40);
      const renderLive = await fetch(`${baseUrl}/api/health/live`);
      await expect(renderLive.json()).resolves.toEqual({
        data: { status: "ok", commit: "f".repeat(40) },
      });
    } finally {
      if (previousRenderCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = previousRenderCommit;
    }

    const wrongMethod = await fetch(`${baseUrl}/api/health/live`, { method: "POST" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toContain("GET");

    const options = await fetch(`${baseUrl}/api/v1/projects`, { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(await options.text()).toBe("");
  });

  it("requires a Supabase bearer session", async () => {
    const response = await fetch(`${baseUrl}/api/v1/projects`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });

  it("exchanges callback tokens for strict HttpOnly cookies without returning secrets", async () => {
    const response = await createCookieSession();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const cookies = setCookieValues(response.headers);
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).not.toContain("Secure");
    }
    const payload = await response.json();
    expect(payload).toEqual({
      data: {
        user: { id: USER_ID, email: "team@example.com" },
        expiresAt: authNow + 3_600_000,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("valid-token");
    expect(JSON.stringify(payload)).not.toContain("callback-refresh");
    expect(authGatewayAuthenticate).toHaveBeenCalledWith(
      "valid-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses __Host Secure cookies for HTTPS and keeps the auth exchange same-origin", async () => {
    const secure = await createCookieSession({ "X-Forwarded-Proto": "https" });
    for (const cookie of setCookieValues(secure.headers)) {
      expect(cookie).toContain("__Host-modu_brain_");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Strict");
    }

    authGatewayAuthenticate.mockClear();
    const crossOrigin = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessToken: "valid-token",
        refreshToken: "callback-refresh",
        expiresIn: 3600,
      }),
    });
    expect(crossOrigin.status).toBe(403);
    expect(authGatewayAuthenticate).not.toHaveBeenCalled();
  });

  it("restores a cookie session and authenticates protected APIs without Authorization", async () => {
    const created = await createCookieSession();
    const cookie = cookieHeader(created.headers);
    authGatewayAuthenticate.mockClear();

    const restored = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Cookie: cookie },
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      data: { user: { id: USER_ID }, expiresAt: authNow + 3_600_000 },
    });
    expect(authGatewayRefresh).not.toHaveBeenCalled();

    const projects = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { Cookie: cookie },
    });
    expect(projects.status).toBe(200);
    expect(repository.listProjects).toHaveBeenCalled();
  });

  it("passes the restored cookie access token to gateway.forUser and clears it after account deletion", async () => {
    const userRequest = vi.fn().mockResolvedValue([]);
    const forUser = vi.fn(() => ({ request: userRequest }));
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    const gateway = {
      authenticate: vi.fn().mockImplementation(async (accessToken) => ({
        id: USER_ID,
        email: "team@example.com",
        accessToken,
      })),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      forUser,
    };
    const isolated = await startHandlerServer(createApiV1Handler({
      gateway,
      authNow: () => authNow,
      accountDataOperations: { delete: deleteAccount },
    }));
    try {
      const cookie = [
        "modu_brain_access=cookie-access-token",
        "modu_brain_refresh=cookie-refresh-token",
        `modu_brain_expires=${authNow + 3_600_000}`,
      ].join("; ");
      const projects = await fetch(`${isolated.baseUrl}/api/v1/projects`, {
        headers: { Cookie: cookie },
      });
      expect(projects.status).toBe(200);
      expect(forUser).toHaveBeenCalledWith("cookie-access-token");

      const deleted = await fetch(`${isolated.baseUrl}/api/v1/account`, {
        method: "DELETE",
        headers: {
          Cookie: cookie,
          Origin: isolated.baseUrl,
          "X-Confirm-Account-Delete": "delete my account",
        },
      });
      expect(deleted.status).toBe(200);
      expect(deleteAccount).toHaveBeenCalledWith(expect.objectContaining({
        user: expect.objectContaining({ id: USER_ID, accessToken: "cookie-access-token" }),
      }));
      expect(setCookieValues(deleted.headers).every((value) => value.includes("Max-Age=0")))
        .toBe(true);
    } finally {
      await isolated.close();
    }
  });

  it("keeps legacy Bearer precedence when both bearer and cookie credentials are present", async () => {
    const cookie = "modu_brain_access=valid-token; modu_brain_refresh=refresh";
    const bearer = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { Cookie: cookie, Authorization: "Bearer valid-token" },
    });
    expect(bearer.status).toBe(200);

    const malformedBearer = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { Cookie: cookie, Authorization: "Bearer wrong-token" },
    });
    expect(malformedBearer.status).toBe(401);
  });

  it("rotates near-expiry cookies on restore and through the explicit refresh route", async () => {
    const created = await createCookieSession({}, 30);
    const cookie = cookieHeader(created.headers);
    authGatewayAuthenticate.mockClear();

    const restored = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Cookie: cookie },
    });
    expect(restored.status).toBe(200);
    expect(authGatewayRefresh).toHaveBeenCalledWith(
      "callback-refresh",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(setCookieValues(restored.headers).join(";")).toContain("rotated-access");
    expect(setCookieValues(restored.headers).join(";")).toContain("rotated-refresh");

    authGatewayRefresh.mockClear();
    const refreshed = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("cache-control")).toContain("no-store");
    const payload = await refreshed.json();
    expect(payload.data).toEqual({
      user: { id: USER_ID, email: "team@example.com" },
      expiresAt: authNow + 3_600_000,
    });
    expect(JSON.stringify(payload)).not.toContain("rotated-refresh");
  });

  it("clears local cookies even when upstream logout fails", async () => {
    const created = await createCookieSession();
    const cookie = cookieHeader(created.headers);
    authGatewayLogout.mockRejectedValueOnce(new Error("upstream unavailable with secret"));

    const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(setCookieValues(response.headers)).toHaveLength(3);
    expect(setCookieValues(response.headers).every((cookie) => cookie.includes("Max-Age=0")))
      .toBe(true);
    expect(authGatewayLogout).toHaveBeenCalledWith(
      "valid-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("waits briefly for a fast upstream revoke before completing local logout", async () => {
    const created = await createCookieSession();
    const cookie = cookieHeader(created.headers);
    let resolveLogout = () => undefined;
    authGatewayLogout.mockReturnValueOnce(new Promise((resolve) => {
      resolveLogout = () => resolve({ loggedOut: true });
    }));

    let responseSettled = false;
    const pending = fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: baseUrl },
    }).then((response) => {
      responseSettled = true;
      return response;
    });
    await vi.waitFor(() => expect(authGatewayLogout).toHaveBeenCalled());
    expect(responseSettled).toBe(false);
    resolveLogout();
    expect((await pending).status).toBe(204);
  });

  it("clears cookies after a rejected refresh and limits callback bodies to 16KB", async () => {
    const created = await createCookieSession();
    const cookie = cookieHeader(created.headers);
    authGatewayRefresh.mockRejectedValueOnce(
      new ApiError(401, "INVALID_REFRESH_TOKEN", "The refresh session is invalid."),
    );
    const invalid = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: baseUrl },
    });
    expect(invalid.status).toBe(401);
    expect(setCookieValues(invalid.headers).every((value) => value.includes("Max-Age=0")))
      .toBe(true);

    const oversized = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: "a".repeat(17 * 1024),
        refreshToken: "refresh",
        expiresIn: 3600,
      }),
    });
    expect(oversized.status).toBe(413);

    const oversizedCookie = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: "a".repeat(3_501),
        refreshToken: "refresh",
        expiresIn: 3600,
      }),
    });
    expect(oversizedCookie.status).toBe(400);
    await expect(oversizedCookie.json()).resolves.toMatchObject({
      error: { code: "INVALID_AUTH_SESSION" },
    });

    const encodedCookieOverflow = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: "é".repeat(600),
        refreshToken: "refresh",
        expiresIn: 3600,
      }),
    });
    expect(encodedCookieOverflow.status).toBe(400);
  });

  it("reports authenticated OpenAI capability and rejects disabled OpenAI runs", async () => {
    expect((await (await api("/api/v1/capabilities")).json()).data.openaiEnabled).toBe(true);
    openAIFlag = false;
    expect((await (await api("/api/v1/capabilities")).json()).data.openaiEnabled).toBe(false);
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "openai-disabled" },
      body: { sourceIds: [SOURCE_ID], mode: "openai" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "OPENAI_NOT_ENABLED" } });
    expect(repository.startRun).not.toHaveBeenCalled();
  });

  it("creates, lists, updates, archives, and permanently deletes projects", async () => {
    const created = await api("/api/v1/projects", {
      method: "POST",
      body: { title: "새 프로젝트", description: "설명" },
    });
    expect(created.status).toBe(201);
    expect((await created.json()).data.title).toBe("새 프로젝트");

    const list = await api("/api/v1/projects");
    expect((await list.json()).data).toHaveLength(1);
    const archivedList = await api("/api/v1/projects?archived=true");
    expect((await archivedList.json()).data).toHaveLength(1);
    expect(repository.listProjects).toHaveBeenLastCalledWith({ archived: true });

    const updated = await api(`/api/v1/projects/${PROJECT_ID}`, {
      method: "PATCH",
      body: { title: "수정 프로젝트" },
    });
    expect((await updated.json()).data.title).toBe("수정 프로젝트");

    const archived = await api(`/api/v1/projects/${PROJECT_ID}`, { method: "DELETE" });
    expect((await archived.json()).data).toMatchObject({ deleted: true, permanent: false });

    const restored = await api(`/api/v1/projects/${PROJECT_ID}/restore`, { method: "POST" });
    expect((await restored.json()).data.archivedAt).toBeNull();

    const permanent = await api(`/api/v1/projects/${PROJECT_ID}?permanent=true`, {
      method: "DELETE",
      headers: { "X-Confirm-Permanent-Delete": "delete" },
    });
    expect((await permanent.json()).data.permanent).toBe(true);
  });

  it("creates, reads, updates, lists and archives source records with a content hash", async () => {
    const created = await api(`/api/v1/projects/${PROJECT_ID}/sources`, {
      method: "POST",
      body: { kind: "meeting", title: "회의록", content, occurredAt: now },
    });
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    expect(createdBody.data.contentSha256).toBe(sha256(content));

    expect((await (await api(`/api/v1/projects/${PROJECT_ID}/sources`)).json()).data).toHaveLength(1);
    expect((await (await api(`/api/v1/sources/${SOURCE_ID}`)).json()).data.content).toBe(content);

    const updated = await api(`/api/v1/sources/${SOURCE_ID}`, {
      method: "PATCH",
      body: { title: "수정 회의록", content: "😀😀" },
    });
    expect(await updated.json()).toMatchObject({
      data: { title: "수정 회의록", charCount: 2 },
    });
    expect(repository.updateSource.mock.calls.at(-1)[2].char_count).toBe(2);

    const archived = await api(`/api/v1/sources/${SOURCE_ID}`, { method: "DELETE" });
    expect((await archived.json()).data.archivedAt).toBeTruthy();
    const restored = await api(`/api/v1/sources/${SOURCE_ID}/restore`, { method: "POST" });
    expect((await restored.json()).data.archivedAt).toBeNull();

    const emoji = await api(`/api/v1/projects/${PROJECT_ID}/sources`, {
      method: "POST",
      body: { kind: "note", title: "이모지", content: "😀" },
    });
    expect((await emoji.json()).data.charCount).toBe(1);
    expect(repository.createSource.mock.calls.at(-1)[2].char_count).toBe(1);
  });

  it("normalizes and atomically imports account-free Teams context", async () => {
    const response = await api(`/api/v1/projects/${PROJECT_ID}/imports`, {
      method: "POST",
      body: {
        provider: "teams",
        title: "Teams 제품 회의",
        text: JSON.stringify([
          {
            id: "message-1",
            createdDateTime: now,
            from: { user: { displayName: "민지" } },
            body: { contentType: "html", content: "<p>금요일까지 시안을 검토합니다.</p>" },
            webUrl: "https://teams.microsoft.com/l/message/message-1",
          },
        ]),
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      importId: IMPORT_ID,
      provider: "teams",
      participants: ["민지"],
      segmentCount: 1,
      duplicate: false,
      source: {
        title: "Teams 제품 회의",
        content: "민지: 금요일까지 시안을 검토합니다.",
        import: { provider: "teams", participants: ["민지"], segmentCount: 1 },
      },
    });
    expect(repository.importSourceContext).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        provider: "teams",
        segments: [
          expect.objectContaining({
            externalId: "message-1",
            speaker: "민지",
            text: "금요일까지 시안을 검토합니다.",
          }),
        ],
      }),
    );
  });

  it("keeps imported source content immutable while allowing title changes", async () => {
    repository.getSource.mockResolvedValue({
      ...sourceRow(),
      source_imports: [{ id: IMPORT_ID, provider: "teams" }],
    });

    const rejected = await api(`/api/v1/sources/${SOURCE_ID}`, {
      method: "PATCH",
      body: { content: "변조된 원문" },
    });
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "IMPORTED_SOURCE_IMMUTABLE" },
    });
    expect(repository.updateSource).not.toHaveBeenCalled();

    const renamed = await api(`/api/v1/sources/${SOURCE_ID}`, {
      method: "PATCH",
      body: { title: "표시 제목만 변경" },
    });
    expect(renamed.status).toBe(200);
    expect(repository.updateSource).toHaveBeenCalledWith(USER_ID, SOURCE_ID, {
      title: "표시 제목만 변경",
    });
  });

  it("returns ordered source segments with exact external links", async () => {
    const response = await api(`/api/v1/sources/${SOURCE_ID}/segments`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: SEGMENT_ID,
          sourceRecordId: SOURCE_ID,
          ordinal: 0,
          speaker: "민지",
          text: "금요일까지 시안을 검토합니다.",
          sourceUrl: "https://teams.microsoft.com/l/message/message-1",
        },
      ],
    });
  });

  it("adds cursor page metadata, list projections, and lazy detail routes", async () => {
    repository.listSourcesPage = vi.fn(async () => ({
      rows: [{
        ...sourceRow(),
        source_imports: [{
          id: IMPORT_ID,
          provider: "teams",
          participants: ["민지"],
          segment_count: 1,
          imported_at: now,
          metadata: { secret: "private" },
        }],
      }],
      hasMore: true,
    }));
    repository.listRunsPage = vi.fn(async () => ({ rows: [runRow()], hasMore: false }));

    const sourceResponse = await api(`/api/v1/projects/${PROJECT_ID}/sources?limit=1`);
    const sourceBody = await sourceResponse.json();
    expect(sourceBody.page).toMatchObject({ limit: 1, count: 1, hasMore: true });
    expect(sourceBody.page.nextCursor).toEqual(expect.any(String));
    expect(sourceBody.data[0]).not.toHaveProperty("content");
    expect(sourceBody.data[0]).not.toHaveProperty("contentSha256");
    expect(sourceBody.data[0].import).not.toHaveProperty("participants");
    expect(sourceBody.data[0].import).not.toHaveProperty("metadata");

    const mismatchedCursor = await api(
      `/api/v1/projects/${PROJECT_ID}/analysis-runs?cursor=${encodeURIComponent(sourceBody.page.nextCursor)}`,
    );
    expect(mismatchedCursor.status).toBe(400);
    await expect(mismatchedCursor.json()).resolves.toMatchObject({ error: { code: "INVALID_CURSOR" } });

    const runBody = await (await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`)).json();
    expect(runBody.page).toMatchObject({ limit: 50, count: 1, hasMore: false, nextCursor: null });
    expect(runBody.data[0]).not.toHaveProperty("result");

    const segmentDetail = await api(`/api/v1/source-segments/${SEGMENT_ID}`);
    expect((await segmentDetail.json()).data).toMatchObject({ id: SEGMENT_ID, text: "금요일까지 시안을 검토합니다." });

    const invalidCursor = await api(`/api/v1/projects/${PROJECT_ID}/sources?cursor=not-a-cursor`);
    expect(invalidCursor.status).toBe(400);
    await expect(invalidCursor.json()).resolves.toMatchObject({ error: { code: "INVALID_CURSOR" } });
  });

  it("persists an immutable analysis run, v2 evidence, and sourceIds", async () => {
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "analysis-key-1" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      id: RUN_ID,
      status: "succeeded",
      schemaVersion: "2.0",
      sourceIds: [SOURCE_ID],
      provider: { mode: "local" },
    });
    expect(body.data.result.decisions[0].id).toMatch(/^decision_/);
    expect(body.data.result.decisions[0].evidence[0]).toMatchObject({
      sourceRecordId: SOURCE_ID,
      sourceTitle: "회의록",
    });
    expect(content).toContain(body.data.result.decisions[0].evidence[0].quote);
    expect(repository.startRun).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ idempotencyKey: "analysis-key-1", providerMode: "local" }),
    );
    const events = repository.appendRunStepEvent.mock.calls.map((call) => call[2]);
    expect(events.map((event) => `${event.step}:${event.status}`)).toEqual([
      "source_snapshot:started",
      "source_snapshot:succeeded",
      "provider_analysis:started",
      "provider_analysis:succeeded",
      "evidence_validation:started",
      "evidence_validation:succeeded",
      "result_persistence:started",
      "result_persistence:succeeded",
    ]);
    expect(events.find((event) => event.step === "source_snapshot" && event.status === "succeeded"))
      .toMatchObject({ sourceCount: 1, inputCharacters: Array.from(content).length });
    expect(events.find((event) => event.step === "evidence_validation" && event.status === "succeeded"))
      .toMatchObject({ validationOutcome: "passed", evidenceReferenceCount: expect.any(Number) });
    expect(JSON.stringify(events)).not.toContain(content);
    expect(JSON.stringify(events)).not.toMatch(/prompt|chain.?of.?thought|reasoning/i);
  });

  it("returns the succeeded run when the final observability event cannot be stored", async () => {
    repository.appendRunStepEvent.mockImplementation(async (_runId, _userId, values) => {
      if (values.eventKey === "result_persistence:succeeded") {
        throw new Error("event store unavailable");
      }
      return { id: `event-${values.sequence}`, ...values };
    });

    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "final-event-failure" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: RUN_ID, status: "succeeded" },
    });
    expect(repository.completeRun).toHaveBeenCalledWith(
      RUN_ID,
      USER_ID,
      expect.objectContaining({ status: "succeeded" }),
    );
  });

  it("persists provider usage and request correlation without exposing it publicly", async () => {
    const result = sampleAnalysis();
    Object.defineProperty(result, providerTelemetrySymbol, {
      value: {
        usage: { inputTokens: 321, outputTokens: 123, reasoningTokens: 45 },
        requestId: "req_safe_123",
      },
      enumerable: false,
    });
    analyze.mockResolvedValue(result);

    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "provider-usage-key" },
      body: { sourceIds: [SOURCE_ID], mode: "openai" },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(repository.completeRun).toHaveBeenCalledWith(
      RUN_ID,
      USER_ID,
      expect.objectContaining({
        input_tokens: 321,
        output_tokens: 123,
        reasoning_tokens: 45,
        provider_request_id: "req_safe_123",
      }),
    );
    expect(JSON.stringify(payload)).not.toContain("req_safe_123");
    expect(JSON.stringify(payload)).not.toContain("reasoningTokens");
  });

  it("returns an idempotently reused run without invoking the provider", async () => {
    repository.startRun.mockResolvedValue({ reused: true, run: runRow() });
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "analysis-key-2" },
      body: { sourceIds: [SOURCE_ID], provider: "local-heuristic" },
    });
    expect(response.status).toBe(200);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("maps transactional run admission outcomes to 429 with Retry-After", async () => {
    repository.startRun.mockResolvedValue({
      outcome: "already_running",
      reused: false,
      run: runRow(),
      retryAfterSeconds: 7,
    });
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "analysis-already-running" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_ALREADY_RUNNING", details: { retryAfter: 7 } },
    });
    expect(repository.completeRun).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("terminally cancels a newly created run when the client disconnects during start", async () => {
    let resolveStart;
    let notifyStart;
    const startEntered = new Promise((resolve) => {
      notifyStart = resolve;
    });
    repository.startRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
          notifyStart();
        }),
    );
    let notifyCompleted;
    const completed = new Promise((resolve) => {
      notifyCompleted = resolve;
    });
    repository.completeRun.mockImplementation(async (...args) => {
      notifyCompleted(args);
      return runRow({ status: args[2].status });
    });
    const pending = api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "abort-created-run" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);

    await startEntered;
    activeResponse.destroy();
    await rejected;
    resolveStart({ reused: false, run: runRow() });

    await expect(completed).resolves.toEqual([
      RUN_ID,
      USER_ID,
      expect.objectContaining({ status: "cancelled", error_code: "REQUEST_CANCELLED" }),
    ]);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("does not mutate an idempotently reused run after a start-time disconnect", async () => {
    let resolveStart;
    let notifyStart;
    const startEntered = new Promise((resolve) => {
      notifyStart = resolve;
    });
    repository.startRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
          notifyStart();
        }),
    );
    const pending = api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "abort-reused-run" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);

    await startEntered;
    activeResponse.destroy();
    await rejected;
    resolveStart({ reused: true, run: runRow() });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(repository.completeRun).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("records a sanitized failed run and does not expose provider details", async () => {
    analyze.mockRejectedValue(
      Object.assign(new Error("secret provider response"), { status: 502, code: "PROVIDER_FAILED" }),
    );
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "analysis-key-3" },
      body: { sourceIds: [SOURCE_ID], mode: "openai" },
    });
    expect(response.status).toBe(502);
    const failureUpdate = repository.completeRun.mock.calls.at(-1)[2];
    expect(failureUpdate).toMatchObject({
      status: "failed",
      error_code: "PROVIDER_FAILED",
      error_message: "분석을 완료하지 못했습니다.",
    });
    expect(JSON.stringify(failureUpdate)).not.toContain("secret provider response");
    const failedEvent = repository.appendRunStepEvent.mock.calls
      .map((call) => call[2])
      .find((event) => event.step === "provider_analysis" && event.status === "failed");
    expect(failedEvent).toMatchObject({ code: "PROVIDER_FAILED" });
    expect(JSON.stringify(failedEvent)).not.toContain("secret provider response");
  });

  it("terminalizes a new run when snapshot loading fails before provider execution", async () => {
    repository.getRunSnapshots.mockRejectedValue(
      new ApiError(503, "DATABASE_UNAVAILABLE", "database unavailable"),
    );
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "snapshot-failure" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });

    expect(response.status).toBe(503);
    expect(repository.completeRun).toHaveBeenCalledWith(
      RUN_ID,
      USER_ID,
      expect.objectContaining({ status: "failed", error_code: "DATABASE_UNAVAILABLE" }),
    );
    expect(analyze).not.toHaveBeenCalled();
  });

  it("lists/gets/deletes runs and creates/lists/revokes share links", async () => {
    const list = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`);
    expect((await list.json()).data[0].sourceIds).toEqual([SOURCE_ID]);
    expect((await (await api(`/api/v1/analysis-runs/${RUN_ID}`)).json()).data.id).toBe(RUN_ID);

    repository.getRun.mockResolvedValue(
      runRow({ status: "succeeded", result_jsonb: sampleAnalysis(), completed_at: now }),
    );
    const created = await api(`/api/v1/analysis-runs/${RUN_ID}/share-links`, {
      method: "POST",
      body: { expiresInDays: 7 },
    });
    const createdBody = await created.json();
    expect(createdBody.data.token).toBeTruthy();
    expect(createdBody.data.urlPath).toContain("/share#token=");
    expect(repository.createShareLink.mock.calls[0][2]).not.toBe(createdBody.data.token);

    expect((await (await api(`/api/v1/analysis-runs/${RUN_ID}/share-links`)).json()).data).toHaveLength(1);
    expect((await (await api(`/api/v1/share-links/${SHARE_ID}`, { method: "DELETE" })).json()).data.revokedAt).toBeTruthy();
    expect((await (await api(`/api/v1/analysis-runs/${RUN_ID}`, { method: "DELETE" })).json()).data.deleted).toBe(true);
  });

  it("lists safe workflow events and creates immutable idempotent annotations", async () => {
    await repository.appendRunStepEvent(RUN_ID, USER_ID, {
      sequence: 1,
      eventKey: "source_snapshot:succeeded",
      step: "source_snapshot",
      status: "succeeded",
      code: "SNAPSHOT_READY",
      durationMs: 4,
      sourceCount: 1,
      inputCharacters: 120,
    });

    const events = await api(`/api/v1/analysis-runs/${RUN_ID}/step-events`);
    expect(events.status).toBe(200);
    await expect(events.json()).resolves.toMatchObject({
      data: [
        {
          analysisRunId: RUN_ID,
          step: "source_snapshot",
          status: "succeeded",
          sourceCount: 1,
          inputCharacters: 120,
        },
      ],
    });

    const missingKey = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`, {
      method: "POST",
      body: {
        annotationType: "correction",
        targetType: "decision",
        targetId: "decision_public",
        body: "근거를 다시 확인해 주세요.",
      },
    });
    expect(missingKey.status).toBe(400);

    const rejectedReasoning = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`, {
      method: "POST",
      headers: { "Idempotency-Key": "annotation-reasoning" },
      body: {
        annotationType: "note",
        targetType: "run",
        body: "공개 가능한 피드백",
        reasoning: "저장하면 안 되는 내부 사고과정",
      },
    });
    expect(rejectedReasoning.status).toBe(400);
    expect(repository.createRunAnnotation).not.toHaveBeenCalled();

    const request = {
      method: "POST",
      headers: { "Idempotency-Key": "annotation-key-1" },
      body: {
        annotationType: "correction",
        targetType: "decision",
        targetId: "decision_public",
        body: "근거를 다시 확인해 주세요.",
      },
    };
    const created = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`, request);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        id: ANNOTATION_ID,
        analysisRunId: RUN_ID,
        annotationType: "correction",
        target: { type: "decision", id: "decision_public" },
      },
    });

    const reused = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`, request);
    expect(reused.status).toBe(200);
    const conflict = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`, {
      ...request,
      body: { ...request.body, body: "같은 키의 다른 내용" },
    });
    expect(conflict.status).toBe(409);

    const annotations = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`);
    expect((await annotations.json()).data).toHaveLength(1);
    const patchAttempt = await api(`/api/v1/analysis-runs/${RUN_ID}/annotations`, {
      method: "PATCH",
      body: {},
    });
    expect(patchAttempt.status).toBe(405);
  });

  it("resolves only a hashed public token to the sanitized shared run contract", async () => {
    const token = "a".repeat(43);
    const response = await fetch(`${baseUrl}/api/v1/shared/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.4" },
      body: JSON.stringify({ token }),
    });
    const body = await response.json();
    expect(body.data.projectTitle).toBe("테스트 프로젝트");
    expect(body.data).toMatchObject({
      projectTitle: "테스트 프로젝트",
      completedAt: now,
      expiresAt: "2026-07-18T00:00:00.000Z",
    });
    expect(body.data).not.toHaveProperty("run");
    expect(body.data.result.decisions[0]).not.toHaveProperty("sourceRecordId");
    expect(body.data.result.decisions[0].evidence[0]).not.toHaveProperty("sourceRecordId");
    expect(JSON.stringify(body.data)).not.toMatch(/provider|private-model|latencyMs|inputTokens|outputTokens/);
    expect(publicRepository.resolveShare).toHaveBeenCalledWith(sha256(token));
    expect(publicRepository.consumeRateLimit).toHaveBeenCalledWith(
      "share:ip:hour",
      expect.any(String),
      600,
      3600,
    );
    expect(publicRepository.consumeRateLimit).toHaveBeenCalledWith(
      "share:token-ip:hour",
      expect.any(String),
      60,
      3600,
    );
    expect(JSON.stringify(body)).not.toContain("owner_id");
  });

  it("changes the idempotency fingerprint when project or selected source semantics change", async () => {
    repository.startRun.mockResolvedValue({ reused: true, run: runRow() });
    await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "semantic-fingerprint" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });
    repository.getProject.mockResolvedValue(projectRow({ title: "바뀐 프로젝트" }));
    repository.getSources.mockResolvedValue([
      sourceRow({ title: "바뀐 기록", kind: "feedback", content_sha256: "f".repeat(64) }),
    ]);
    await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "semantic-fingerprint" },
      body: { sourceIds: [SOURCE_ID], mode: "local" },
    });
    expect(repository.startRun.mock.calls[0][1].requestFingerprint).not.toBe(
      repository.startRun.mock.calls[1][1].requestFingerprint,
    );
  });

  it("marks a newly created OpenAI run failed when a service-only global/IP limit denies it", async () => {
    repository.consumeOpenAIRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await api(`/api/v1/projects/${PROJECT_ID}/analysis-runs`, {
      method: "POST",
      headers: { "Idempotency-Key": "openai-rate-limited" },
      body: { sourceIds: [SOURCE_ID], mode: "openai" },
    });
    expect(response.status).toBe(429);
    expect(analyze).not.toHaveBeenCalled();
    expect(repository.completeRun).toHaveBeenCalledWith(
      RUN_ID,
      USER_ID,
      expect.objectContaining({ status: "failed", error_code: "OPENAI_RATE_LIMITED" }),
    );
  });

  it("accepts only sanitized, rate-limited public telemetry", async () => {
    const event = {
      name: "analysis_started",
      occurredAt: now,
      path: "/projects/:projectId",
      properties: { mode: "local", sourceCount: 2, inputCharacters: 120 },
    };
    const accepted = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.8" },
      body: JSON.stringify(event),
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toEqual({ data: { accepted: true } });
    expect(recordProductEvent).toHaveBeenCalledWith(event, expect.anything());

    const rejected = await fetch(`${baseUrl}/api/v1/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, properties: { ...event.properties, email: "private@example.com" } }),
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: "INVALID_TELEMETRY_EVENT" } });
  });

  it("feature-gates account export and deletion until database operations exist", async () => {
    const exported = await api("/api/v1/account/export");
    expect(exported.status).toBe(503);
    await expect(exported.json()).resolves.toMatchObject({ error: { code: "ACCOUNT_EXPORT_NOT_ENABLED" } });

    const unconfirmed = await api("/api/v1/account", { method: "DELETE" });
    expect(unconfirmed.status).toBe(400);
    const deleted = await api("/api/v1/account", {
      method: "DELETE",
      headers: { "X-Confirm-Account-Delete": "delete my account" },
    });
    expect(deleted.status).toBe(503);
    await expect(deleted.json()).resolves.toMatchObject({ error: { code: "ACCOUNT_DELETE_NOT_ENABLED" } });
  });

  it("rejects cross-origin mutations and malformed payloads", async () => {
    const crossOrigin = await api("/api/v1/projects", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      body: { title: "프로젝트", description: "" },
    });
    expect(crossOrigin.status).toBe(403);

    const spoofedForwardedHost = await api("/api/v1/projects", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Proto": "https",
      },
      body: { title: "프로젝트", description: "" },
    });
    expect(spoofedForwardedHost.status).toBe(403);

    const malformedOrigin = await api("/api/v1/projects", {
      method: "POST",
      headers: { Origin: "not a valid origin" },
      body: { title: "invalid origin", description: "" },
    });
    expect(malformedOrigin.status).toBe(403);

    const session = await createCookieSession();
    const missingCookieOrigin = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader(session.headers),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "cookie origin required", description: "" }),
    });
    expect(missingCookieOrigin.status).toBe(403);

    const originlessLegacyBearer = await api("/api/v1/projects", {
      method: "POST",
      body: { title: "legacy bearer", description: "" },
    });
    expect(originlessLegacyBearer.status).toBe(201);

    const invalid = await api(`/api/v1/projects/${PROJECT_ID}/sources`, {
      method: "POST",
      body: { kind: "unknown", title: "x", content: "x" },
    });
    expect(invalid.status).toBe(400);
  });
});

function createCookieSession(headers = {}, expiresIn = 3600) {
  return fetch(`${baseUrl}/api/v1/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      accessToken: "valid-token",
      refreshToken: "callback-refresh",
      expiresIn,
    }),
  });
}

async function startHandlerServer(handler) {
  const instance = createServer(async (req, res) => {
    req.moduBrainSignal = new AbortController().signal;
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    const handled = await handler(req, res, pathname);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const isolatedBaseUrl = `http://127.0.0.1:${instance.address().port}`;
  return {
    baseUrl: isolatedBaseUrl,
    close: () => new Promise((resolve, reject) => {
      instance.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined
    ? combined.split(/,(?=\s*(?:__Host-)?modu_brain_[a-z]+=)/i).map((value) => value.trim())
    : [];
}

function cookieHeader(headers) {
  return setCookieValues(headers)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function api(path, options = {}) {
  const headers = { Authorization: "Bearer valid-token", ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function createFakeRepository() {
  let project = projectRow();
  let source = sourceRow();
  let run = runRow();
  let share = shareRow();
  const snapshots = [snapshotRow()];
  const stepEvents = [];
  const annotations = [];
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn(async (_userId, values) => (project = projectRow(values))),
    getProject: vi.fn(async () => project),
    updateProject: vi.fn(async (_userId, _id, values) => (project = { ...project, ...values })),
    archiveProject: vi.fn(async () => (project = { ...project, archived_at: now })),
    restoreProject: vi.fn(async () => (project = { ...project, archived_at: null })),
    deleteProject: vi.fn(async () => undefined),
    listSources: vi.fn(async () => [source]),
    createSource: vi.fn(async (_userId, _projectId, values) => (source = sourceRow(values))),
    importSourceContext: vi.fn(async (_projectId, values) => {
      source = sourceRow({
        kind: values.kind,
        title: values.title,
        content: values.content,
        occurred_at: values.occurredAt,
      });
      return {
        source,
        import_id: IMPORT_ID,
        provider: values.provider,
        participants: values.participants,
        segment_count: values.segments.length,
        imported_at: now,
        metadata: values.metadata,
        duplicate: false,
      };
    }),
    getSource: vi.fn(async () => source),
    getSources: vi.fn(async () => [source]),
    updateSource: vi.fn(async (_userId, _id, values) => (source = { ...source, ...values })),
    archiveSource: vi.fn(async () => (source = { ...source, archived_at: now })),
    restoreSource: vi.fn(async () => (source = { ...source, archived_at: null })),
    listSourceSegments: vi.fn(async () => [
      {
        id: SEGMENT_ID,
        source_record_id: SOURCE_ID,
        ordinal: 0,
        speaker: "민지",
        text: "금요일까지 시안을 검토합니다.",
        occurred_at: now,
        external_id: "message-1",
        source_url: "https://teams.microsoft.com/l/message/message-1",
      },
    ]),
    getSourceSegment: vi.fn(async () => ({
      id: SEGMENT_ID,
      source_record_id: SOURCE_ID,
      ordinal: 0,
      speaker: "민지",
      text: "금요일까지 시안을 검토합니다.",
      occurred_at: now,
      external_id: "message-1",
      source_url: "https://teams.microsoft.com/l/message/message-1",
    })),
    listRuns: vi.fn(async () => [run]),
    getRun: vi.fn(async () => run),
    startRun: vi.fn(async () => ({ outcome: "created", reused: false, run })),
    getRunSnapshots: vi.fn(async () => snapshots),
    appendRunStepEvent: vi.fn(async (_runId, _userId, values) => {
      const event = stepEventRow({
        sequence: values.sequence,
        event_key: values.eventKey,
        step_name: values.step,
        status: values.status,
        validation_outcome: values.validationOutcome ?? null,
        code: values.code ?? null,
        duration_ms: values.durationMs ?? null,
        source_count: values.sourceCount ?? null,
        input_characters: values.inputCharacters ?? null,
        output_item_count: values.outputItemCount ?? null,
        evidence_reference_count: values.evidenceReferenceCount ?? null,
      });
      stepEvents.push(event);
      return event;
    }),
    listRunStepEvents: vi.fn(async () => stepEvents),
    listRunAnnotations: vi.fn(async () => annotations),
    createRunAnnotation: vi.fn(async (_runId, values) => {
      const existing = annotations.find(
        (annotation) => annotation.idempotency_key === values.idempotencyKey,
      );
      if (existing) {
        if (
          existing.annotation_type !== values.annotationType ||
          existing.target_type !== values.targetType ||
          existing.target_id !== values.targetId ||
          existing.body !== values.body
        ) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "conflicting feedback");
        }
        return { reused: true, annotation: existing };
      }
      const annotation = annotationRow({
        idempotency_key: values.idempotencyKey,
        annotation_type: values.annotationType,
        target_type: values.targetType,
        target_id: values.targetId,
        body: values.body,
      });
      annotations.push(annotation);
      return { reused: false, annotation };
    }),
    completeRun: vi.fn(async (_id, _userId, values) => (run = { ...run, ...values })),
    deleteRun: vi.fn(async () => undefined),
    listShareLinks: vi.fn(async () => [share]),
    createShareLink: vi.fn(async (_runId, _userId, _hash, expiresAt) => (share = shareRow({ expires_at: expiresAt }))),
    revokeShareLink: vi.fn(async () => (share = { ...share, revoked_at: now })),
    consumeOpenAIRateLimit: vi.fn(async () => true),
  };
}

function projectRow(values = {}) {
  return {
    id: PROJECT_ID,
    owner_id: USER_ID,
    title: "테스트 프로젝트",
    description: "",
    archived_at: null,
    created_at: now,
    updated_at: now,
    ...values,
  };
}

function sourceRow(values = {}) {
  const value = values.content || content;
  return {
    id: SOURCE_ID,
    project_id: PROJECT_ID,
    kind: "meeting",
    title: "회의록",
    content: value,
    content_sha256: values.content_sha256 || sha256(value),
    char_count: values.char_count ?? Array.from(value).length,
    occurred_at: now,
    archived_at: null,
    created_at: now,
    updated_at: now,
    ...values,
  };
}

function snapshotRow() {
  return {
    source_record_id: SOURCE_ID,
    source_title: "회의록",
    source_kind: "meeting",
    content_snapshot: content,
    content_sha256: sha256(content),
    char_count: content.length,
  };
}

function runRow(values = {}) {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    created_by: USER_ID,
    status: "running",
    schema_version: "2.0",
    provider_mode: "local",
    provider_model: null,
    result_jsonb: null,
    error_code: null,
    error_message: null,
    latency_ms: null,
    input_tokens: null,
    output_tokens: null,
    created_at: now,
    started_at: now,
    completed_at: null,
    analysis_run_sources: [{ source_record_id: SOURCE_ID }],
    ...values,
  };
}

function shareRow(values = {}) {
  return {
    id: SHARE_ID,
    analysis_run_id: RUN_ID,
    expires_at: "2026-07-18T00:00:00.000Z",
    revoked_at: null,
    created_at: now,
    ...values,
  };
}

function stepEventRow(values = {}) {
  return {
    id: STEP_EVENT_ID,
    analysis_run_id: RUN_ID,
    sequence: 1,
    event_key: "source_snapshot:started",
    step_name: "source_snapshot",
    status: "started",
    validation_outcome: null,
    code: null,
    duration_ms: null,
    source_count: null,
    input_characters: null,
    output_item_count: null,
    evidence_reference_count: null,
    created_at: now,
    ...values,
  };
}

function annotationRow(values = {}) {
  return {
    id: ANNOTATION_ID,
    analysis_run_id: RUN_ID,
    created_by: USER_ID,
    idempotency_key: "annotation-key-1",
    annotation_type: "correction",
    target_type: "decision",
    target_id: "decision_public",
    body: "결정 근거를 다시 확인해 주세요.",
    created_at: now,
    ...values,
  };
}

function sampleAnalysis() {
  return {
    projectTitle: "테스트 프로젝트",
    summary: { projectTitle: "테스트 프로젝트", overview: ["입력 흐름을 정리했다."], sourceLength: content.length, generatedAt: now },
    keyTerms: [{ term: "입력", meaning: "프로젝트 기록" }],
    decisions: [{ decision: "직접 입력 방식으로 시작하기로 결정했다.", reason: "빠른 검증", status: "confirmed" }],
    participants: [{ actor: "민지", role: "기획", focus: "입력 흐름", concern: "복잡성", question: "어떻게 단순화할까?" }],
    questions: [{ question: "공유 범위는?", reason: "검토 필요", ownerHint: "팀" }],
    knowledgeMap: { nodes: [{ id: "topic-main", label: "테스트", type: "topic", summary: "입력 흐름" }], links: [] },
    onboardingSummary: { items: ["요약"], currentDecisions: [], remainingQuestions: [], shareText: "공유" },
    participantAgents: { views: [{ actor: "민지", role: "기획", priority: "입력", interpretation: "단순화", evidence: ["민지는 입력 흐름을 단순하게 만들자고 제안했다."], risk: "복잡성" }], agreementPoints: [], tensionPoints: [], privacyNote: "기록만 사용" },
    provider: { mode: "mock", name: "local-heuristic", usedExternalModel: false },
  };
}
