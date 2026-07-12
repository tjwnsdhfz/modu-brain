import { ApiError } from "./apiErrors.mjs";
import { sha256 } from "./security.mjs";

export function buildContextAnalysisResultV2(result, snapshots) {
  validateClaimedEvidence(result, snapshots);
  const evidenceFor = (hints = []) => {
    const reference = findEvidence(snapshots, hints);
    return reference ? [reference] : [];
  };
  const originalViews = result.participantAgents?.views || [];
  const viewEvidenceByActor = new Map(
    originalViews.map((view) => [normalizeIdentity(view.actor), view.evidence || []]),
  );
  const enrich = (items, type, identityFor, hintsFor) => {
    const occurrences = new Map();
    return (items || []).map((item) => {
      const identity = normalizeIdentity(identityFor(item));
      const duplicateIndex = occurrences.get(identity) || 0;
      occurrences.set(identity, duplicateIndex + 1);
      return {
        ...item,
        id: stableItemId(type, identity, duplicateIndex),
        evidence: evidenceFor(hintsFor(item)),
      };
    });
  };

  const decisions = enrich(
    result.decisions,
    "decision",
    (item) => item.decision,
    (item) => [...(item.evidence || []), item.decision, item.reason],
  );
  const participants = enrich(
    result.participants,
    "participant",
    (item) => item.actor,
    (item) => [
      ...(viewEvidenceByActor.get(normalizeIdentity(item.actor)) || []),
      ...(item.evidence || []),
      item.focus,
      item.concern,
      item.question,
    ],
  );
  const questions = enrich(
    result.questions,
    "question",
    (item) => item.question,
    (item) => [...(item.evidence || []), item.question, item.reason],
  );
  const keyTerms = enrich(
    result.keyTerms,
    "term",
    (item) => item.term,
    (item) => [item.term, item.meaning],
  );
  const originalNodes = result.knowledgeMap?.nodes || [];
  const nodes = enrich(
    originalNodes,
    "node",
    (node) => `${node.type || "node"}:${node.label || node.summary || "unknown"}`,
    (node) => [node.summary, node.label],
  );
  const nodeIdMap = new Map(originalNodes.map((node, index) => [node.id, nodes[index].id]));
  const knowledgeMap = {
    ...(result.knowledgeMap || { nodes: [], links: [] }),
    nodes,
    links: (result.knowledgeMap?.links || []).map((link) => ({
      ...link,
      from: nodeIdMap.get(link.from) || link.from,
      to: nodeIdMap.get(link.to) || link.to,
    })),
  };
  const viewOccurrences = new Map();
  const participantAgents = {
    ...(result.participantAgents || {}),
    views: originalViews.map((view) => {
      const identity = normalizeIdentity(view.actor);
      const duplicateIndex = viewOccurrences.get(identity) || 0;
      viewOccurrences.set(identity, duplicateIndex + 1);
      return {
        ...view,
        id: stableItemId("view", identity, duplicateIndex),
        evidenceRefs: evidenceFor([
          ...(view.evidence || []),
          view.priority,
          view.interpretation,
        ]),
      };
    }),
  };

  const enriched = {
    ...result,
    schemaVersion: "2.0",
    keyTerms,
    decisions,
    participants,
    questions,
    knowledgeMap,
    participantAgents,
  };
  validateEvidenceReferences(enriched, snapshots);
  return enriched;
}

export function validateEvidenceReferences(result, snapshots) {
  const byId = new Map(snapshots.map((item) => [item.source_record_id, item]));
  walk(result, (reference) => {
    const snapshot = byId.get(reference.sourceRecordId);
    if (!snapshot || !String(snapshot.content_snapshot || "").includes(reference.quote)) {
      throw new ApiError(
        502,
        "EVIDENCE_VALIDATION_FAILED",
        "분석 결과의 근거가 선택한 원문과 일치하지 않습니다.",
      );
    }
  });
  return true;
}

function validateClaimedEvidence(result, snapshots) {
  const claimed = [
    ...(result.decisions || []),
    ...(result.participants || []),
    ...(result.questions || []),
    ...(result.participantAgents?.views || []),
  ].flatMap((item) => item.evidence || []);
  const contents = snapshots.map((snapshot) => String(snapshot.content_snapshot || ""));
  if (
    claimed.some(
      (quote) => typeof quote !== "string" || !contents.some((text) => text.includes(quote)),
    )
  ) {
    throw new ApiError(
      502,
      "EVIDENCE_VALIDATION_FAILED",
      "분석 결과의 근거가 선택한 원문과 일치하지 않습니다.",
    );
  }
}

function findEvidence(snapshots, hints) {
  for (const hint of hints.filter(Boolean).map((value) => String(value).trim())) {
    if (hint.length < 4) continue;
    for (const snapshot of snapshots) {
      const content = String(snapshot.content_snapshot || "");
      const direct = content.indexOf(hint);
      if (direct >= 0) return reference(snapshot, content.slice(direct, direct + hint.length));
    }
  }
  return null;
}

function reference(snapshot, quote) {
  return {
    sourceRecordId: snapshot.source_record_id,
    sourceTitle: snapshot.source_title,
    quote,
  };
}

function stableItemId(type, identity, duplicateIndex) {
  const duplicateSuffix = duplicateIndex > 0 ? `:${duplicateIndex}` : "";
  return `${type}_${sha256(`${type}:${identity}${duplicateSuffix}`).slice(0, 16)}`;
}

function normalizeIdentity(value) {
  return String(value || "unknown").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (
    typeof value.sourceRecordId === "string" &&
    typeof value.sourceTitle === "string" &&
    typeof value.quote === "string"
  ) {
    visit(value);
    return;
  }
  for (const item of Object.values(value)) walk(item, visit);
}
