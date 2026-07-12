type Status = "idle" | "loading" | "error";

const copy: Record<Status, { kicker: string; title: string; description: string }> = {
  idle: { kicker: "Ready for context", title: "분석을 시작해 주세요", description: "프로젝트 기록을 입력하거나 샘플을 불러오면 결과가 이곳에 표시됩니다." },
  loading: { kicker: "Connecting context", title: "맥락을 연결하고 있습니다", description: "결정 배경, 참여자 관점, 미해결 질문을 구조화하고 있습니다." },
  error: { kicker: "Analysis unavailable", title: "분석 결과를 표시하지 못했습니다", description: "입력을 확인하고 다시 시도해 주세요." },
};

function AnalysisPlaceholder({ status, message, surface }: { status: Status; message?: string | null; surface: "summary" | "workspace" }) {
  const text = copy[status];
  const id = `placeholder-${surface}-${status}`;
  const surfaceLabel = surface === "summary" ? "맥락 우선 미리보기" : "분석 결과 작업공간";
  return <section className={`${surface === "summary" ? "summary-panel" : "result-placeholder"} analysis-placeholder ${status}`} aria-label={`${surfaceLabel}: ${text.title}`} aria-live={status === "loading" ? "polite" : undefined} aria-busy={status === "loading"}><span className="placeholder-mark" aria-hidden="true" /><p className="section-kicker">{text.kicker}</p><h2 id={id}>{text.title}</h2><p>{message || text.description}</p></section>;
}

export default AnalysisPlaceholder;
