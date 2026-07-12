import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import AnalysisPlaceholder from "../components/AnalysisPlaceholder";
import ContextImportPanel, { type ContextImportInput } from "../components/ContextImportPanel";
import DecisionList from "../components/DecisionList";
import KeyTerms from "../components/KeyTerms";
import KnowledgeMap from "../components/KnowledgeMap";
import OnboardingSummary from "../components/OnboardingSummary";
import ParticipantAgentPanel from "../components/ParticipantAgentPanel";
import PerspectiveTable from "../components/PerspectiveTable";
import QuestionList from "../components/QuestionList";
import SummaryPanel from "../components/SummaryPanel";
import { sampleAnalysis, sampleInput } from "../data/sampleAnalysis";
import type { Navigate } from "../hooks/useRoute";
import {
  ContextAnalysisRequestError,
  analyzeImportedContext,
} from "../services/analyzeContext";
import { trackProductEvent } from "../services/productTelemetry";
import type { ContextAnalysisResult } from "../types/context";

type ResultTab = "overview" | "map" | "onboarding";
type AnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "sample" | "success"; result: ContextAnalysisResult };

function LandingPage({ navigate, initialDemo = false }: { navigate: Navigate; initialDemo?: boolean }) {
  const [composerInput, setComposerInput] = useState<ContextImportInput | undefined>(
    initialDemo
      ? { provider: "paste", title: sampleAnalysis.projectTitle, text: sampleInput }
      : undefined,
  );
  const [composerRevision, setComposerRevision] = useState(0);
  const [analysisState, setAnalysisState] = useState<AnalysisState>(
    initialDemo ? { status: "sample", result: sampleAnalysis } : { status: "idle" },
  );
  const [activeTab, setActiveTab] = useState<ResultTab>("overview");
  const requestVersion = useRef(0);
  const activeAbortController = useRef<AbortController | null>(null);
  const previousDemoRoute = useRef(initialDemo);

  useEffect(() => () => activeAbortController.current?.abort(), []);

  useEffect(() => {
    if (previousDemoRoute.current === initialDemo) return;
    previousDemoRoute.current = initialDemo;
    activeAbortController.current?.abort();
    activeAbortController.current = null;
    requestVersion.current += 1;
    setComposerInput(initialDemo
      ? { provider: "paste", title: sampleAnalysis.projectTitle, text: sampleInput }
      : undefined);
    setComposerRevision((revision) => revision + 1);
    setAnalysisState(initialDemo
      ? { status: "sample", result: sampleAnalysis }
      : { status: "idle" });
    setActiveTab("overview");
  }, [initialDemo]);

  useEffect(() => {
    if (!initialDemo) return undefined;
    trackProductEvent("demo_opened", { sampleReady: true });
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("prototype")?.scrollIntoView?.({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialDemo]);

  const analysisResult =
    analysisState.status === "sample" || analysisState.status === "success"
      ? analysisState.result
      : null;
  const error = analysisState.status === "error" ? analysisState.message : null;

  const clearForEdit = () => {
    activeAbortController.current?.abort();
    activeAbortController.current = null;
    requestVersion.current += 1;
    setAnalysisState({ status: "idle" });
    setActiveTab("overview");
  };

  const loadSample = (entryPoint: "hero" | "input" = "input") => {
    clearForEdit();
    setComposerInput({
      provider: "paste",
      title: sampleAnalysis.projectTitle,
      text: sampleInput,
    });
    setComposerRevision((revision) => revision + 1);
    setAnalysisState({ status: "sample", result: sampleAnalysis });
    trackProductEvent("sample_loaded", { entryPoint });
  };

  const experienceSample = () => {
    loadSample("hero");
    if (window.location.pathname !== "/demo") navigate("/demo");
    window.requestAnimationFrame(() => {
      const target = document.getElementById("prototype");
      if (!target?.scrollIntoView) return;
      const prefersReducedMotion = typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const startWithOwnContext = () => {
    document.getElementById("prototype")?.scrollIntoView({ block: "start" });
    window.requestAnimationFrame(() => document.getElementById("public-context-text")?.focus());
  };

  const importAndAnalyze = async (input: ContextImportInput) => {
    activeAbortController.current?.abort();
    const controller = new AbortController();
    activeAbortController.current = controller;
    const version = ++requestVersion.current;
    setAnalysisState({ status: "loading" });
    setActiveTab("overview");
    trackProductEvent("analysis_started", {
      mode: "public-import",
      inputCharacters: input.text.length,
    });

    try {
      const imported = await analyzeImportedContext(input, { signal: controller.signal });
      if (requestVersion.current !== version) return;
      setAnalysisState({ status: "success", result: imported.result });
      trackProductEvent("analysis_succeeded", { provider: imported.result.provider.name });
    } catch (requestError) {
      if (controller.signal.aborted || requestVersion.current !== version) return;
      const message = getErrorMessage(requestError);
      setAnalysisState({ status: "error", message });
      trackProductEvent("analysis_failed", {
        code: requestError instanceof ContextAnalysisRequestError
          ? requestError.code
          : "UNEXPECTED_ERROR",
      });
      throw requestError;
    } finally {
      if (activeAbortController.current === controller) activeAbortController.current = null;
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: ResultTab) => {
    if (!analysisResult) return;
    const tabs: ResultTab[] = ["overview", "map", "onboarding"];
    const current = tabs.indexOf(tab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[next]);
    document.getElementById(`landing-tab-${tabs[next]}`)?.focus();
  };

  const badge =
    analysisState.status === "loading"
      ? "분석 중"
      : analysisState.status === "success"
        ? `${analysisState.result.provider.name} 분석 결과`
        : analysisState.status === "error"
          ? "분석 오류"
          : analysisState.status === "sample"
            ? "샘플 데이터"
            : "분석 대기";

  return (
    <main className="app-shell landing-shell">
      {initialDemo && (
        <section className="public-demo-banner" aria-labelledby="public-demo-title">
          <div>
            <p className="section-kicker">Public demo</p>
            <h1 id="public-demo-title">로그인 없이 확인하는 근거 기반 맥락 분석</h1>
            <p>사전 구성된 기록과 결과입니다. 이 화면에서 실행한 분석은 계정이나 데이터베이스에 저장되지 않습니다.</p>
          </div>
          <button className="button secondary" type="button" onClick={() => navigate("/login")}>
            내 프로젝트로 저장
          </button>
        </section>
      )}
      {!initialDemo && (
        <>
      <section className="hero" id="top">
        <div className="hero-stickers" aria-hidden="true">
          <span className="sticker sky" />
          <span className="sticker purple" />
          <span className="sticker pink" />
          <span className="sticker orange" />
        </div>
        <div className="hero-message">
          <p className="eyebrow">어디서 회의했든, 한 장의 맥락으로</p>
          <h1>결론보다 오래 남아야 할 이유를 연결합니다.</h1>
          <p className="hero-copy">
            카카오톡, Teams, Notion, 메모에 흩어진 기록을 계정 연결 없이 가져와
            사람별 관점, 열린 질문, 결정의 실제 근거로 정리합니다.
          </p>
          <ul className="integration-pills" aria-label="지원하는 기록 형식">
            <li>카카오톡 TXT</li>
            <li>Teams JSON</li>
            <li>Notion JSON</li>
            <li>일반 텍스트</li>
          </ul>
          <div className="hero-actions">
            <button className="button primary" type="button" onClick={startWithOwnContext}>내 기록 바로 정리</button>
            <button className="button secondary" type="button" onClick={experienceSample}>샘플 직접 체험</button>
            <button className="text-button hero-login" type="button" onClick={() => navigate("/login")}>저장하며 사용하기</button>
          </div>
        </div>

        <aside className="hero-context-card" aria-labelledby="hero-context-title">
          <div className="hero-context-heading">
            <div>
              <p className="section-kicker">Current context</p>
              <h2 id="hero-context-title">지금 팀이 놓치기 쉬운 것</h2>
            </div>
            <span>근거 7개</span>
          </div>
          <ol className="hero-context-list">
            <li>
              <span>01</span>
              <div><strong>관점 차이</strong><p>근거 공개를 먼저 할지, 시연 속도를 먼저 확보할지 의견이 갈립니다.</p></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>미결 질문</strong><p>읽기 전용 공유에서 어떤 분석 정보까지 보여줄까요?</p></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>결정 배경</strong><p>개인 계정 연결 없이 사용자가 선택한 자료만 가져오기로 했습니다.</p></div>
            </li>
          </ol>
        </aside>
      </section>

      <section className="workflow" aria-label="Modu Brain 작동 흐름">
        <div><span>01</span><strong>기록 축적</strong><p>회의·리서치·피드백을 프로젝트별로 안전하게 모읍니다.</p></div>
        <div><span>02</span><strong>맥락 분석</strong><p>결정, 관점, 질문을 원문 근거와 함께 구조화합니다.</p></div>
        <div><span>03</span><strong>변화와 공유</strong><p>분석 이력을 비교하고 읽기 전용 링크로 온보딩합니다.</p></div>
      </section>
        </>
      )}

      <section className="section-intro" id="prototype">
        <p className="section-kicker">Open workspace</p>
        <h2>로그인 없이 붙여넣고, 파일을 열고, 바로 분석하세요</h2>
        <p>공개 체험의 입력과 결과는 저장되지 않습니다. 프로젝트 보관과 읽기 전용 공유가 필요할 때만 로그인하면 됩니다.</p>
      </section>

      <div className="public-import-workspace">
        <ContextImportPanel
          key={`public-context-composer-${composerRevision}`}
          mode="ephemeral"
          initialInput={composerInput}
          textareaId="public-context-text"
          onImport={importAndAnalyze}
        />
      </div>

      <div className="public-analysis-summary">
        {analysisResult ? <ContextPriorityPreview result={analysisResult} /> : (
          <AnalysisPlaceholder
            status={analysisState.status === "loading" || analysisState.status === "error" ? analysisState.status : "idle"}
            message={error}
            surface="summary"
          />
        )}
      </div>

      <section className="result-workspace" aria-labelledby="landing-results-heading">
        <div className="result-header">
          <div>
            <p className="section-kicker">Result view</p>
            <h2 id="landing-results-heading">분석 결과</h2>
            <span className={`demo-badge ${analysisState.status}`}>{badge}</span>
          </div>
          <div className="tab-list" role="tablist" aria-label="결과 보기 방식">
            {(["overview", "map", "onboarding"] as ResultTab[]).map((tab) => (
              <button
                id={`landing-tab-${tab}`}
                key={tab}
                className={activeTab === tab ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={analysisResult ? `landing-panel-${tab}` : undefined}
                tabIndex={activeTab === tab ? 0 : -1}
                disabled={!analysisResult}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
              >
                {{ overview: "개요", map: "지식맵", onboarding: "온보딩 요약" }[tab]}
              </button>
            ))}
          </div>
        </div>

        {!analysisResult ? (
          <AnalysisPlaceholder
            status={analysisState.status === "loading" || analysisState.status === "error" ? analysisState.status : "idle"}
            message={error}
            surface="workspace"
          />
        ) : activeTab === "overview" ? (
          <div className="results-grid overview-grid" id="landing-panel-overview" role="tabpanel" aria-labelledby="landing-tab-overview">
            <PerspectiveTable participants={analysisResult.participants} />
            <ParticipantAgentPanel synthesis={analysisResult.participantAgents} />
            <QuestionList questions={analysisResult.questions} />
            <DecisionList decisions={analysisResult.decisions} />
            <SummaryPanel result={analysisResult} />
            <KeyTerms terms={analysisResult.keyTerms} />
          </div>
        ) : activeTab === "map" ? (
          <div className="results-grid single-grid" id="landing-panel-map" role="tabpanel" aria-labelledby="landing-tab-map">
            <KnowledgeMap result={analysisResult} />
          </div>
        ) : (
          <div className="results-grid single-grid" id="landing-panel-onboarding" role="tabpanel" aria-labelledby="landing-tab-onboarding">
            <OnboardingSummary summary={analysisResult.onboardingSummary} />
          </div>
        )}
      </section>
    </main>
  );
}

function ContextPriorityPreview({ result }: { result: ContextAnalysisResult }) {
  const signals = [
    {
      label: "관점 차이",
      count: result.participants.length,
      detail: result.participants[0]?.concern ?? "구분된 참여자 관점이 없습니다.",
    },
    {
      label: "미결 질문",
      count: result.questions.length,
      detail: result.questions[0]?.question ?? "명시적으로 남은 질문이 없습니다.",
    },
    {
      label: "결정 배경",
      count: result.decisions.length,
      detail: result.decisions[0]?.reason ?? "확인된 결정 배경이 없습니다.",
    },
  ];

  return (
    <section className="context-priority-preview" aria-labelledby="context-priority-title">
      <div className="panel-heading compact">
        <p className="section-kicker">Context first</p>
        <h2 id="context-priority-title">요약 전에 확인할 맥락</h2>
        <p>팀의 판단이 갈리는 지점과 다음 대화를 먼저 보여줍니다.</p>
      </div>
      <ol className="priority-preview-list">
        {signals.map((signal, index) => (
          <li key={signal.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{signal.label}</strong><p>{signal.detail}</p></div>
            <b>{signal.count}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof ContextAnalysisRequestError || error instanceof Error) return error.message;
  return "알 수 없는 분석 오류가 발생했습니다.";
}

export default LandingPage;
