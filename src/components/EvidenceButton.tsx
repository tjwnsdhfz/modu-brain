import type { EvidenceRef } from "../types/context";
import EvidenceCoverageBadge from "./EvidenceCoverageBadge";

type EvidenceButtonProps = {
  evidence?: EvidenceRef[];
  onOpen?: (evidence: EvidenceRef[]) => void;
};

function EvidenceButton({ evidence = [], onOpen }: EvidenceButtonProps) {
  if (evidence.length === 0 || !onOpen) return null;

  return (
    <button
      className="evidence-button"
      type="button"
      aria-label={`근거 ${evidence.length}개`}
      onClick={() => onOpen(evidence)}
    >
      <EvidenceCoverageBadge
        evidenceCount={evidence.length}
        label="근거"
        compact
      />
    </button>
  );
}

export default EvidenceButton;
