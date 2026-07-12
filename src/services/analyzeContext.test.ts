import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import {
  ContextAnalysisRequestError,
  analyzeContext,
  analyzeImportedContext,
  isContextAnalysisResult,
} from "./analyzeContext";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isContextAnalysisResult", () => {
  it("accepts the complete application result contract", () => {
    expect(isContextAnalysisResult(sampleAnalysis)).toBe(true);
  });

  it.each([
    { ...sampleAnalysis, provider: undefined },
    { ...sampleAnalysis, provider: { mode: "external", name: "provider", usedExternalModel: true } },
    { ...sampleAnalysis, provider: { mode: "llm", name: " ", usedExternalModel: true } },
    { ...sampleAnalysis, provider: { mode: "llm", name: "provider", usedExternalModel: "yes" } },
  ])("rejects missing or malformed provider metadata", (result) => {
    expect(isContextAnalysisResult(result)).toBe(false);
  });

  it("rejects malformed nested response values", () => {
    expect(
      isContextAnalysisResult({
        ...sampleAnalysis,
        knowledgeMap: {
          ...sampleAnalysis.knowledgeMap,
          nodes: [{ ...sampleAnalysis.knowledgeMap.nodes[0], type: "unsupported" }],
        },
      }),
    ).toBe(false);
  });
});

describe("analyzeContext", () => {
  it("posts the expected JSON contract and returns a valid result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(mockResponse(sampleAnalysis));
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      analyzeContext("프로젝트", "기록 본문", { signal: controller.signal }),
    ).resolves.toEqual(sampleAnalysis);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/context-analysis");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      projectTitle: "프로젝트",
      rawText: "기록 본문",
    });
  });

  it("preserves structured API error metadata", async () => {
    const details = { minLength: 120, currentLength: 10 };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        mockResponse(
          {
            error: {
              code: "RAW_TEXT_TOO_SHORT",
              message: "120자 이상 입력하세요.",
              details,
            },
          },
          { ok: false, status: 400 },
        ),
      ),
    );

    await expect(analyzeContext("프로젝트", "짧은 기록")).rejects.toMatchObject({
      name: "ContextAnalysisRequestError",
      status: 400,
      code: "RAW_TEXT_TOO_SHORT",
      details,
    });
  });

  it("rejects a successful response that omits provider metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(mockResponse({ ...sampleAnalysis, provider: undefined })),
    );

    await expect(analyzeContext("프로젝트", "기록 본문")).rejects.toMatchObject({
      status: 200,
      code: "INVALID_ANALYSIS_RESPONSE",
    });
  });

  it("distinguishes invalid JSON responses from API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        mockResponse(undefined, {
          status: 502,
          jsonError: new SyntaxError("Unexpected token"),
        }),
      ),
    );

    await expect(analyzeContext("프로젝트", "기록 본문")).rejects.toMatchObject({
      status: 502,
      code: "INVALID_JSON_RESPONSE",
    });
  });

  it("maps fetch failures to a user-facing network error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")));

    await expect(analyzeContext("프로젝트", "기록 본문")).rejects.toEqual(
      expect.objectContaining<Partial<ContextAnalysisRequestError>>({
        status: 0,
        code: "NETWORK_ERROR",
      }),
    );
  });

  it("preserves an intentional abort instead of reporting a network outage", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => {
        controller.abort();
        throw abortError;
      }),
    );

    await expect(
      analyzeContext("프로젝트", "기록 본문", { signal: controller.signal }),
    ).rejects.toBe(abortError);
  });
});

describe("analyzeImportedContext", () => {
  it("posts an account-free export and returns normalized context with its analysis", async () => {
    const payload = {
      import: {
        provider: "notion" as const,
        title: "Notion 회의",
        content: "정규화한 회의 맥락입니다.",
        participantCount: 2,
        segmentCount: 3,
      },
      result: sampleAnalysis,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(mockResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeImportedContext({
      provider: "notion",
      title: "Notion 회의",
      text: "{\"blocks\":[]}",
    })).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/context-analysis/import");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: "notion",
      title: "Notion 회의",
      text: "{\"blocks\":[]}",
    });
  });

  it("rejects malformed successful import responses", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(mockResponse({
      import: { provider: "notion", title: "회의", content: "본문" },
      result: sampleAnalysis,
    })));

    await expect(analyzeImportedContext({ provider: "paste", text: "회의 맥락" }))
      .rejects.toMatchObject({ code: "INVALID_IMPORT_ANALYSIS_RESPONSE" });
  });
});

function mockResponse(
  payload: unknown,
  options: { ok?: boolean; status?: number; jsonError?: Error } = {},
) {
  const { ok = true, status = 200, jsonError } = options;

  return {
    ok,
    status,
    json: jsonError
      ? vi.fn().mockRejectedValue(jsonError)
      : vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}
