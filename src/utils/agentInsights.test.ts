import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import type { ContextAnalysisResultV2, DecisionItem } from "../types/context";
import {
  deriveAgentInsights,
  deriveDecisionLifecycle,
  detectContradictionCandidates,
} from "./agentInsights";

describe("agentInsights", () => {
  it("classifies stable, changed, new, and resolved decisions across two runs", () => {
    const stable = decision("직접 입력 MVP를 유지한다.", "범위를 지킨다.", "stable-id");
    const changed = decision("공유 링크는 7일 유지한다.", "보안 기본값이다.", "changed-id");
    const resolved = decision("파일 업로드를 검토한다.", "후속 범위다.", "resolved-id");
    const previous = result([stable, changed, resolved], "2026-07-10T00:00:00.000Z");
    const latest = result([
      { ...stable },
      { ...changed, reason: "데모 피드백을 반영한 보안 기본값이다." },
      decision("근거 패널을 기본으로 제공한다.", "검증 가능성을 높인다.", "new-id"),
    ], "2026-07-11T00:00:00.000Z");

    const lifecycle = deriveDecisionLifecycle(previous, latest);

    expect(lifecycle.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "stable-id", status: "stable" },
      { id: "changed-id", status: "changed" },
      { id: "new-id", status: "new" },
      { id: "resolved-id", status: "resolved" },
    ]);
    expect(lifecycle[1].changedFields).toEqual(["reason"]);
    expect(lifecycle[3].previousObservedAt).toBe("2026-07-10T00:00:00.000Z");
  });

  it("matches a lightly rewritten decision as changed instead of new plus resolved", () => {
    const previous = result([
      decision("메신저 자동 연동은 MVP에서 제외한다.", "범위가 크다."),
    ]);
    const latest = result([
      decision("메신저 자동 연동은 MVP 범위에서 제외한다.", "후속 버전에서 검토한다."),
    ]);

    expect(deriveDecisionLifecycle(previous, latest)).toEqual([
      expect.objectContaining({ status: "changed", changedFields: ["decision", "reason"] }),
    ]);
  });

  it("flags only same-context opposing directives as contradiction candidates", () => {
    const decisions = [
      decision("외부 공유 링크를 허용한다.", "데모 접근성을 높인다.", "allow"),
      decision("외부 공유 링크를 금지한다.", "보안을 우선한다.", "forbid"),
      decision("결제 기능은 MVP에서 제외한다.", "현재 범위가 아니다.", "billing"),
      decision("팀 초대 기능은 MVP에 포함한다.", "협업에 필요하다.", "invite"),
    ];

    const candidates = detectContradictionCandidates({ decisions });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      leftDecisionId: "allow",
      rightDecisionId: "forbid",
    });
    expect(candidates[0].reason).toContain("허용");
  });

  it("returns deterministic aggregate counts for a first analysis", () => {
    const latest = result([decision("근거를 표시한다.", "검증을 돕는다.")]);
    const first = deriveAgentInsights(undefined, latest);
    const second = deriveAgentInsights(undefined, latest);

    expect(first).toEqual(second);
    expect(first.counts).toEqual({ new: 1, changed: 0, stable: 0, resolved: 0 });
  });
});

function decision(
  value: string,
  reason: string,
  id?: string,
): DecisionItem {
  return { id, decision: value, reason, status: "confirmed" };
}

function result(
  decisions: DecisionItem[],
  generatedAt = "2026-07-11T00:00:00.000Z",
): ContextAnalysisResultV2 {
  return {
    ...sampleAnalysis,
    summary: { ...sampleAnalysis.summary, generatedAt },
    decisions,
  };
}
