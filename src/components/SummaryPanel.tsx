import type { ContextAnalysisResult } from "../types/context";
import ContextSectionHeader from "./ContextSectionHeader";

type SummaryResult = Pick<
  ContextAnalysisResult,
  "projectTitle" | "summary" | "participants" | "questions"
>;

function SummaryPanel({ result }: { result: SummaryResult }) {
  return (
    <section className="summary-panel context-sequence-panel summary-sequence-panel" aria-labelledby={`summary-title-${result.summary.generatedAt}`}>
      <ContextSectionHeader
        step="04"
        kicker="Context summary"
        title={result.projectTitle}
        titleId={`summary-title-${result.summary.generatedAt}`}
        intro="앞에서 확인한 관점 차이, 미결 질문, 결정 배경을 바탕으로 읽는 공동 맥락입니다."
      />
      <div className="metric-row" aria-label="분석 결과 요약">
        <div><strong>{result.participants.length}</strong><span>구분된 관점</span></div>
        <div><strong>{result.questions.length}</strong><span>미해결 질문</span></div>
        <div><strong>{result.summary.overview.length}</strong><span>핵심 맥락</span></div>
      </div>
      <ol className="summary-list">{result.summary.overview.map((item) => <li key={item}>{item}</li>)}</ol>
    </section>
  );
}

export default SummaryPanel;
