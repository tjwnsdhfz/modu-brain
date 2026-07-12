// @vitest-environment node

import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeProjectContext } from "../../server/contextAnalysisCore.mjs";

const fixtures = JSON.parse(
  readFileSync(new URL("./korean-context-cases.json", import.meta.url), "utf8"),
);

describe("Korean context evaluation fixtures", () => {
  it("contains 30 stable, non-billable scenarios", () => {
    expect(fixtures).toHaveLength(30);
    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(30);

    for (const fixture of fixtures) {
      expect(fixture.projectTitle.length).toBeGreaterThanOrEqual(2);
      expect(fixture.projectTitle.length).toBeLessThanOrEqual(120);
      expect(fixture.rawText.length).toBeGreaterThanOrEqual(120);
      expect(fixture.rawText.length).toBeLessThanOrEqual(20_000);
    }
  });

  it.each(fixtures)(
    "validates local evidence and expectations: $id",
    async (fixture) => {
      const result = await analyzeProjectContext(
        { projectTitle: fixture.projectTitle, rawText: fixture.rawText },
        { provider: "local-heuristic" },
      );

      expect(result.provider).toMatchObject({
        name: "local-heuristic",
        usedExternalModel: false,
      });
      expect(result.projectTitle).toBe(fixture.projectTitle);
      expect(result.summary.sourceLength).toBe(fixture.rawText.length);
      expect(result.participants.length).toBeGreaterThanOrEqual(
        fixture.expected.minParticipants,
      );
      expect(result.decisions.length).toBeGreaterThanOrEqual(
        fixture.expected.minDecisions,
      );
      expect(result.questions.length).toBeGreaterThanOrEqual(
        fixture.expected.minQuestions,
      );
      expect(result.participantAgents.privacyNote).toContain(
        "성격을 추정하지 않고",
      );

      if (fixture.expected.actors) {
        expect(result.participants.map(({ actor }) => actor)).toEqual(
          expect.arrayContaining(fixture.expected.actors),
        );
      }

      if (fixture.expected.emptyEvidence) {
        expect(result.participantAgents.views).toEqual([]);
      }

      for (const view of result.participantAgents.views) {
        expect(view.evidence.length).toBeGreaterThan(0);
        for (const evidence of view.evidence) {
          expect(fixture.rawText).toContain(evidence);
        }
      }

      for (const item of [
        ...result.participants,
        ...result.decisions,
        ...result.questions,
      ]) {
        for (const evidence of item.evidence || []) {
          expect(fixture.rawText).toContain(evidence);
        }
      }

      const nodeIds = new Set(result.knowledgeMap.nodes.map(({ id }) => id));
      for (const link of result.knowledgeMap.links) {
        expect(nodeIds.has(link.from)).toBe(true);
        expect(nodeIds.has(link.to)).toBe(true);
      }
    },
  );
});
