import type { EvidenceRef, PerspectiveItem } from "../types/context";
import ContextSectionHeader from "./ContextSectionHeader";
import EvidenceButton from "./EvidenceButton";
import EvidenceCoverageBadge from "./EvidenceCoverageBadge";
import { summarizeEvidenceCoverage } from "./evidenceCoverage";

type PerspectiveTableProps = {
  participants: PerspectiveItem[];
  onOpenEvidence?: (evidence: EvidenceRef[]) => void;
};

function PerspectiveTable({ participants, onOpenEvidence }: PerspectiveTableProps) {
  const coverage = summarizeEvidenceCoverage(participants);

  return (
    <section className="result-panel wide context-sequence-panel" aria-labelledby="perspective-title">
      <ContextSectionHeader
        step="01"
        kicker="Perspective differences"
        title="참여자별 관점 차이"
        titleId="perspective-title"
        intro="같은 기록을 두고 무엇을 중요하게 보고, 어디에서 우려가 갈리는지 먼저 확인합니다."
        aside={<EvidenceCoverageBadge {...coverage} />}
      />

      {participants.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>참여자</th>
                <th>역할</th>
                <th>중점</th>
                <th>우려</th>
                <th>질문과 근거</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((item) => (
                <tr key={item.id ?? item.actor} aria-label={`${item.actor}의 관점`}>
                  <td data-label="참여자">{item.actor}</td>
                  <td data-label="역할">{item.role}</td>
                  <td data-label="중점">{item.focus}</td>
                  <td data-label="우려">{item.concern}</td>
                  <td data-label="질문과 근거">
                    {item.question}
                    <EvidenceButton evidence={item.evidence} onOpen={onOpenEvidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="result-empty-state">입력 기록에서 참여자별 발언 주체를 구분할 수 없습니다.</p>
      )}
    </section>
  );
}

export default PerspectiveTable;
