import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import {
  ContextAnalysisRequestError,
  analyzeImportedContext,
  isContextAnalysisResult,
  PUBLIC_CONTEXT_IMPORT_PATH,
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
    expect(url).toBe(PUBLIC_CONTEXT_IMPORT_PATH);
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

  it("preserves structured API error metadata", async () => {
    const details = { supportedProviders: ["paste"] };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(mockResponse({
      error: { code: "UNSUPPORTED_IMPORT_PROVIDER", message: "지원하지 않는 형식입니다.", details },
    }, { ok: false, status: 400 })));

    await expect(analyzeImportedContext({ provider: "paste", text: "회의 맥락" }))
      .rejects.toMatchObject({
        name: "ContextAnalysisRequestError",
        status: 400,
        code: "UNSUPPORTED_IMPORT_PROVIDER",
        details,
      });
  });

  it("distinguishes invalid JSON responses from API errors", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(mockResponse(undefined, {
      status: 502,
      jsonError: new SyntaxError("Unexpected token"),
    })));

    await expect(analyzeImportedContext({ provider: "paste", text: "회의 맥락" }))
      .rejects.toMatchObject({ status: 502, code: "INVALID_JSON_RESPONSE" });
  });

  it("maps fetch failures to a user-facing network error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")));

    await expect(analyzeImportedContext({ provider: "paste", text: "회의 맥락" })).rejects.toEqual(
      expect.objectContaining<Partial<ContextAnalysisRequestError>>({
        status: 0,
        code: "NETWORK_ERROR",
      }),
    );
  });

  it("preserves an intentional abort instead of reporting a network outage", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw abortError;
    }));

    await expect(analyzeImportedContext(
      { provider: "paste", text: "회의 맥락" },
      { signal: controller.signal },
    )).rejects.toBe(abortError);
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
