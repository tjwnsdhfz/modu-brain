import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import type { ContextAnalysisResultV2 } from "../types/context";
import AnalysisFeedbackPanel from "./AnalysisFeedbackPanel";

describe("AnalysisFeedbackPanel", () => {
  it("stores a targeted correction with an idempotency key", async () => {
    const user = userEvent.setup();
    const result: ContextAnalysisResultV2 = {
      ...sampleAnalysis,
      decisions: sampleAnalysis.decisions.map((item, index) => ({ ...item, id: `decision-${index + 1}` })),
    };
    const onCreate = vi.fn().mockResolvedValue({
      id: "annotation-1",
      analysisRunId: "run-1",
      annotationType: "correction",
      target: { type: "decision", id: "decision-1" },
      body: "이 항목은 결정이 아니라 제안입니다.",
      createdAt: "2026-07-11T00:00:00Z",
    });

    render(
      <AnalysisFeedbackPanel
        result={result}
        annotations={[]}
        loading={false}
        onCreate={onCreate}
      />,
    );

    await user.selectOptions(screen.getByLabelText("검토 대상"), "decision:decision-1");
    await user.type(screen.getByLabelText("메모"), "이 항목은 결정이 아니라 제안입니다.");
    await user.click(screen.getByRole("button", { name: "검토 이력 저장" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationType: "correction",
        targetType: "decision",
        targetId: "decision-1",
        body: "이 항목은 결정이 아니라 제안입니다.",
      }),
      expect.stringMatching(/^.{8,128}$/),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("불변 이력으로 저장했습니다");
  });

  it("shows immutable annotation history", () => {
    render(
      <AnalysisFeedbackPanel
        result={sampleAnalysis}
        loading={false}
        onCreate={vi.fn()}
        annotations={[{
          id: "annotation-1",
          analysisRunId: "run-1",
          annotationType: "note",
          target: { type: "run" },
          body: "다음 회의에서 근거 범위를 다시 확인합니다.",
          createdAt: "2026-07-11T00:00:00Z",
        }]}
      />,
    );

    expect(screen.getByText("검토 메모", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("다음 회의에서 근거 범위를 다시 확인합니다.")).toBeInTheDocument();
  });

  it("keeps the idempotency key when the same correction is retried", async () => {
    const user = userEvent.setup();
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error("네트워크 오류"))
      .mockResolvedValueOnce({
        id: "annotation-2",
        analysisRunId: "run-1",
        annotationType: "note",
        target: { type: "run" },
        body: "근거를 다시 검토합니다.",
        createdAt: "2026-07-11T00:00:00Z",
      });
    render(
      <AnalysisFeedbackPanel
        result={sampleAnalysis}
        annotations={[]}
        loading
        onCreate={onCreate}
      />,
    );

    expect(screen.getByText("검토 이력을 불러오는 중…")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("검토 유형"), "note");
    await user.type(screen.getByLabelText("메모"), "근거를 다시 검토합니다.");
    await user.click(screen.getByRole("button", { name: "검토 이력 저장" }));
    expect(await screen.findByText("네트워크 오류")).toHaveAttribute("role", "status");
    const firstKey = onCreate.mock.calls[0][1];

    await user.click(screen.getByRole("button", { name: "검토 이력 저장" }));
    expect(await screen.findByText(/불변 이력으로 저장했습니다/)).toHaveAttribute("role", "status");
    expect(onCreate.mock.calls[1][1]).toBe(firstKey);
  });
});
