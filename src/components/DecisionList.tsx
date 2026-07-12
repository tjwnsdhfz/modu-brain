import type { ContextAnalysisResult, EvidenceRef } from "../types/context";
import ContextSectionHeader from "./ContextSectionHeader";
import EvidenceButton from "./EvidenceButton";
import EvidenceCoverageBadge from "./EvidenceCoverageBadge";
import { summarizeEvidenceCoverage } from "./evidenceCoverage";

type DecisionListProps = {
  decisions: ContextAnalysisResult["decisions"];
  onOpenEvidence?: (evidence: EvidenceRef[]) => void;
};

const statusLabel = {
  confirmed: "확정",
  tentative: "논의 중",
  unclear: "불확실",
} satisfies Record<ContextAnalysisResult["decisions"][number]["status"], string>;

function DecisionList({ decisions, onOpenEvidence }: DecisionListProps) {
  const coverage = summarizeEvidenceCoverage(decisions);

  return (
    <section className="result-panel context-sequence-panel decision-panel" aria-label="결정사항">
      <ContextSectionHeader
        step="03"
        kicker="Decision context"
        title="결정 배경"
        titleId="decision-title"
        intro="무엇을 정했는지뿐 아니라 그 판단을 만든 이유와 확실성까지 함께 봅니다."
        aside={<EvidenceCoverageBadge {...coverage} />}
      />

      {decisions.length > 0 ? (
        <ul className="decision-list">
          {decisions.map((item, index) => (
            <li key={item.id ?? item.decision}>
              <div>
                <span className="context-item-index" aria-hidden="true">D{index + 1}</span>
                <strong>{item.decision}</strong>
                <p>{item.reason}</p>
                <EvidenceButton evidence={item.evidence} onOpen={onOpenEvidence} />
              </div>
              <span className={`status-badge ${item.status}`}>{statusLabel[item.status]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="result-empty-state">입력 기록에서 명시적으로 확인된 결정사항이 없습니다.</p>
      )}
    </section>
  );
}

export default DecisionList;
