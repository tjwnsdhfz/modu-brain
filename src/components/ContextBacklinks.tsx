import { useMemo } from "react";
import type { ContextAnalysisResultV2, EvidenceRef } from "../types/context";
import type { ExternalContextProvider, SourceRecordListResource } from "../types/platform";
import styles from "./ContextBacklinks.module.css";

type ContextBacklinksProps = {
  sources: SourceRecordListResource[];
  result: ContextAnalysisResultV2;
  onOpenEvidence: (evidence: EvidenceRef[]) => void;
};

type Backlink = {
  label: string;
  evidence: EvidenceRef[];
};

function ContextBacklinks({ sources, result, onOpenEvidence }: ContextBacklinksProps) {
  const backlinks = useMemo(() => collectBacklinks(result), [result]);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const linkedSources = [...backlinks.entries()].map(([sourceId, items]) => {
    const current = sourceById.get(sourceId);
    const evidence = uniqueEvidence(items.flatMap((item) => item.evidence));
    return {
      source: current ?? {
        id: sourceId,
        title: "분석 당시 원문",
      },
      snapshotTitle: evidence[0]?.sourceTitle || current?.title || "분석 당시 원문",
      items,
      evidence,
      snapshotOnly: !current,
    };
  });

  return (
    <section className={styles.panel} aria-labelledby="context-backlinks-title">
      <div className={styles.heading}>
        <div>
          <p>Source backlinks</p>
          <h2 id="context-backlinks-title">원문 백링크</h2>
        </div>
        <span>{linkedSources.length}개 기록 연결</span>
      </div>
      <p className={styles.guide}>
        지식맵의 결정·질문·관점이 어떤 원문에서 나왔는지 역방향으로 확인합니다.
      </p>

      {linkedSources.length === 0 ? (
        <p className={styles.empty}>이 분석에서 확인할 수 있는 원문 백링크가 없습니다.</p>
      ) : (
        <div className={styles.list}>
          {linkedSources.map(({ source, snapshotTitle, items, evidence, snapshotOnly }) => {
            return (
              <article className={styles.card} key={source.id}>
                <header>
                  <div>
                    <span>
                      {"import" in source && source.import
                        ? providerLabel(source.import.provider)
                        : snapshotOnly
                          ? "분석 스냅숏"
                          : "직접 기록"}
                    </span>
                    <h3>{snapshotTitle}</h3>
                  </div>
                  <strong>{evidence.length}개 근거</strong>
                </header>
                <ul>
                  {items.slice(0, 5).map((item, index) => (
                    <li key={`${item.label}-${index}`}>{item.label}</li>
                  ))}
                  {items.length > 5 && <li className={styles.more}>외 {items.length - 5}개 연결</li>}
                </ul>
                <button
                  type="button"
                  aria-label={`${snapshotTitle} 원문 인용문 열기`}
                  onClick={() => onOpenEvidence(evidence)}
                >
                  원문 인용문 열기
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function collectBacklinks(result: ContextAnalysisResultV2) {
  const bySource = new Map<string, Backlink[]>();
  const add = (label: string, evidence: EvidenceRef[] | undefined) => {
    for (const ref of evidence ?? []) {
      const current = bySource.get(ref.sourceRecordId) ?? [];
      current.push({ label, evidence: [ref] });
      bySource.set(ref.sourceRecordId, current);
    }
  };

  result.decisions.forEach((item) => add(`결정 · ${item.decision}`, item.evidence));
  result.questions.forEach((item) => add(`질문 · ${item.question}`, item.evidence));
  result.participants.forEach((item) => add(`관점 · ${item.actor}`, item.evidence));
  result.keyTerms.forEach((item) => add(`용어 · ${item.term}`, item.evidence));
  result.knowledgeMap.nodes.forEach((item) => add(`지식맵 · ${item.label}`, item.evidence));
  return bySource;
}

function uniqueEvidence(evidence: EvidenceRef[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.sourceRecordId}\u0000${item.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function providerLabel(provider: ExternalContextProvider) {
  return {
    kakaotalk: "카카오톡",
    teams: "Teams",
    notion: "Notion",
    paste: "붙여넣기",
  }[provider] ?? "외부 기록";
}

export default ContextBacklinks;
