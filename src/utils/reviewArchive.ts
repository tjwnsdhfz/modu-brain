import type { ContextAnalysisResult, EvidenceRef } from "../types/context";
import type { ContextImportInput } from "../components/ContextImportPanel";
import { isContextAnalysisResult } from "../services/analyzeContext";

export type ReviewArchive = {
  format: "modu-review";
  version: 1;
  sample: boolean;
  input: ContextImportInput;
  result: ContextAnalysisResult;
  report: string;
};
const clean = (text: string) => text.replace(/\r/g, "").replace(/\n/g, " ");
const evidence = (refs?: Array<EvidenceRef | string>) =>
  (refs ?? [])
    .map((ref) =>
      typeof ref === "string"
        ? `> ${clean(ref)}\n> 출처: 입력 기록 발췌 (개별 원문 링크 없음)`
        : `> ${clean(ref.quote)}\n> 출처: ${clean(ref.sourceTitle)} (${clean(ref.sourceRecordId)})`,
    )
    .join("\n\n");
export function reviewMarkdown(result: ContextAnalysisResult, sample = false) {
  return [
    `# ${clean(result.projectTitle)}`,
    `${sample ? "합성 샘플" : "사용자 입력의 분석 초안"} · 자동 추출 결과는 원문과 대조해 검토하세요.`,
    `분석 방식: ${clean(result.provider.name)} · 생성 시각: ${clean(result.summary.generatedAt)}`,
    "## 요약",
    ...result.summary.overview.map((text) => `- ${clean(text)}`),
    "## 관점",
    ...result.participants.map(
      (item) =>
        `### ${clean(item.actor)} · ${clean(item.role)}\n${clean(item.focus)}\n\n우려: ${clean(item.concern)}\n\n${evidence(item.evidence)}`,
    ),
    "## 결정",
    ...result.decisions.map(
      (item) =>
        `### ${clean(item.decision)}\n상태: ${item.status}\n\n${clean(item.reason)}\n\n${evidence(item.evidence)}`,
    ),
    "## 남은 질문",
    ...result.questions.map(
      (item) =>
        `### ${clean(item.question)}\n${clean(item.reason)}\n\n담당 후보: ${clean(item.ownerHint)}\n\n${evidence(item.evidence)}`,
    ),
    "## 검토 메모",
    "원문과 다른 추출, 추가로 확인할 내용, 다음 행동을 여기에 적으세요.",
  ].join("\n\n");
}
function validMetadata(result: ContextAnalysisResult) {
  const refs = (value: unknown) =>
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (ref) =>
          typeof ref === "string" ||
          (ref &&
            typeof ref === "object" &&
            ["sourceRecordId", "sourceTitle", "quote"].every(
              (key) => typeof ref[key] === "string",
            )),
      ));
  const items = [
    ...result.decisions,
    ...result.questions,
    ...result.participants,
    ...result.keyTerms,
    ...result.knowledgeMap.nodes,
  ];
  if (!items.every((item) => refs(item.evidence))) return false;
  if (!result.participantAgents.views.every((item) => refs(item.evidenceRefs)))
    return false;
  return [...items, ...result.participantAgents.views].every((item) => {
    if (item.id !== undefined && typeof item.id !== "string") return false;
    const confidence = item.agentConfidence;
    if (
      confidence !== undefined &&
      (!confidence ||
        typeof confidence !== "object" ||
        !["low", "medium", "high"].includes(confidence.level) ||
        typeof confidence.rationale !== "string" ||
        ![
          confidence.score,
          confidence.evidenceCount,
          confidence.sourceCount,
        ].every((n) => typeof n === "number" && Number.isFinite(n)))
    )
      return false;
    return true;
  });
}
export function parseReviewArchive(text: string): ReviewArchive {
  if (new TextEncoder().encode(text).length > 1024 * 1024)
    throw new Error("검토 백업은 1MB 이하로 준비해 주세요.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "JSON 백업을 읽지 못했습니다. 원본 파일을 다시 선택해 주세요.",
    );
  }
  const file = value as Partial<ReviewArchive> | null;
  if (
    !file ||
    file.format !== "modu-review" ||
    file.version !== 1 ||
    typeof file.sample !== "boolean" ||
    typeof file.report !== "string" ||
    file.report.length > 100000 ||
    !file.input ||
    typeof file.input.text !== "string" ||
    !file.input.text.trim() ||
    new TextEncoder().encode(file.input.text).length > 256 * 1024 ||
    !["paste", "kakaotalk", "teams", "notion"].includes(file.input.provider) ||
    (file.input.title !== undefined && typeof file.input.title !== "string") ||
    !isContextAnalysisResult(file.result) ||
    !validMetadata(file.result)
  )
    throw new Error(
      "지원하는 Modu Brain 검토 백업 v1이 아닙니다. 기존 입력과 결과는 유지됩니다.",
    );
  return {
    format: "modu-review",
    version: 1,
    sample: file.sample,
    input: {
      provider: file.input.provider,
      title: file.input.title,
      text: file.input.text,
    },
    result: file.result,
    report: file.report,
  };
}
export function serializeReviewArchive(
  input: ContextImportInput,
  result: ContextAnalysisResult,
  report: string,
  sample: boolean,
) {
  const text = JSON.stringify(
    { format: "modu-review", version: 1, input, result, report, sample },
    null,
    2,
  );
  parseReviewArchive(text);
  return text;
}
export function downloadReview(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
