import type { ReactNode } from "react";

type ContextSectionHeaderProps = {
  step: string;
  kicker: string;
  title: string;
  titleId: string;
  intro: string;
  aside?: ReactNode;
};

function ContextSectionHeader({
  step,
  kicker,
  title,
  titleId,
  intro,
  aside,
}: ContextSectionHeaderProps) {
  return (
    <div className="panel-heading compact context-section-heading">
      <div className="context-section-copy">
        <p className="section-kicker context-sequence-kicker">
          <span className="context-sequence-index" aria-hidden="true">{step}</span>
          {kicker}
        </p>
        <h2 id={titleId}>{title}</h2>
        <p>{intro}</p>
      </div>
      {aside && <div className="context-section-aside">{aside}</div>}
    </div>
  );
}

export default ContextSectionHeader;
