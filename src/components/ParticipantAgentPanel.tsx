import type { ParticipantAgentSynthesis } from "../types/context";
import AgentStepRail from "./AgentStepRail";
import EvidenceCoverageBadge from "./EvidenceCoverageBadge";

function ParticipantAgentPanel({ synthesis }: { synthesis: ParticipantAgentSynthesis }) {
  const steps = [
    {
      id: "agent-step-tension",
      label: "충돌 확인",
      description: "서로 다른 우선순위",
      count: synthesis.tensionPoints.length,
    },
    {
      id: "agent-step-agreement",
      label: "공통 합의",
      description: "함께 유지할 기준",
      count: synthesis.agreementPoints.length,
    },
    {
      id: "agent-step-views",
      label: "관점별 위험",
      description: "참여자별 다음 확인",
      count: synthesis.views.length,
    },
  ];

  return (
    <section className="result-panel participant-agent-panel" aria-labelledby="participant-agent-title">
      <div className="panel-heading compact agent-heading">
        <div>
          <p className="section-kicker">Evidence-based perspectives</p>
          <h2 id="participant-agent-title">참여자 관점 종합</h2>
          <p>충돌에서 합의로, 다시 참여자별 위험으로 이어지는 순서대로 읽습니다.</p>
        </div>
        <aside className="agent-privacy-note" aria-label="분석 개인정보 안내">
          {synthesis.privacyNote}
        </aside>
      </div>

      <AgentStepRail steps={steps} />

      <div className="agent-synthesis-grid">
        <Synthesis
          id="agent-step-tension"
          title="관점 충돌 · 먼저 확인"
          empty="명확하게 확인된 관점 충돌이 없습니다."
          items={synthesis.tensionPoints}
          tone="tension"
        />
        <Synthesis
          id="agent-step-agreement"
          title="공통 합의"
          empty="명확하게 확인된 공통 합의가 없습니다."
          items={synthesis.agreementPoints}
          tone="agreement"
        />
      </div>

      <section id="agent-step-views" className="agent-view-section" aria-labelledby="agent-view-title">
        <div className="agent-view-section-heading">
          <div>
            <p className="section-kicker">Participant risks</p>
            <h3 id="agent-view-title">참여자별 다음 확인</h3>
          </div>
          <span>{synthesis.views.length}명</span>
        </div>
        {synthesis.views.length > 0 ? (
          <div className="agent-view-grid">
            {synthesis.views.map((view, index) => (
              <article className="agent-view-card" key={`${view.actor}-${index}`}>
                <header>
                  <div><strong>{view.actor}</strong><span>{view.role}</span></div>
                  <EvidenceCoverageBadge
                    evidenceCount={view.evidence.length}
                    label="입력 근거"
                    compact
                  />
                </header>
                <dl className="agent-view-details">
                  <div><dt>핵심 우선순위</dt><dd>{view.priority}</dd></div>
                  <div><dt>관점 해석</dt><dd>{view.interpretation}</dd></div>
                  <div><dt>확인할 위험</dt><dd>{view.risk}</dd></div>
                </dl>
                <div className="agent-evidence">
                  <strong>입력 기록 근거</strong>
                  {view.evidence.length > 0 ? (
                    <ul>{view.evidence.map((item, evidenceIndex) => <li key={`${item}-${evidenceIndex}`}>{item}</li>)}</ul>
                  ) : <p>확인 가능한 근거 문장이 없습니다.</p>}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="agent-empty-state">입력 기록에서 구분할 수 있는 참여자 관점이 없습니다.</p>}
      </section>
    </section>
  );
}

function Synthesis({ id, title, empty, items, tone }: { id: string; title: string; empty: string; items: string[]; tone: "agreement" | "tension" }) {
  return (
    <section id={id} className={`agent-synthesis ${tone}`}>
      <h3>{title}</h3>
      {items.length > 0
        ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        : <p>{empty}</p>}
    </section>
  );
}

export default ParticipantAgentPanel;
