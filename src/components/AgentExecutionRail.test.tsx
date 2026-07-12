import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AnalysisRunStepEventResource } from "../types/platform";
import AgentExecutionRail from "./AgentExecutionRail";

describe("AgentExecutionRail", () => {
  it("shows verified stages and evidence metrics without internal reasoning", () => {
    render(
      <AgentExecutionRail
        runStatus="succeeded"
        events={[
          event({ sequence: 1, eventKey: "source_snapshot:started", step: "source_snapshot", status: "started" }),
          event({ sequence: 2, eventKey: "source_snapshot:succeeded", step: "source_snapshot", status: "succeeded", sourceCount: 3, inputCharacters: 4200 }),
          event({ sequence: 3, eventKey: "provider_analysis:succeeded", step: "provider_analysis", status: "succeeded", durationMs: 840 }),
          event({ sequence: 4, eventKey: "evidence_validation:succeeded", step: "evidence_validation", status: "succeeded", validationOutcome: "passed", evidenceReferenceCount: 9 }),
          event({ sequence: 5, eventKey: "result_persistence:succeeded", step: "result_persistence", status: "succeeded" }),
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "에이전트가 확인한 단계" })).toBeInTheDocument();
    expect(screen.getByText("자료 확인")).toBeInTheDocument();
    expect(screen.getByText("관점·결정 추출")).toBeInTheDocument();
    expect(screen.getByText("인용 검증")).toBeInTheDocument();
    expect(screen.getByText("변화 종합")).toBeInTheDocument();
    expect(screen.getByText("3개")).toBeInTheDocument();
    expect(screen.getByText("9개")).toBeInTheDocument();
    expect(screen.queryByText(/chain of thought|사고 과정:/i)).not.toBeInTheDocument();
  });

  it("labels legacy runs honestly when no step events exist", () => {
    render(<AgentExecutionRail runStatus="succeeded" events={[]} />);
    expect(screen.getByText("이 실행은 단계 기록 기능이 추가되기 전에 생성되었습니다.")).toBeInTheDocument();
  });

  it("distinguishes loading, failed, cancelled, and waiting stages", () => {
    const { rerender } = render(
      <AgentExecutionRail runStatus="running" events={[]} loading />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");

    rerender(
      <AgentExecutionRail
        runStatus="failed"
        events={[
          event({ sequence: 1, eventKey: "source_snapshot:succeeded", step: "source_snapshot", status: "succeeded", code: "SNAPSHOT_READY" }),
          event({ sequence: 2, eventKey: "provider_analysis:cancelled", step: "provider_analysis", status: "cancelled", code: "REQUEST_CANCELLED" }),
          event({ sequence: 3, eventKey: "evidence_validation:failed", step: "evidence_validation", status: "failed", validationOutcome: "failed", code: "EVIDENCE_VALIDATION_FAILED" }),
        ]}
      />,
    );

    expect(screen.getByText("실패", { selector: ".run-status" })).toBeInTheDocument();
    expect(screen.getByText("검토 필요")).toBeInTheDocument();
    expect(screen.getByText("취소")).toBeInTheDocument();
    expect(screen.getByText("대기")).toBeInTheDocument();
    expect(screen.getByText("실패", { selector: ".agent-execution-metrics dd" })).toBeInTheDocument();
  });
});

function event(overrides: Partial<AnalysisRunStepEventResource>): AnalysisRunStepEventResource {
  return {
    id: `event-${overrides.sequence ?? 1}`,
    analysisRunId: "run-1",
    sequence: 1,
    eventKey: "source_snapshot:started",
    step: "source_snapshot",
    status: "started",
    validationOutcome: null,
    code: null,
    durationMs: null,
    sourceCount: null,
    inputCharacters: null,
    outputItemCount: null,
    evidenceReferenceCount: null,
    createdAt: "2026-07-11T00:00:00Z",
    ...overrides,
  };
}
