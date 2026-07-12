export type AgentStepRailItem = {
  id: string;
  label: string;
  description: string;
  count: number;
};

function AgentStepRail({ steps }: { steps: AgentStepRailItem[] }) {
  return (
    <nav className="agent-step-navigation" aria-label="참여자 관점 종합 읽기 순서">
      <ol className="agent-step-rail">
        {steps.map((step, index) => (
          <li key={step.id}>
            <a href={`#${step.id}`}>
              <span className="agent-step-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="agent-step-copy">
                <strong>{step.label}</strong>
                <small>{step.description}</small>
              </span>
              <span className="agent-step-count">{step.count}건</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default AgentStepRail;
