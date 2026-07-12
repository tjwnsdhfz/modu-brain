// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContextAnalysisApiError,
  analyzeProjectContext,
  validateContextAnalysisRequest,
} from "./contextAnalysisCore.mjs";

const validRawText = `민지는 첫 화면에서 사용자가 입력 방법을 바로 이해해야 한다고 말했다.
서준은 단순 요약보다 결정 배경과 미결 질문을 연결해야 한다고 제안했다.
현우는 지식맵이 복잡해질 수 있다고 우려했다.
팀은 직접 붙여넣는 방식으로 MVP를 시작하기로 결정했다.
다음 회의에서는 노드 수를 어떻게 제한할지 함께 확인하기로 했다.`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("validateContextAnalysisRequest", () => {
  it.each([null, [], "문자열", 1])("rejects a non-object payload: %j", (payload) => {
    expectApiError(() => validateContextAnalysisRequest(payload), {
      status: 400,
      code: "INVALID_JSON",
    });
  });

  it("trims input and accepts the documented minimum lengths", () => {
    const result = validateContextAnalysisRequest({
      projectTitle: "  가나  ",
      rawText: `  ${"가".repeat(120)}  `,
    });

    expect(result).toEqual({ projectTitle: "가나", rawText: "가".repeat(120) });
  });

  it("enforces title and raw-text boundaries with stable error codes", () => {
    expectApiError(
      () => validateContextAnalysisRequest({ projectTitle: "가", rawText: "가".repeat(120) }),
      { status: 400, code: "INVALID_PROJECT_TITLE" },
    );
    expect(
      validateContextAnalysisRequest({ projectTitle: "가".repeat(120), rawText: "가".repeat(120) }),
    ).toEqual({ projectTitle: "가".repeat(120), rawText: "가".repeat(120) });
    expectApiError(
      () =>
        validateContextAnalysisRequest({
          projectTitle: "가".repeat(121),
          rawText: "가".repeat(120),
        }),
      { status: 400, code: "INVALID_PROJECT_TITLE" },
    );
    expectApiError(
      () => validateContextAnalysisRequest({ projectTitle: "가나", rawText: "가".repeat(119) }),
      { status: 400, code: "RAW_TEXT_TOO_SHORT" },
    );

    expect(
      validateContextAnalysisRequest({ projectTitle: "가나", rawText: "가".repeat(20_000) }),
    ).toEqual({ projectTitle: "가나", rawText: "가".repeat(20_000) });

    expectApiError(
      () => validateContextAnalysisRequest({ projectTitle: "가나", rawText: "가".repeat(20_001) }),
      { status: 413, code: "RAW_TEXT_TOO_LONG" },
    );
  });
});

describe("analyzeProjectContext", () => {
  it("uses Unicode code points for limits and reported source length", async () => {
    const rawText = "😀".repeat(120);
    const result = await analyzeProjectContext(
      { projectTitle: "🧠".repeat(61), rawText },
      { provider: "local-heuristic", maxRawTextLength: 120 },
    );

    expect(result.summary.sourceLength).toBe(120);
  });

  it("uses the local provider and returns a connected, evidence-based result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));

    const result = await analyzeProjectContext(
      { projectTitle: "검증 프로젝트", rawText: validRawText },
      { provider: "local-heuristic" },
    );

    expect(result.provider).toEqual({
      mode: "mock",
      name: "local-heuristic",
      usedExternalModel: false,
    });
    expect(result.summary).toMatchObject({
      projectTitle: "검증 프로젝트",
      sourceLength: validRawText.length,
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    expect(result.participantAgents.privacyNote).toContain("성격을 추정하지 않고");
    expect(result.participantAgents.views.length).toBeGreaterThan(0);
    expect(result.participants.map((participant) => participant.actor)).toEqual([
      "민지",
      "서준",
      "현우",
    ]);
    expect(result.decisions).toHaveLength(2);

    for (const view of result.participantAgents.views) {
      expect(view.evidence.length).toBeGreaterThan(0);
      for (const evidence of view.evidence) {
        expect(validRawText).toContain(evidence);
      }
    }

    const nodeIds = new Set(result.knowledgeMap.nodes.map((node) => node.id));
    expect(nodeIds.has("topic-main")).toBe(true);
    for (const link of result.knowledgeMap.links) {
      expect(nodeIds.has(link.from)).toBe(true);
      expect(nodeIds.has(link.to)).toBe(true);
    }
  });

  it("uses the local provider by default without requiring an API key", async () => {
    vi.stubEnv("MODU_BRAIN_ANALYSIS_PROVIDER", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await analyzeProjectContext({
      projectTitle: "로컬 분석",
      rawText: validRawText,
    });

    expect(result.provider.name).toBe("local-heuristic");
    expect(result.provider.usedExternalModel).toBe(false);
  });

  it("returns honest empty arrays when the record contains no supported claims", async () => {
    const neutralRawText = "참고 자료에는 프로젝트 배경 설명과 현재 상황이 담겨 있다. ".repeat(5);
    const result = await analyzeProjectContext(
      { projectTitle: "배경 기록", rawText: neutralRawText },
      { provider: "local-heuristic" },
    );

    expect(result.participants).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.keyTerms).toEqual([]);
    expect(result.participantAgents.views).toEqual([]);
    expect(result.participantAgents.agreementPoints).toEqual([]);
    expect(result.knowledgeMap.nodes).toHaveLength(1);
    expect(result.knowledgeMap.links).toEqual([]);
  });

  it("uses a natural Korean topic particle in onboarding copy", async () => {
    const result = await analyzeProjectContext(
      { projectTitle: "캠퍼스 기획", rawText: validRawText },
      { provider: "local-heuristic" },
    );

    expect(result.onboardingSummary.items[0]).toMatch(/^캠퍼스 기획은 /);
    expect(result.onboardingSummary.items[3]).toContain("항목을 먼저 확인해야 합니다.");
  });

  it("rejects unsupported providers explicitly", async () => {
    await expect(
      analyzeProjectContext(
        { projectTitle: "검증 프로젝트", rawText: validRawText },
        { provider: "unknown-provider" },
      ),
    ).rejects.toMatchObject({ status: 503, code: "PROVIDER_NOT_SUPPORTED" });
  });

  it("reports missing OpenAI configuration instead of silently falling back", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("MODU_BRAIN_OPENAI_MODEL", "");

    await expect(
      analyzeProjectContext(
        { projectTitle: "검증 프로젝트", rawText: validRawText },
        { provider: "openai", apiKey: "", model: "" },
      ),
    ).rejects.toMatchObject({ status: 503, code: "PROVIDER_CONFIGURATION_ERROR" });
  });
});

function expectApiError(run, expected) {
  let caught;

  try {
    run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ContextAnalysisApiError);
  expect(caught).toMatchObject(expected);
}
