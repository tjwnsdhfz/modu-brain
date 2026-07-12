import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import AnalysisComparison from "./AnalysisComparison";

describe("AnalysisComparison", () => {
  it("turns additions, changes, and resolutions into a readable change narrative", () => {
    const previous = {
      ...sampleAnalysis,
      participants: [],
      decisions: [sampleAnalysis.decisions[0]],
      questions: [sampleAnalysis.questions[0]],
    };
    const latest = {
      ...sampleAnalysis,
      participants: [],
      decisions: [
        { ...sampleAnalysis.decisions[0], reason: "검증 결과를 반영해 배경이 달라졌다." },
        sampleAnalysis.decisions[1],
      ],
      questions: [],
    };

    render(<AnalysisComparison previous={previous} latest={latest} />);

    expect(screen.getByRole("status")).toHaveTextContent("새로 등장 1건, 내용 변경 1건, 해결 1건");
    const metrics = screen.getByLabelText("최근 분석 변화 요약");
    expect(metrics.tagName).toBe("DL");
    expect(metrics).not.toHaveAttribute("role");
    expect(metrics.querySelectorAll(":scope > div > dt, :scope > div > dd")).toHaveLength(6);
    expect(within(metrics).getByText("새로 등장").nextSibling).toHaveTextContent("1");
    expect(screen.getAllByText(/추가|변경|해결/, { selector: ".change-chip" })).toHaveLength(3);
  });
});
