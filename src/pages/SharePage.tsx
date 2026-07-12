import { useEffect, useState } from "react";
import DecisionList from "../components/DecisionList";
import KnowledgeMap from "../components/KnowledgeMap";
import OnboardingSummary from "../components/OnboardingSummary";
import ParticipantAgentPanel from "../components/ParticipantAgentPanel";
import PerspectiveTable from "../components/PerspectiveTable";
import QuestionList from "../components/QuestionList";
import SummaryPanel from "../components/SummaryPanel";
import type { PlatformApi } from "../services/platformApi";
import type { SharedAnalysisResource } from "../types/platform";

function SharePage({ api }: { api: PlatformApi }) {
  const shareToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  const [shared, setShared] = useState<SharedAnalysisResource | null>(null);
  const [error, setError] = useState<string | null>(
    shareToken ? null : "공유 토큰이 없습니다. 전달받은 링크 전체를 다시 열어 주세요.",
  );
  const [loading, setLoading] = useState(Boolean(shareToken));

  useEffect(() => {
    if (!shareToken) return undefined;

    let active = true;
    api.resolveSharedAnalysis(shareToken)
      .then((result) => { if (active) setShared(result); })
      .catch((resolveError) => { if (active) setError(resolveError instanceof Error ? resolveError.message : "공유 분석을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, shareToken]);

  if (loading) return <main className="app-page"><div className="loading-card page-loader" role="status">공유 분석을 불러오는 중…</div></main>;
  if (error || !shared?.result) {
    return <main className="narrow-page"><section className="auth-card"><p className="section-kicker">Share unavailable</p><h1>공유 내용을 열 수 없습니다</h1><div className="notice error" role="alert">{error ?? "공유 결과가 없거나 링크가 만료되었습니다."}</div><div className="auth-choice-row"><a className="button primary" href="/demo">공개 데모 열기</a><a className="button secondary" href="/">홈으로 이동</a></div></section></main>;
  }

  const result = shared.result;
  return (
    <main className="app-page shared-page">
      <header className="shared-heading">
        <div><p className="section-kicker">Read-only onboarding</p><h1>{shared.projectTitle}</h1><p>읽기 전용 분석 · {formatDate(shared.completedAt)}</p></div>
        <span className="read-only-badge">수정 불가</span>
      </header>
      <div className="notice warning" role="note" aria-label="공유 개인정보 주의">
        분석 결과의 근거 인용문에는 입력 원문의 일부, 사람 이름 또는 개인정보가 남아 있을 수 있습니다.
        링크를 다시 전달하기 전에 아래 내용을 확인해 주세요. 원문 전체와 계정 이메일은 표시하지 않습니다.
      </div>
      <div className="results-grid overview-grid">
        <SummaryPanel result={result} />
        <DecisionList decisions={result.decisions} />
        <QuestionList questions={result.questions} />
        <PerspectiveTable participants={result.participants} />
        <ParticipantAgentPanel synthesis={result.participantAgents} />
        <OnboardingSummary summary={result.onboardingSummary} />
        <KnowledgeMap result={result} />
      </div>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(date);
}

export default SharePage;
