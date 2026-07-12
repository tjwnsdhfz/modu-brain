// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildContextAnalysisResultV2, validateEvidenceReferences } from "./analysisResultV2.mjs";

const sourceId = "33333333-3333-4333-8333-333333333333";
const snapshots = [
  {
    source_record_id: sourceId,
    source_title: "회의록",
    content_snapshot: "민지는 입력 흐름을 단순하게 만들자고 말했다. 팀은 직접 입력으로 시작하기로 결정했다.",
  },
];

describe("analysis result v2 evidence", () => {
  it("adds deterministic IDs and exact immutable-source evidence to every result section", () => {
    const input = {
      decisions: [{ decision: "팀은 직접 입력으로 시작하기로 결정했다.", reason: "검증", status: "confirmed" }],
      participants: [{ actor: "민지", focus: "입력 흐름", concern: "복잡성", question: "단순한가?" }],
      questions: [{ question: "다음 단계는?", reason: "미정", ownerHint: "팀" }],
      keyTerms: [{ term: "입력", meaning: "기록" }],
      knowledgeMap: { nodes: [{ label: "입력", summary: "입력 흐름" }], links: [] },
      participantAgents: { views: [{ actor: "민지", evidence: ["민지는 입력 흐름을 단순하게 만들자고 말했다."] }] },
    };
    const result = buildContextAnalysisResultV2(input, snapshots, "run-1");
    expect(result.schemaVersion).toBe("2.0");
    expect(result.decisions[0].id).toBe(
      buildContextAnalysisResultV2(input, snapshots, "different-run").decisions[0].id,
    );
    expect(result.decisions[0].evidence[0].quote).toBe("팀은 직접 입력으로 시작하기로 결정했다.");
    expect(result.knowledgeMap.nodes[0].evidence[0].sourceRecordId).toBe(sourceId);
    expect(result.participantAgents.views[0].evidenceRefs[0].quote).toContain("민지는");
    expect(result.participants[0].evidence[0].quote).toContain("민지는");
    expect(validateEvidenceReferences(result, snapshots)).toBe(true);
  });

  it("does not attach an unrelated first sentence when no hint exists in the source", () => {
    const result = buildContextAnalysisResultV2(
      {
        decisions: [{ decision: "원문에 없는 결정", reason: "추정", status: "unclear" }],
        participants: [],
        questions: [],
        keyTerms: [],
        knowledgeMap: { nodes: [], links: [] },
        participantAgents: { views: [] },
      },
      snapshots,
      "run-3",
    );
    expect(result.decisions[0].evidence).toEqual([]);
  });

  it("rejects fabricated or cross-source evidence", () => {
    const invalid = {
      evidence: [{ sourceRecordId: sourceId, sourceTitle: "회의록", quote: "원문에 없는 주장" }],
    };
    expect(() => validateEvidenceReferences(invalid, snapshots)).toThrow(
      expect.objectContaining({ status: 502, code: "EVIDENCE_VALIDATION_FAILED" }),
    );
  });

  it("rejects a provider-supplied raw evidence string that is absent from snapshots", () => {
    expect(() =>
      buildContextAnalysisResultV2(
        {
          decisions: [],
          participants: [],
          questions: [],
          keyTerms: [],
          knowledgeMap: { nodes: [], links: [] },
          participantAgents: {
            views: [{ actor: "민지", evidence: ["원문에 없는 공급자 인용"] }],
          },
        },
        snapshots,
      ),
    ).toThrow(expect.objectContaining({ status: 502, code: "EVIDENCE_VALIDATION_FAILED" }));
  });

  it("allows sparse analyses without evidence when no snapshot text exists", () => {
    const result = buildContextAnalysisResultV2(
      { decisions: [], participants: [], questions: [], keyTerms: [], knowledgeMap: { nodes: [], links: [] }, participantAgents: { views: [] } },
      [],
      "run-2",
    );
    expect(result.decisions).toEqual([]);
  });
});
