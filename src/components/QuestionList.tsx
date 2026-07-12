import type { EvidenceRef, QuestionItem } from "../types/context";
import ContextSectionHeader from "./ContextSectionHeader";
import EvidenceButton from "./EvidenceButton";
import EvidenceCoverageBadge from "./EvidenceCoverageBadge";
import { summarizeEvidenceCoverage } from "./evidenceCoverage";

type QuestionListProps = {
  questions: QuestionItem[];
  onOpenEvidence?: (evidence: EvidenceRef[]) => void;
};

function QuestionList({ questions, onOpenEvidence }: QuestionListProps) {
  const coverage = summarizeEvidenceCoverage(questions);

  return (
    <section className="result-panel context-sequence-panel question-panel" aria-labelledby="question-title">
      <ContextSectionHeader
        step="02"
        kicker="Open questions"
        title="미결 질문"
        titleId="question-title"
        intro="다음 대화에서 답을 얻어야 프로젝트가 앞으로 움직이는 질문입니다."
        aside={<EvidenceCoverageBadge {...coverage} />}
      />

      {questions.length > 0 ? (
        <ol className="question-list">
          {questions.map((question, index) => (
            <li key={question.id ?? question.question}>
              <span className="context-item-index" aria-hidden="true">Q{index + 1}</span>
              <strong>{question.question}</strong>
              <span>{question.reason}</span>
              <small>다음 확인 · {question.ownerHint}</small>
              <EvidenceButton evidence={question.evidence} onOpen={onOpenEvidence} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="result-empty-state">입력 기록에서 명시적으로 확인된 미해결 질문이 없습니다.</p>
      )}
    </section>
  );
}

export default QuestionList;
