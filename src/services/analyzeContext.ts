import type { ContextAnalysisResult } from "../types/context";
import type { ExternalContextProvider, ImportContextInput } from "../types/platform";

type ContextAnalysisErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class ContextAnalysisRequestError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(message: string, status = 0, code = "NETWORK_ERROR", details: unknown = null) {
    super(message);
    this.name = "ContextAnalysisRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type PublicImportedContextAnalysis = {
  import: {
    provider: ExternalContextProvider;
    title: string;
    content: string;
    participantCount: number;
    segmentCount: number;
  };
  result: ContextAnalysisResult;
};

export async function analyzeContext(
  projectTitle: string,
  inputText: string,
  options: { signal?: AbortSignal } = {},
): Promise<ContextAnalysisResult> {
  let response: Response;

  try {
    response = await fetch("/api/context-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectTitle,
        rawText: inputText,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;

    throw new ContextAnalysisRequestError(
      "분석 API에 연결할 수 없습니다. 개발 서버에서 /api/context-analysis가 실행 중인지 확인하세요.",
    );
  }

  const payload = (await parseJson(response)) as ContextAnalysisResult | ContextAnalysisErrorPayload;

  if (!response.ok) {
    const errorPayload = payload as ContextAnalysisErrorPayload;
    throw new ContextAnalysisRequestError(
      errorPayload.error?.message || "맥락 분석 요청에 실패했습니다.",
      response.status,
      errorPayload.error?.code || "ANALYSIS_REQUEST_FAILED",
      errorPayload.error?.details || null,
    );
  }

  if (!isContextAnalysisResult(payload)) {
    throw new ContextAnalysisRequestError(
      "분석 API 응답 형식이 올바르지 않습니다.",
      response.status,
      "INVALID_ANALYSIS_RESPONSE",
    );
  }

  return payload;
}

export async function analyzeImportedContext(
  input: ImportContextInput,
  options: { signal?: AbortSignal } = {},
): Promise<PublicImportedContextAnalysis> {
  let response: Response;

  try {
    response = await fetch("/api/context-analysis/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ContextAnalysisRequestError(
      "공개 가져오기 API에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  const payload = (await parseJson(response)) as PublicImportedContextAnalysis | ContextAnalysisErrorPayload;
  if (!response.ok) {
    const errorPayload = payload as ContextAnalysisErrorPayload;
    throw new ContextAnalysisRequestError(
      errorPayload.error?.message || "외부 맥락 가져오기에 실패했습니다.",
      response.status,
      errorPayload.error?.code || "CONTEXT_IMPORT_FAILED",
      errorPayload.error?.details || null,
    );
  }

  if (!isPublicImportedContextAnalysis(payload)) {
    throw new ContextAnalysisRequestError(
      "공개 가져오기 API 응답 형식이 올바르지 않습니다.",
      response.status,
      "INVALID_IMPORT_ANALYSIS_RESPONSE",
    );
  }

  return payload;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ContextAnalysisRequestError(
      "분석 API 응답을 JSON으로 읽을 수 없습니다.",
      response.status,
      "INVALID_JSON_RESPONSE",
    );
  }
}

export function isContextAnalysisResult(value: unknown): value is ContextAnalysisResult {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.projectTitle) &&
    isSummary(value.summary) &&
    isArrayOf(value.keyTerms, isKeyTerm) &&
    isArrayOf(value.decisions, isDecision) &&
    isArrayOf(value.participants, isPerspective) &&
    isArrayOf(value.questions, isQuestion) &&
    isKnowledgeMap(value.knowledgeMap) &&
    isOnboardingSummary(value.onboardingSummary) &&
    isParticipantAgentSynthesis(value.participantAgents) &&
    isProviderInfo(value.provider)
  );
}

function isPublicImportedContextAnalysis(value: unknown): value is PublicImportedContextAnalysis {
  if (!isRecord(value) || !isRecord(value.import)) return false;
  const imported = value.import;
  return (
    ["kakaotalk", "teams", "notion", "paste"].includes(String(imported.provider)) &&
    isNonEmptyString(imported.title) &&
    isNonEmptyString(imported.content) &&
    typeof imported.participantCount === "number" &&
    Number.isFinite(imported.participantCount) &&
    typeof imported.segmentCount === "number" &&
    Number.isFinite(imported.segmentCount) &&
    isContextAnalysisResult(value.result)
  );
}

function isSummary(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.projectTitle) &&
    isStringArray(value.overview) &&
    typeof value.sourceLength === "number" &&
    Number.isFinite(value.sourceLength) &&
    value.sourceLength >= 0 &&
    isNonEmptyString(value.generatedAt)
  );
}

function isKeyTerm(value: unknown) {
  return isRecord(value) && isNonEmptyString(value.term) && isNonEmptyString(value.meaning);
}

function isDecision(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.decision) &&
    isNonEmptyString(value.reason) &&
    ["confirmed", "tentative", "unclear"].includes(String(value.status))
  );
}

function isPerspective(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.actor) &&
    isNonEmptyString(value.role) &&
    isNonEmptyString(value.focus) &&
    isNonEmptyString(value.concern) &&
    isNonEmptyString(value.question)
  );
}

function isQuestion(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.question) &&
    isNonEmptyString(value.reason) &&
    isNonEmptyString(value.ownerHint)
  );
}

function isKnowledgeMap(value: unknown) {
  return (
    isRecord(value) &&
    isArrayOf(
      value.nodes,
      (node) =>
        isRecord(node) &&
        isNonEmptyString(node.id) &&
        isNonEmptyString(node.label) &&
        ["topic", "person", "role", "decision", "question"].includes(String(node.type)) &&
        isNonEmptyString(node.summary),
    ) &&
    isArrayOf(
      value.links,
      (link) =>
        isRecord(link) &&
        isNonEmptyString(link.from) &&
        isNonEmptyString(link.to) &&
        isNonEmptyString(link.relation),
    )
  );
}

function isOnboardingSummary(value: unknown) {
  return (
    isRecord(value) &&
    isStringArray(value.items) &&
    isStringArray(value.currentDecisions) &&
    isStringArray(value.remainingQuestions) &&
    isNonEmptyString(value.shareText)
  );
}

function isParticipantAgentSynthesis(value: unknown) {
  return (
    isRecord(value) &&
    isArrayOf(
      value.views,
      (view) =>
        isRecord(view) &&
        isNonEmptyString(view.actor) &&
        isNonEmptyString(view.role) &&
        isNonEmptyString(view.priority) &&
        isNonEmptyString(view.interpretation) &&
        isStringArray(view.evidence) &&
        isNonEmptyString(view.risk),
    ) &&
    isStringArray(value.agreementPoints) &&
    isStringArray(value.tensionPoints) &&
    isNonEmptyString(value.privacyNote)
  );
}

function isProviderInfo(value: unknown) {
  return (
    isRecord(value) &&
    ["mock", "llm"].includes(String(value.mode)) &&
    isNonEmptyString(value.name) &&
    typeof value.usedExternalModel === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isArrayOf(value: unknown, predicate: (item: unknown) => boolean) {
  return Array.isArray(value) && value.every(predicate);
}
