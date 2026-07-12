import { z } from "zod";

const shortText = z.string().min(1).max(240);
const mediumText = z.string().min(1).max(600);

export const structuredContextAnalysisSchema = z.strictObject({
  overview: z.array(mediumText).min(1).max(4),
  keyTerms: z
    .array(
      z.strictObject({
        term: shortText,
        meaning: mediumText,
      }),
    )
    .max(8),
  decisions: z
    .array(
      z.strictObject({
        decision: mediumText,
        reason: mediumText,
        status: z.enum(["confirmed", "tentative", "unclear"]),
        evidence: z.array(mediumText).min(1).max(4),
      }),
    )
    .max(8),
  participants: z
    .array(
      z.strictObject({
        actor: shortText,
        role: shortText,
        focus: mediumText,
        concern: mediumText,
        question: mediumText,
        evidence: z.array(mediumText).min(1).max(4),
      }),
    )
    .max(8),
  questions: z
    .array(
      z.strictObject({
        question: mediumText,
        reason: mediumText,
        ownerHint: shortText,
        evidence: z.array(mediumText).min(1).max(4),
      }),
    )
    .max(8),
  participantAgents: z.strictObject({
    views: z
      .array(
        z.strictObject({
          actor: shortText,
          role: shortText,
          priority: mediumText,
          interpretation: mediumText,
          evidence: z.array(mediumText).min(1).max(4),
          risk: mediumText,
        }),
      )
      .max(8),
    agreementPoints: z.array(mediumText).max(6),
    tensionPoints: z.array(mediumText).max(6),
    privacyNote: mediumText,
  }),
});

export function parseStructuredContextAnalysis(value) {
  return structuredContextAnalysisSchema.parse(value);
}
