import type { ContextAnalysisResultV2 } from "../types/context";

export type ComparisonItem = {
  id: string;
  label: string;
  kind: "added" | "changed" | "resolved";
};

type SnapshotItem = { id: string; label: string; fingerprint: string };

export function compareAnalyses(
  previous?: ContextAnalysisResultV2,
  latest?: ContextAnalysisResultV2,
): ComparisonItem[] {
  if (!previous || !latest) return [];
  const before = toSnapshot(previous);
  const after = toSnapshot(latest);
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const changes: ComparisonItem[] = [];

  for (const item of after) {
    const old = beforeById.get(item.id);
    if (!old) changes.push({ id: item.id, label: item.label, kind: "added" });
    else if (old.fingerprint !== item.fingerprint) {
      changes.push({ id: item.id, label: item.label, kind: "changed" });
    }
  }
  for (const item of before) {
    if (!afterById.has(item.id)) {
      changes.push({ id: item.id, label: item.label, kind: "resolved" });
    }
  }
  return changes;
}

function toSnapshot(result: ContextAnalysisResultV2): SnapshotItem[] {
  return [
    ...result.decisions.map((item) => ({
      id: `decision:${stableKey(canonicalText(item.decision))}`,
      label: item.decision,
      fingerprint: JSON.stringify([
        canonicalText(item.decision),
        canonicalText(item.reason),
        item.status,
      ]),
    })),
    ...result.questions.map((item) => ({
      id: `question:${stableKey(canonicalText(item.question))}`,
      label: item.question,
      fingerprint: JSON.stringify([
        canonicalText(item.question),
        canonicalText(item.reason),
        canonicalText(item.ownerHint),
      ]),
    })),
    ...result.participants.map((item) => ({
      id: `perspective:${stableKey(canonicalText(item.actor))}`,
      label: `관점 · ${item.actor}`,
      fingerprint: JSON.stringify([
        canonicalText(item.actor),
        canonicalText(item.role),
        canonicalText(item.focus),
        canonicalText(item.concern),
        canonicalText(item.question),
      ]),
    })),
  ];
}

function canonicalText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
