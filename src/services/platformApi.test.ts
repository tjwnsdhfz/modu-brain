import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_EVENT, PlatformApiError, platformApi } from "./platformApi";
import { COOKIE_SESSION_SENTINEL } from "./auth";

afterEach(() => vi.unstubAllGlobals());

describe("platformApi", () => {
  it("loads authenticated server capabilities", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: { openaiEnabled: false } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(platformApi.getCapabilities("access-token")).resolves.toEqual({
      openaiEnabled: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/capabilities",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("unwraps the canonical data envelope and sends the Supabase bearer token", async () => {
    const projects = [{ id: "p1", title: "프로젝트" }];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: projects }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(platformApi.listProjects("access-token")).resolves.toEqual(projects);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects", expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
    }));
  });

  it("uses same-origin cookies for the BFF sentinel without an Authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await platformApi.listProjects(COOKIE_SESSION_SENTINEL);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("lists the archive and restores projects and sources through explicit routes", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ data: { id: "p1", archivedAt: null } }))
      .mockResolvedValueOnce(response({ data: { id: "s1", archivedAt: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await platformApi.listProjects(COOKIE_SESSION_SENTINEL, { archived: true });
    if (!platformApi.restoreProject || !platformApi.restoreSource) {
      throw new Error("restore APIs unavailable");
    }
    await platformApi.restoreProject(COOKIE_SESSION_SENTINEL, "p1");
    await platformApi.restoreSource(COOKIE_SESSION_SENTINEL, "s1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/projects?archived=true");
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/v1/projects/p1/restore",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    ]);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/sources/s1/restore");
  });

  it("sends analysis mode, selected sources, abort signal, and idempotency key", async () => {
    const run = { id: "r1", status: "succeeded" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: run }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await platformApi.createAnalysisRun(
      "access-token",
      "p1",
      { sourceIds: ["s1", "s2"], mode: "local" },
      "idem-1",
      controller.signal,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/projects/p1/analysis-runs");
    expect(init).toMatchObject({ method: "POST", signal: controller.signal });
    expect(init?.headers).toEqual(expect.objectContaining({ "Idempotency-Key": "idem-1" }));
    expect(JSON.parse(String(init?.body))).toEqual({ sourceIds: ["s1", "s2"], mode: "local" });
  });

  it("sends exported context to the project import endpoint", async () => {
    const imported = { source: { id: "s1" }, importId: "i1", provider: "kakaotalk" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: imported }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await platformApi.importContext("access-token", "p1", {
      provider: "kakaotalk",
      title: "기획 회의",
      text: "2026년 7월 11일, 서준 : 시안을 검토합니다.",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/projects/p1/imports");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      provider: "kakaotalk",
      title: "기획 회의",
    });
  });

  it("loads exact external source segments for evidence backlinks", async () => {
    const segments = [{ id: "segment-1", sourceUrl: "https://example.test/message/1" }];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: segments }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(platformApi.listSourceSegments("access-token", "source-1")).resolves.toEqual(
      segments,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sources/source-1/segments?limit=50",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("loads the immutable execution trace for an analysis run", async () => {
    const events = [{ id: "event-1", step: "source_snapshot", status: "succeeded" }];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: events }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(platformApi.listAnalysisRunStepEvents("access-token", "run-1")).resolves.toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/analysis-runs/run-1/step-events",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("creates a targeted annotation with an idempotency key", async () => {
    const annotation = { id: "annotation-1", target: { type: "decision", id: "decision-1" } };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: annotation }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await platformApi.createAnalysisRunAnnotation(
      "access-token",
      "run-1",
      {
        annotationType: "correction",
        targetType: "decision",
        targetId: "decision-1",
        body: "제안으로 정정합니다.",
      },
      "annotation-idempotency-key",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/analysis-runs/run-1/annotations");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer access-token",
      "Idempotency-Key": "annotation-idempotency-key",
    }));
    expect(JSON.parse(String(init?.body))).toMatchObject({
      annotationType: "correction",
      targetType: "decision",
      targetId: "decision-1",
    });
  });

  it("preserves structured errors", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도하세요.", details: { retryAfter: 60 } } }, 429, { "Retry-After": "90" })));
    await expect(platformApi.listProjects("token")).rejects.toEqual(expect.objectContaining<Partial<PlatformApiError>>({ status: 429, code: "RATE_LIMITED", details: { retryAfter: 60 }, retryAfterSeconds: 90 }));
  });

  it("notifies the app when a cookie-backed API session expires", async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, listener);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({
      error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다." },
    }, 401)));

    await expect(platformApi.listProjects(COOKIE_SESSION_SENTINEL)).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
  });

  it("reads cursor metadata, follows pages for legacy list calls, and lazy-loads source detail", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        data: [{ id: "s1", title: "요약 1" }],
        page: { limit: 50, count: 1, hasMore: true, nextCursor: "cursor-2" },
      }))
      .mockResolvedValueOnce(response({
        data: [{ id: "s2", title: "요약 2" }],
        page: { limit: 50, count: 1, hasMore: false, nextCursor: null },
      }))
      .mockResolvedValueOnce(response({ data: { id: "s1", title: "요약 1", content: "원문" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(platformApi.listSources("token", "p1")).resolves.toHaveLength(2);
    if (!platformApi.getSource) throw new Error("getSource unavailable");
    await expect(platformApi.getSource("token", "s1")).resolves.toMatchObject({ content: "원문" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/projects/p1/sources?limit=50");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/projects/p1/sources?limit=50&cursor=cursor-2");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/sources/s1");
  });

  it("sends the explicit account-delete confirmation contract", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { deleted: true } }));
    vi.stubGlobal("fetch", fetchMock);
    if (!platformApi.deleteAccount) throw new Error("deleteAccount unavailable");
    await platformApi.deleteAccount("token", "delete my account");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/account",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-Confirm-Account-Delete": "delete my account" }),
      }),
    );
  });

  it("requires the explicit permanent-delete confirmation header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 204, json: vi.fn() } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    await platformApi.deleteProject("token", "p1", true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/p1?permanent=true",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Confirm-Permanent-Delete": "delete" }) }),
    );
  });

  it("resolves a public share token without an authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: {
          projectTitle: "공유",
          result: {},
          completedAt: "2026-07-11T00:00:00Z",
          expiresAt: "2026-07-18T00:00:00Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await platformApi.resolveSharedAnalysis("plain-token");
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(init?.body))).toEqual({ token: "plain-token" });
  });
});

function response(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}
