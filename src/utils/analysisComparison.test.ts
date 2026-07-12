import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import { compareAnalyses } from "./analysisComparison";

describe("compareAnalyses", () => {
  it("treats the same normalized item as unchanged even when run-scoped IDs differ", () => {
    const previous = {
      ...sampleAnalysis,
      decisions: [{ ...sampleAnalysis.decisions[0], id: "run-1-item-1" }],
      questions: [{ ...sampleAnalysis.questions[0], id: "run-1-item-2" }],
    };
    const latest = {
      ...sampleAnalysis,
      decisions: [{ ...sampleAnalysis.decisions[0], id: "run-2-item-9" }],
      questions: [
        {
          ...sampleAnalysis.questions[0],
          id: "run-2-item-10",
          question: ` ${sampleAnalysis.questions[0].question.replace("?", "？")} `,
        },
      ],
    };

    expect(compareAnalyses(previous, latest)).toEqual([]);
  });

  it("reports a changed item when its stable text is the same but metadata changes", () => {
    const decision = sampleAnalysis.decisions[0];
    const previous = { ...sampleAnalysis, decisions: [decision], questions: [] };
    const latest = {
      ...sampleAnalysis,
      decisions: [{ ...decision, id: "another-run-id", reason: "새 검증 근거가 추가되었다." }],
      questions: [],
    };

    expect(compareAnalyses(previous, latest)).toEqual([
      expect.objectContaining({ kind: "changed", label: decision.decision }),
    ]);
  });

  it("reports newly added and resolved items independently", () => {
    const previous = {
      ...sampleAnalysis,
      decisions: sampleAnalysis.decisions.slice(0, 2),
      questions: sampleAnalysis.questions.slice(0, 2),
    };
    const latest = {
      ...sampleAnalysis,
      decisions: [sampleAnalysis.decisions[0], sampleAnalysis.decisions[2]],
      questions: [sampleAnalysis.questions[0], sampleAnalysis.questions[2]],
    };
    const changes = compareAnalyses(previous, latest);

    expect(changes.filter((item) => item.kind === "added").map((item) => item.label)).toEqual([
      sampleAnalysis.decisions[2].decision,
      sampleAnalysis.questions[2].question,
    ]);
    expect(changes.filter((item) => item.kind === "resolved").map((item) => item.label)).toEqual([
      sampleAnalysis.decisions[1].decision,
      sampleAnalysis.questions[1].question,
    ]);
  });

  it("reports a participant perspective change", () => {
    const participant = sampleAnalysis.participants[0];
    const previous = { ...sampleAnalysis, participants: [participant] };
    const latest = {
      ...sampleAnalysis,
      participants: [{ ...participant, concern: "새로운 개인정보 노출 위험을 먼저 확인해야 한다." }],
    };

    expect(compareAnalyses(previous, latest)).toContainEqual(
      expect.objectContaining({ kind: "changed", label: `관점 · ${participant.actor}` }),
    );
  });

  it("returns no changes without a comparable pair", () => {
    expect(compareAnalyses(undefined, sampleAnalysis)).toEqual([]);
  });
});
