// @vitest-environment node

import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleContextAnalysisRequest } from "./contextAnalysisApi.mjs";

const validRawText = `민지는 입력 흐름을 단순하게 만들자고 제안했다. 서준은 결정 배경과 질문을 함께 보여줘야 한다고 말했다.
현우는 지식맵이 복잡해질 수 있다고 우려했다. 팀은 직접 입력 방식으로 MVP를 시작하기로 결정했다.
다음 회의에서는 개인정보 안내와 노드 수를 어떻게 정할지 검토하기로 했다.`;

let server;
let baseUrl;

beforeAll(async () => {
  server = createServer((request, response) => {
    void handleContextAnalysisRequest(request, response, {
      analysisOptions: { provider: "local-heuristic" },
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("context analysis HTTP API", () => {
  it("returns a structured local analysis with no-store JSON headers", async () => {
    const response = await request({
      method: "POST",
      body: JSON.stringify({ projectTitle: "API 검증", rawText: validRawText }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(body).toMatchObject({
      projectTitle: "API 검증",
      provider: { mode: "mock", name: "local-heuristic", usedExternalModel: false },
    });
    expect(body.participantAgents.views.length).toBeGreaterThan(0);
  });

  it("normalizes an account-free context export and analyzes it without persistence", async () => {
    const response = await requestImport({
      provider: "teams",
      title: "Teams 접근성 회의",
      text: JSON.stringify([
        {
          id: "message-1",
          createdDateTime: "2026-07-11T05:01:00Z",
          from: { user: { displayName: "민지" } },
          body: {
            contentType: "text",
            content: `${validRawText} 결정: 로그인하지 않은 사용자도 내보낸 기록을 바로 분석할 수 있게 한다.`,
          },
        },
      ]),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.import).toMatchObject({
      provider: "teams",
      title: "Teams 접근성 회의",
      participantCount: 1,
      segmentCount: 1,
    });
    expect(body.import.content).toContain("로그인하지 않은 사용자도");
    expect(body.result).toMatchObject({
      projectTitle: "Teams 접근성 회의",
      provider: { mode: "mock", name: "local-heuristic", usedExternalModel: false },
    });
  });

  it("rejects malformed public imports and cross-origin browser requests", async () => {
    const malformed = await requestImport({ provider: "notion", text: "{not json" });
    await expectError(malformed, 400, "MALFORMED_IMPORT_PAYLOAD");

    const crossOrigin = await fetch(`${baseUrl}/api/context-analysis/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: JSON.stringify({ provider: "paste", text: validRawText }),
    });
    await expectError(crossOrigin, 403, "INVALID_ORIGIN");

    const spoofedProxyOrigin = await fetch(`${baseUrl}/api/context-analysis/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
        "X-Forwarded-Host": "untrusted.example",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ provider: "paste", text: validRawText }),
    });
    await expectError(spoofedProxyOrigin, 403, "INVALID_ORIGIN");
  });

  it("returns Retry-After when the public import budget is exhausted", async () => {
    const limitedServer = createServer((request, response) => {
      void handleContextAnalysisRequest(request, response, {
        analysisOptions: { provider: "local-heuristic" },
        consumeImportRateLimit: () => false,
      });
    });
    await new Promise((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
    const address = limitedServer.address();

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/context-analysis/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "paste", text: validRawText }),
      });
      expect(response.headers.get("retry-after")).toBe("3600");
      await expectError(response, 429, "PUBLIC_IMPORT_RATE_LIMITED");
    } finally {
      await new Promise((resolve, reject) => {
        limitedServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("uses one persistent limiter contract for anonymous analysis and imports", async () => {
    const consumePublicRateLimit = vi.fn().mockResolvedValue(true);
    await withContextServer(
      {
        production: true,
        rateLimitIdentifierSecret: "test-secret",
        consumePublicRateLimit,
        analysisOptions: { provider: "local-heuristic" },
      },
      async (url) => {
        const analysis = await fetch(`${url}/api/context-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectTitle: "Limiter test", rawText: validRawText }),
        });
        const imported = await fetch(`${url}/api/context-analysis/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "paste", text: validRawText }),
        });
        expect(analysis.status).toBe(200);
        expect(imported.status).toBe(200);
      },
    );

    expect(consumePublicRateLimit).toHaveBeenCalledTimes(2);
    expect(consumePublicRateLimit.mock.calls.map(([call]) => call.scope)).toEqual([
      "public-analysis:hour",
      "public-import:hour",
    ]);
    for (const [call] of consumePublicRateLimit.mock.calls) {
      expect(call.subjectHash).toMatch(/^[a-f0-9]{64}$/);
      expect(call.subjectHash).not.toContain("127.0.0.1");
      expect(call.windowSeconds).toBe(3600);
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("fails closed in production when the persistent limiter is unavailable", async () => {
    await withContextServer(
      { production: true, rateLimitIdentifierSecret: "test-secret" },
      async (url) => {
        const response = await fetch(`${url}/api/context-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectTitle: "Limiter test", rawText: validRawText }),
        });
        await expectError(response, 503, "PUBLIC_RATE_LIMIT_BACKEND_UNAVAILABLE");
      },
    );
  });

  it("rate limits ordinary anonymous analysis with Retry-After", async () => {
    await withContextServer(
      {
        production: true,
        rateLimitIdentifierSecret: "test-secret",
        consumePublicRateLimit: () => false,
      },
      async (url) => {
        const response = await fetch(`${url}/api/context-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectTitle: "Limiter test", rawText: validRawText }),
        });
        expect(response.headers.get("retry-after")).toBe("3600");
        await expectError(response, 429, "PUBLIC_ANALYSIS_RATE_LIMITED");
      },
    );
  });

  it("cancels analysis at the total public request deadline", async () => {
    await withContextServer(
      {
        requestTimeoutMs: 15,
        analyze: async (_payload, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      },
      async (url) => {
        const response = await fetch(`${url}/api/context-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectTitle: "Deadline test", rawText: validRawText }),
        });
        await expectError(response, 504, "ANALYSIS_DEADLINE_EXCEEDED");
      },
    );
  });

  it("rejects malformed JSON with a stable 400 payload", async () => {
    const response = await request({ method: "POST", body: "{" });

    await expectError(response, 400, "INVALID_JSON");
  });

  it("rejects unsupported methods and advertises the allowed methods", async () => {
    const response = await request({ method: "GET" });

    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    await expectError(response, 405, "METHOD_NOT_ALLOWED");
  });

  it("handles OPTIONS without an analysis body", async () => {
    const response = await request({ method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("rejects non-JSON request content types", async () => {
    const response = await fetch(`${baseUrl}/api/context-analysis`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });

    await expectError(response, 415, "UNSUPPORTED_MEDIA_TYPE");
  });

  it("accepts 20,000 Korean characters even though UTF-8 exceeds 25KB", async () => {
    const response = await request({
      method: "POST",
      body: JSON.stringify({ projectTitle: "한글 경계", rawText: "가".repeat(20_000) }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.sourceLength).toBe(20_000);
  });

  it("returns RAW_TEXT_TOO_LONG for 25,001 ASCII characters without resetting the socket", async () => {
    const response = await request({
      method: "POST",
      body: JSON.stringify({ projectTitle: "문자 경계", rawText: "a".repeat(25_001) }),
    });

    await expectError(response, 413, "RAW_TEXT_TOO_LONG");
  });

  it("returns REQUEST_TOO_LARGE as JSON only when the complete body exceeds the transport cap", async () => {
    const response = await request({
      method: "POST",
      body: JSON.stringify({ projectTitle: "본문 경계", rawText: "a".repeat(120_000) }),
    });

    await expectError(response, 413, "REQUEST_TOO_LARGE");
  });

  it("aborts provider work when the requesting client disconnects", async () => {
    let resolveStarted;
    const started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    let providerSignal;
    let resolveProviderAborted;
    const providerAborted = new Promise((resolve) => {
      resolveProviderAborted = resolve;
    });
    const cancellationServer = createServer((request, response) => {
      void handleContextAnalysisRequest(request, response, {
        analyze: async (_payload, analysisOptions) => {
          providerSignal = analysisOptions.signal;
          resolveStarted();
          return new Promise((_resolve, reject) => {
            providerSignal.addEventListener(
              "abort",
              () => {
                resolveProviderAborted();
                reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
              },
              { once: true },
            );
          });
        },
      });
    });

    await new Promise((resolve) => cancellationServer.listen(0, "127.0.0.1", resolve));
    const address = cancellationServer.address();
    const controller = new AbortController();
    const pendingRequest = fetch(`http://127.0.0.1:${address.port}/api/context-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectTitle: "취소 검증", rawText: validRawText }),
      signal: controller.signal,
    });

    try {
      await started;
      controller.abort();
      await expect(pendingRequest).rejects.toMatchObject({ name: "AbortError" });
      await Promise.race([
        providerAborted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("provider abort was not propagated")), 1_000),
        ),
      ]);
      expect(providerSignal.aborted).toBe(true);
    } finally {
      await new Promise((resolve, reject) => {
        cancellationServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

function request({ method, body }) {
  return fetch(`${baseUrl}/api/context-analysis`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body,
  });
}

function requestImport(body) {
  return fetch(`${baseUrl}/api/context-analysis/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectError(response, status, code) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

async function withContextServer(options, callback) {
  const temporaryServer = createServer((request, response) => {
    void handleContextAnalysisRequest(request, response, options);
  });
  await new Promise((resolve) => temporaryServer.listen(0, "127.0.0.1", resolve));
  const address = temporaryServer.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      temporaryServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
