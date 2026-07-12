import type { EvidenceRef } from "../types/context";

type EvidenceBearingItem = {
  evidence?: EvidenceRef[];
};

export function summarizeEvidenceCoverage(items: EvidenceBearingItem[]) {
  return items.reduce(
    (summary, item) => {
      const count = item.evidence?.length ?? 0;
      return {
        evidenceCount: summary.evidenceCount + count,
        coveredItems: summary.coveredItems + (count > 0 ? 1 : 0),
        totalItems: summary.totalItems + 1,
      };
    },
    { evidenceCount: 0, coveredItems: 0, totalItems: 0 },
  );
}
