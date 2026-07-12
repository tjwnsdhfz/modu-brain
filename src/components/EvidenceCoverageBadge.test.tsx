import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EvidenceCoverageBadge from "./EvidenceCoverageBadge";
import { summarizeEvidenceCoverage } from "./evidenceCoverage";

describe("EvidenceCoverageBadge", () => {
  it("announces partial item coverage with a visible, non-color status", () => {
    render(
      <EvidenceCoverageBadge
        evidenceCount={3}
        coveredItems={2}
        totalItems={4}
      />,
    );

    const badge = screen.getByLabelText("근거 연결 일부 연결 · 2/4 · 인용 3개");
    expect(badge).toHaveClass("partial");
    expect(badge).toHaveTextContent("일부 연결");
  });

  it("summarizes both covered items and exact evidence references", () => {
    expect(summarizeEvidenceCoverage([
      { evidence: [{ sourceRecordId: "source-1", sourceTitle: "회의", quote: "첫 근거" }] },
      { evidence: [] },
      {
        evidence: [
          { sourceRecordId: "source-2", sourceTitle: "피드백", quote: "둘째 근거" },
          { sourceRecordId: "source-2", sourceTitle: "피드백", quote: "셋째 근거" },
        ],
      },
    ])).toEqual({ evidenceCount: 3, coveredItems: 2, totalItems: 3 });
  });
});
