import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import type { ContextAnalysisResultV2 } from "../types/context";
import AgentInsightPanel from "./AgentInsightPanel";

function result(
  generatedAt: string,
  decisions: ContextAnalysisResultV2["decisions"],
): ContextAnalysisResultV2 {
  return {
    ...sampleAnalysis,
    schemaVersion: "2.0",
    summary: { ...sampleAnalysis.summary, generatedAt },
    decisions,
  };
}

describe("AgentInsightPanel", () => {
  it("shows lifecycle changes and labels contradiction signals as review candidates", async () => {
    const evidence = [{ sourceRecordId: "s1", sourceTitle: "회의", quote: "검색 기록은 공개한다." }];
    const previous = result("2026-07-10T00:00:00.000Z", [
      { id: "decision_search", decision: "검색 기록을 공개한다", reason: "협업", status: "tentative", evidence },
      { id: "decision_old", decision: "이전 시안을 유지한다", reason: "안정성", status: "confirmed", evidence },
    ]);
    const latest = result("2026-07-11T00:00:00.000Z", [
      {
        id: "decision_search",
        decision: "검색 기록을 공개한다",
        reason: "팀 검토를 빠르게 한다",
        status: "confirmed",
        evidence,
        agentConfidence: { score: 0.8, level: "high", rationale: "원문 1개에서 확인", evidenceCount: 1, sourceCount: 1 },
      },
      { id: "decision_private", decision: "검색 기록을 비공개로 유지한다", reason: "보안", status: "tentative", evidence },
    ]);
    const onOpenEvidence = vi.fn();
    const user = userEvent.setup();

    render(<AgentInsightPanel latest={latest} previous={previous} onOpenEvidence={onOpenEvidence} />);

    expect(screen.getByRole("heading", { name: "결정 변화와 검토 신호" })).toBeInTheDocument();
    expect(screen.getAllByText("변경됨")).not.toHaveLength(0);
    expect(screen.getAllByText("이전 실행에만 있음")).not.toHaveLength(0);
    expect(screen.getByText(/검토 후보/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /원문 근거/ }));
    expect(onOpenEvidence).toHaveBeenCalledWith(expect.arrayContaining(evidence));
  });

  it("explains the first successful run as a baseline", () => {
    render(<AgentInsightPanel latest={result("2026-07-11T00:00:00.000Z", [])} />);
    expect(screen.getByText(/첫 성공 분석을 기준선/)).toBeInTheDocument();
  });
});
