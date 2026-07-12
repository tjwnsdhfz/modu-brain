import { useState } from "react";
import type { OnboardingSummary as Summary } from "../types/context";

function OnboardingSummary({ summary }: { summary: Summary }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const copyShareText = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(summary.shareText);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section className="result-panel onboarding-summary" aria-labelledby="onboarding-title">
      <div className="panel-heading compact">
        <p className="section-kicker">For new teammates</p>
        <h2 id="onboarding-title">새 팀원 온보딩 요약</h2>
        <p>현재 결정과 아직 열린 질문부터 읽으면 프로젝트의 다음 행동을 빠르게 이해할 수 있습니다.</p>
      </div>
      <div className="onboarding-status-grid">
        <section aria-labelledby="onboarding-decisions-title">
          <h3 id="onboarding-decisions-title">현재 확정된 결정</h3>
          {summary.currentDecisions.length > 0 ? (
            <ul>{summary.currentDecisions.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>명시적으로 확정된 결정이 없습니다.</p>}
        </section>
        <section aria-labelledby="onboarding-questions-title">
          <h3 id="onboarding-questions-title">아직 열린 질문</h3>
          {summary.remainingQuestions.length > 0 ? (
            <ul>{summary.remainingQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>현재 남아 있는 질문이 없습니다.</p>}
        </section>
      </div>
      <div className="onboarding-background">
        <h3>알아야 할 배경</h3>
        <ol className="onboarding-list">{summary.items.map((item) => <li key={item}>{item}</li>)}</ol>
      </div>
      <div className="onboarding-share">
        <div><strong>바로 공유할 문장</strong><p>{summary.shareText}</p></div>
        <button className="button secondary" type="button" onClick={() => void copyShareText()}>문장 복사</button>
      </div>
      <p className={`copy-status ${copyState}`} aria-live="polite">
        {copyState === "copied" ? "공유 문장을 복사했습니다." : copyState === "error" ? "자동 복사가 지원되지 않습니다. 문장을 직접 선택해 주세요." : ""}
      </p>
    </section>
  );
}

export default OnboardingSummary;
