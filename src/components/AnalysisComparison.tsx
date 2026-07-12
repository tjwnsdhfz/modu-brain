import type { ContextAnalysisResultV2 } from "../types/context";
import { compareAnalyses } from "../utils/analysisComparison";

function AnalysisComparison({
  previous,
  latest,
}: {
  previous?: ContextAnalysisResultV2;
  latest?: ContextAnalysisResultV2;
}) {
  const changes = compareAnalyses(previous, latest);
  const counts = changes.reduce(
    (summary, change) => ({ ...summary, [change.kind]: summary[change.kind] + 1 }),
    { added: 0, changed: 0, resolved: 0 },
  );
  const narrative = `새로 등장 ${counts.added}건, 내용 변경 ${counts.changed}건, 해결 ${counts.resolved}건`;

  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <div className="section-row comparison-heading">
        <div>
          <p className="section-kicker">Change narrative</p>
          <h2 id="comparison-title">최근 분석의 변화 서사</h2>
          <p>항목 수보다 무엇이 생기고, 달라지고, 해결됐는지 순서대로 읽습니다.</p>
        </div>
        <span className="comparison-total">{changes.length}건</span>
      </div>
      {!previous ? (
        <p className="empty-card">비교할 이전 성공 분석이 없습니다.</p>
      ) : changes.length === 0 ? (
        <p className="empty-card">관점, 결정, 질문에서 확인된 변화가 없습니다.</p>
      ) : (
        <>
          <div className="comparison-narrative" role="status">
            <strong>지난 성공 분석 이후</strong>
            <p>{narrative}</p>
          </div>
          <dl className="comparison-metrics" aria-label="최근 분석 변화 요약">
            <div className="added"><dt>새로 등장</dt><dd>{counts.added}</dd></div>
            <div className="changed"><dt>내용 변경</dt><dd>{counts.changed}</dd></div>
            <div className="resolved"><dt>해결</dt><dd>{counts.resolved}</dd></div>
          </dl>
          <ol className="comparison-list comparison-story">
          {changes.map((change, index) => (
            <li key={`${change.kind}-${change.id}`}>
              <span className="comparison-story-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <span className={`change-chip ${change.kind}`}>
                  {{ added: "추가", changed: "변경", resolved: "해결" }[change.kind]}
                </span>
                <p>{change.label}</p>
              </div>
            </li>
          ))}
          </ol>
        </>
      )}
    </section>
  );
}

export default AnalysisComparison;
