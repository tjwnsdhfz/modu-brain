import type {
  AnalysisRunStatus,
  AnalysisRunStep,
  AnalysisRunStepEventResource,
} from "../types/platform";

const steps: { id: AnalysisRunStep; label: string; description: string }[] = [
  { id: "source_snapshot", label: "자료 확인", description: "선택한 원문을 불변 스냅숏으로 고정" },
  { id: "provider_analysis", label: "관점·결정 추출", description: "원문을 데이터로만 읽고 구조화" },
  { id: "evidence_validation", label: "인용 검증", description: "모든 근거가 실제 원문에 있는지 확인" },
  { id: "result_persistence", label: "변화 종합", description: "검증된 결과와 실행 이력을 저장" },
];

function AgentExecutionRail({
  events,
  runStatus,
  loading = false,
}: {
  events: AnalysisRunStepEventResource[];
  runStatus: AnalysisRunStatus;
  loading?: boolean;
}) {
  const latestByStep = new Map<AnalysisRunStep, AnalysisRunStepEventResource>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    latestByStep.set(event.step, event);
  }
  const evidenceEvent = latestByStep.get("evidence_validation");
  const sourceEvent = latestByStep.get("source_snapshot");

  return (
    <section className="agent-execution-panel" aria-labelledby="agent-execution-title">
      <div className="section-row agent-execution-heading">
        <div>
          <p className="section-kicker">Verified workflow</p>
          <h2 id="agent-execution-title">에이전트가 확인한 단계</h2>
          <p>내부 사고 과정 대신 자료 확인과 검증 결과만 표시합니다.</p>
        </div>
        <span className={`run-status ${runStatus}`}>{runStatusLabel(runStatus)}</span>
      </div>

      {loading ? (
        <p className="agent-execution-empty" role="status">실행 단계를 불러오는 중…</p>
      ) : events.length === 0 ? (
        <p className="agent-execution-empty">이 실행은 단계 기록 기능이 추가되기 전에 생성되었습니다.</p>
      ) : (
        <ol className="agent-execution-rail">
          {steps.map((step, index) => {
            const event = latestByStep.get(step.id);
            const status = event?.status ?? "waiting";
            return (
              <li key={step.id} className={status}>
                <span className="agent-execution-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.description}</p>
                  {event && <small>{eventSummary(event)}</small>}
                </div>
                <span className="agent-execution-status">{stepStatusLabel(status)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {events.length > 0 && (
        <dl className="agent-execution-metrics" aria-label="에이전트 실행 검증 요약">
          <div><dt>고정한 원문</dt><dd>{sourceEvent?.sourceCount ?? 0}개</dd></div>
          <div><dt>입력 문자</dt><dd>{(sourceEvent?.inputCharacters ?? 0).toLocaleString("ko-KR")}</dd></div>
          <div><dt>검증된 인용</dt><dd>{evidenceEvent?.evidenceReferenceCount ?? 0}개</dd></div>
          <div><dt>검증 결과</dt><dd>{evidenceEvent?.validationOutcome === "passed" ? "통과" : evidenceEvent?.validationOutcome === "failed" ? "실패" : "대기"}</dd></div>
        </dl>
      )}
    </section>
  );
}

function eventSummary(event: AnalysisRunStepEventResource) {
  const values = [
    event.durationMs === null ? null : `${event.durationMs.toLocaleString("ko-KR")}ms`,
    event.outputItemCount === null ? null : `항목 ${event.outputItemCount}개`,
    event.evidenceReferenceCount === null ? null : `인용 ${event.evidenceReferenceCount}개`,
  ].filter(Boolean);
  return values.join(" · ") || event.code || "단계 기록 완료";
}

function stepStatusLabel(status: AnalysisRunStepEventResource["status"] | "waiting") {
  return {
    waiting: "대기",
    started: "진행 중",
    succeeded: "검증됨",
    failed: "검토 필요",
    cancelled: "취소",
  }[status];
}

function runStatusLabel(status: AnalysisRunStatus) {
  return { running: "진행 중", succeeded: "성공", failed: "실패", cancelled: "취소" }[status];
}

export default AgentExecutionRail;
