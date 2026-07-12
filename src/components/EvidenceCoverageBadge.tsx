type EvidenceCoverageBadgeProps = {
  evidenceCount: number;
  coveredItems?: number;
  totalItems?: number;
  label?: string;
  compact?: boolean;
};

function EvidenceCoverageBadge({
  evidenceCount,
  coveredItems,
  totalItems,
  label = "근거 연결",
  compact = false,
}: EvidenceCoverageBadgeProps) {
  const safeEvidenceCount = Math.max(0, evidenceCount);
  const hasCoverageRatio = typeof totalItems === "number";
  const safeTotal = Math.max(0, totalItems ?? 0);
  const safeCovered = Math.min(safeTotal, Math.max(0, coveredItems ?? 0));
  const state = !hasCoverageRatio || safeTotal === 0
    ? safeEvidenceCount > 0 ? "complete" : "empty"
    : safeCovered === safeTotal
      ? "complete"
      : safeCovered > 0
        ? "partial"
        : "empty";
  const stateLabel = state === "complete" ? "전체 연결" : state === "partial" ? "일부 연결" : "연결 없음";
  const text = hasCoverageRatio
    ? safeTotal === 0
      ? `${label} 항목 없음`
      : `${label} ${stateLabel} · ${safeCovered}/${safeTotal} · 인용 ${safeEvidenceCount}개`
    : `${label} ${safeEvidenceCount}개`;

  return (
    <span
      className={`evidence-coverage-badge ${state}${compact ? " compact" : ""}`}
      aria-label={text}
      title={text}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M7.8 12.2 12.2 7.8M6.1 14.8H5a3.8 3.8 0 0 1 0-7.6h2.2M12.8 7.2H15a3.8 3.8 0 1 1 0 7.6h-2.2" />
      </svg>
      <span>{compact ? `${label} ${safeEvidenceCount}개` : text}</span>
    </span>
  );
}

export default EvidenceCoverageBadge;
