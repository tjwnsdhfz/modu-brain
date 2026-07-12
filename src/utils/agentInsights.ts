import type {
  AgentConfidence,
  ContextAnalysisResultV2,
  DecisionItem,
  DecisionLifecycleStatus,
  EvidenceRef,
} from "../types/context";

export type DecisionLifecycleItem = {
  id: string;
  status: DecisionLifecycleStatus;
  label: string;
  currentId?: string;
  previousId?: string;
  currentIndex?: number;
  previousIndex?: number;
  observedAt?: string;
  previousObservedAt?: string;
  changedFields: Array<"decision" | "reason" | "status">;
  agentConfidence?: AgentConfidence;
};

export type ContradictionCandidate = {
  id: string;
  leftDecisionId: string;
  rightDecisionId: string;
  leftLabel: string;
  rightLabel: string;
  reason: string;
  confidence: number;
  evidence: EvidenceRef[];
};

export type AgentInsights = {
  decisionLifecycle: DecisionLifecycleItem[];
  contradictions: ContradictionCandidate[];
  counts: Record<DecisionLifecycleStatus, number>;
};

export type AgentInsightSnapshot = Pick<ContextAnalysisResultV2, "decisions" | "summary">;

const CONFLICT_PAIRS = [
  ["허용", "금지"],
  ["포함", "제외"],
  ["공개", "비공개"],
  ["유지", "삭제"],
  ["진행", "중단"],
  ["도입", "폐기"],
  ["사용", "미사용"],
  ["활성화", "비활성화"],
  ["enable", "disable"],
  ["allow", "forbid"],
] as const;

const NEGATION_PATTERN = /(?:하지\s*않|하지\s*말|않(?:는|기로|는다|다)?|아니|금지|제외|중단|취소|폐기|비공개|비활성화|미사용|없(?:는|다)?|\b(?:no|not|never|without|disable|forbid)\b)/giu;

export function deriveAgentInsights(
  previous: AgentInsightSnapshot | undefined,
  latest: AgentInsightSnapshot,
): AgentInsights {
  const decisionLifecycle = deriveDecisionLifecycle(previous, latest);
  const contradictions = detectContradictionCandidates(latest);
  const counts: Record<DecisionLifecycleStatus, number> = {
    new: 0,
    changed: 0,
    stable: 0,
    resolved: 0,
  };
  decisionLifecycle.forEach((item) => {
    counts[item.status] += 1;
  });
  return { decisionLifecycle, contradictions, counts };
}

export function deriveDecisionLifecycle(
  previous: AgentInsightSnapshot | undefined,
  latest: AgentInsightSnapshot,
): DecisionLifecycleItem[] {
  const before = previous?.decisions ?? [];
  const after = latest.decisions ?? [];
  const usedBefore = new Set<number>();
  const lifecycle: DecisionLifecycleItem[] = [];

  after.forEach((current, currentIndex) => {
    const match = findPreviousDecision(current, before, usedBefore);
    if (!match) {
      lifecycle.push(toLifecycleItem(current, currentIndex, latest, "new"));
      return;
    }
    usedBefore.add(match.index);
    const changedFields = changedDecisionFields(match.item, current);
    lifecycle.push({
      ...toLifecycleItem(current, currentIndex, latest, changedFields.length > 0 ? "changed" : "stable"),
      previousId: decisionIdentity(match.item, match.index),
      previousIndex: match.index,
      previousObservedAt: previous?.summary.generatedAt,
      changedFields,
    });
  });

  before.forEach((item, previousIndex) => {
    if (usedBefore.has(previousIndex)) return;
    lifecycle.push({
      id: decisionIdentity(item, previousIndex),
      status: "resolved",
      label: item.decision,
      previousId: decisionIdentity(item, previousIndex),
      previousIndex,
      previousObservedAt: previous?.summary.generatedAt,
      changedFields: [],
      agentConfidence: item.agentConfidence,
    });
  });
  return lifecycle;
}

export function detectContradictionCandidates(
  result: Pick<ContextAnalysisResultV2, "decisions">,
): ContradictionCandidate[] {
  const candidates: ContradictionCandidate[] = [];
  for (let leftIndex = 0; leftIndex < result.decisions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < result.decisions.length; rightIndex += 1) {
      const left = result.decisions[leftIndex];
      const right = result.decisions[rightIndex];
      const conflict = contradictionReason(left.decision, right.decision);
      if (!conflict) continue;
      const leftDecisionId = decisionIdentity(left, leftIndex);
      const rightDecisionId = decisionIdentity(right, rightIndex);
      candidates.push({
        id: `contradiction_${stableKey([leftDecisionId, rightDecisionId].sort().join("\u0000"))}`,
        leftDecisionId,
        rightDecisionId,
        leftLabel: left.decision,
        rightLabel: right.decision,
        reason: conflict.reason,
        confidence: conflict.confidence,
        evidence: uniqueEvidence([...(left.evidence ?? []), ...(right.evidence ?? [])]),
      });
    }
  }
  return candidates;
}

function findPreviousDecision(
  current: DecisionItem,
  previous: DecisionItem[],
  used: Set<number>,
) {
  const available = previous
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !used.has(index));
  const explicit = current.id
    ? available.find(({ item }) => item.id === current.id)
    : undefined;
  if (explicit) return explicit;

  const normalized = canonicalText(current.decision);
  const exact = available.find(({ item }) => canonicalText(item.decision) === normalized);
  if (exact) return exact;

  const similar = available
    .map((candidate) => ({
      ...candidate,
      similarity: textSimilarity(candidate.item.decision, current.decision),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0];
  return similar && similar.similarity >= 0.64 ? similar : undefined;
}

function toLifecycleItem(
  item: DecisionItem,
  currentIndex: number,
  result: AgentInsightSnapshot,
  status: DecisionLifecycleStatus,
): DecisionLifecycleItem {
  const id = decisionIdentity(item, currentIndex);
  return {
    id,
    status,
    label: item.decision,
    currentId: id,
    currentIndex,
    observedAt: result.summary.generatedAt,
    changedFields: [],
    agentConfidence: item.agentConfidence,
  };
}

function changedDecisionFields(previous: DecisionItem, latest: DecisionItem) {
  const changed: DecisionLifecycleItem["changedFields"] = [];
  if (canonicalText(previous.decision) !== canonicalText(latest.decision)) changed.push("decision");
  if (canonicalText(previous.reason) !== canonicalText(latest.reason)) changed.push("reason");
  if (previous.status !== latest.status) changed.push("status");
  return changed;
}

function contradictionReason(left: string, right: string) {
  for (const [positive, negative] of CONFLICT_PAIRS) {
    const leftOrientation = orientation(left, positive, negative);
    const rightOrientation = orientation(right, positive, negative);
    if (leftOrientation === 0 || rightOrientation === 0 || leftOrientation === rightOrientation) continue;
    const leftContext = removeTerms(left, positive, negative);
    const rightContext = removeTerms(right, positive, negative);
    const contextSimilarity = textSimilarity(leftContext, rightContext);
    if (contextSimilarity >= 0.32 && hasSharedContextToken(leftContext, rightContext)) {
      return {
        reason: `같은 맥락에서 '${positive}'와 '${negative}'가 함께 감지되었습니다. 원문 근거를 확인해 주세요.`,
        confidence: Math.min(0.95, Math.round((0.72 + contextSimilarity * 0.2) * 100) / 100),
      };
    }
  }

  const leftNegative = hasNegation(left);
  const rightNegative = hasNegation(right);
  if (leftNegative === rightNegative) return undefined;
  const similarity = textSimilarity(stripNegation(left), stripNegation(right));
  if (similarity < 0.7) return undefined;
  return {
    reason: "매우 비슷한 결정 문장에서 상반된 부정 표현이 감지되었습니다. 확정 전에 원문 근거를 확인해 주세요.",
    confidence: Math.min(0.88, Math.round((0.55 + similarity * 0.28) * 100) / 100),
  };
}

function orientation(value: string, positive: string, negative: string) {
  const normalized = value.toLocaleLowerCase("ko-KR");
  if (normalized.includes(negative)) return -1;
  if (normalized.includes(positive)) return 1;
  return 0;
}

function removeTerms(value: string, ...terms: string[]) {
  return terms.reduce(
    (current, term) => current.split(term).join(" "),
    value.toLocaleLowerCase("ko-KR"),
  );
}

function hasSharedContextToken(left: string, right: string) {
  const ignored = new Set(["mvp", "기능", "기능은", "기능을", "한다", "하기로", "결정", "결정한다"]);
  const tokens = (value: string) => new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .split(/[^\p{L}\p{N}]+/gu)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !ignored.has(item)),
  );
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  return [...leftTokens].some((item) => rightTokens.has(item));
}

function hasNegation(value: string) {
  NEGATION_PATTERN.lastIndex = 0;
  return NEGATION_PATTERN.test(value);
}

function stripNegation(value: string) {
  NEGATION_PATTERN.lastIndex = 0;
  return value.replace(NEGATION_PATTERN, " ");
}

function decisionIdentity(item: DecisionItem, index: number) {
  return item.id || `decision_${stableKey(canonicalText(item.decision) || String(index))}`;
}

function textSimilarity(left: string, right: string) {
  const leftValue = canonicalText(left);
  const rightValue = canonicalText(right);
  if (!leftValue || !rightValue) return 0;
  if (leftValue === rightValue) return 1;
  const leftParts = ngrams(leftValue, 2);
  const rightParts = ngrams(rightValue, 2);
  let overlap = 0;
  leftParts.forEach((value) => {
    if (rightParts.has(value)) overlap += 1;
  });
  return (2 * overlap) / (leftParts.size + rightParts.size);
}

function ngrams(value: string, size: number) {
  if (value.length <= size) return new Set([value]);
  return new Set(Array.from({ length: value.length - size + 1 }, (_, index) => (
    value.slice(index, index + size)
  )));
}

function canonicalText(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uniqueEvidence(items: EvidenceRef[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sourceRecordId}\u0000${item.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
