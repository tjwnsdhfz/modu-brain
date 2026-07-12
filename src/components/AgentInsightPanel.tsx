import { useMemo } from "react";
import type { ContextAnalysisResultV2, EvidenceRef } from "../types/context";
import { deriveAgentInsights } from "../utils/agentInsights";

type AgentInsightPanelProps = {
  latest: ContextAnalysisResultV2;
  previous?: ContextAnalysisResultV2;
  onOpenEvidence?: (evidence: EvidenceRef[]) => void;
};

const lifecycleLabels = {
  new: "새 결정",
  changed: "변경됨",
  stable: "유지됨",
  resolved: "이전 실행에만 있음",
} as const;

function AgentInsightPanel({ latest, previous, onOpenEvidence }: AgentInsightPanelProps) {
  const insights = useMemo(() => deriveAgentInsights(previous, latest), [latest, previous]);
  const assessedItems = [
    ...latest.decisions,
    ...latest.questions,
    ...latest.participants,
    ...latest.keyTerms,
  ].filter((item) => item.agentConfidence);
  const averageConfidence = assessedItems.length > 0
    ? assessedItems.reduce((sum, item) => sum + (item.agentConfidence?.score ?? 0), 0) / assessedItems.length
    : 0;

  return (
    <section className="agent-insight-panel workspace-card" aria-labelledby="agent-insight-title">
      <header className="agent-insight-heading">
        <div>
          <p className="section-kicker">Agent review</p>
          <h2 id="agent-insight-title">결정 변화와 검토 신호</h2>
          <p>최근 두 성공 실행의 구조화 결과와 정확히 일치한 원문 근거만 사용합니다. 내부 프롬프트나 사고 과정은 표시하지 않습니다.</p>
        </div>
        <span className={`agent-confidence-level ${confidenceLevel(averageConfidence)}`}>
          근거 신뢰도 {assessedItems.length > 0 ? `${Math.round(averageConfidence * 100)}%` : "계산 전"}
        </span>
      </header>

      <dl className="agent-insight-stats" aria-label="결정 변화 요약">
        {Object.entries(lifecycleLabels).map(([status, label]) => (
          <div key={status}>
            <dt>{label}</dt>
            <dd>{insights.counts[status as keyof typeof insights.counts].toLocaleString("ko-KR")}</dd>
          </div>
        ))}
      </dl>

      {!previous && (
        <p className="agent-insight-note">첫 성공 분석을 기준선으로 표시했습니다. 다음 성공 분석부터 변경과 유지 상태를 비교합니다.</p>
      )}

      <div className="agent-insight-grid">
        <section aria-labelledby="decision-lifecycle-title">
          <h3 id="decision-lifecycle-title">결정 생명주기</h3>
          {insights.decisionLifecycle.length > 0 ? (
            <ul className="agent-lifecycle-list">
              {insights.decisionLifecycle.map((item) => (
                <li key={`${item.status}-${item.id}`}>
                  <span className={`agent-lifecycle-status ${item.status}`}>{lifecycleLabels[item.status]}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{lifecycleDescription(item.status, item.changedFields)}</p>
                    {item.agentConfidence && <small>{item.agentConfidence.rationale}</small>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="agent-insight-empty">비교할 결정이 없습니다.</p>}
        </section>

        <section aria-labelledby="contradiction-title">
          <h3 id="contradiction-title">상충 가능성 검토</h3>
          {insights.contradictions.length > 0 ? (
            <ul className="agent-contradiction-list">
              {insights.contradictions.map((candidate) => (
                <li key={candidate.id}>
                  <span>검토 후보 · {Math.round(candidate.confidence * 100)}%</span>
                  <strong>{candidate.leftLabel}</strong>
                  <strong>{candidate.rightLabel}</strong>
                  <p>{candidate.reason}</p>
                  {candidate.evidence.length > 0 && onOpenEvidence && (
                    <button className="evidence-button" type="button" onClick={() => onOpenEvidence(candidate.evidence)}>
                      원문 근거 {candidate.evidence.length}개 확인
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-insight-empty">현재 결정 문장 사이에서 명시적인 상충 표현을 찾지 못했습니다. 이는 모순이 없다는 보증이 아닙니다.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function confidenceLevel(score: number) {
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function lifecycleDescription(
  status: keyof typeof lifecycleLabels,
  changedFields: Array<"decision" | "reason" | "status">,
) {
  if (status === "new") return "이번 실행에서 처음 관찰했습니다.";
  if (status === "resolved") return "이번 실행에는 나타나지 않습니다. 해결·철회 여부는 원문에서 확인해 주세요.";
  if (status === "stable") return "직전 성공 실행과 같은 결정으로 연결했습니다.";
  const labels = { decision: "결정 문장", reason: "배경", status: "확정 상태" } as const;
  return `직전 실행과 달라진 항목: ${changedFields.map((field) => labels[field]).join(", ") || "내용"}.`;
}

export default AgentInsightPanel;
