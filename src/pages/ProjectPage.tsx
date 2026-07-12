import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import AnalysisComparison from "../components/AnalysisComparison";
import AnalysisFeedbackPanel from "../components/AnalysisFeedbackPanel";
import AgentExecutionRail from "../components/AgentExecutionRail";
import ContextBacklinks from "../components/ContextBacklinks";
import ContextImportPanel, {
  type ContextImportInput as ContextImportPanelInput,
} from "../components/ContextImportPanel";
import DecisionList from "../components/DecisionList";
import EvidenceDrawer from "../components/EvidenceDrawer";
import KeyTerms from "../components/KeyTerms";
import KnowledgeMap from "../components/KnowledgeMap";
import OnboardingSummary from "../components/OnboardingSummary";
import ParticipantAgentPanel from "../components/ParticipantAgentPanel";
import PerspectiveTable from "../components/PerspectiveTable";
import QuestionList from "../components/QuestionList";
import SummaryPanel from "../components/SummaryPanel";
import type { Navigate } from "../hooks/useRoute";
import { PlatformApiError, type PlatformApi } from "../services/platformApi";
import { trackProductEvent } from "../services/productTelemetry";
import type { EvidenceRef } from "../types/context";
import type {
  AnalysisMode,
  AnalysisRunAnnotationResource,
  AnalysisRunResource,
  AnalysisRunStepEventResource,
  CreateAnalysisRunAnnotationInput,
  CursorPageMetadata,
  ExternalContextProvider,
  ProjectResource,
  ShareLinkResource,
  SourceKind,
  SourceRecordListResource,
  SourceRecordResource,
  SourceSegmentResource,
} from "../types/platform";

type ProjectTab = "overview" | "map" | "onboarding";
type OverviewView = "analysis" | "records" | "history";

type ProjectPageProps = {
  api: PlatformApi;
  token: string;
  projectId: string;
  navigate: Navigate;
};

const sourceKindLabels: Record<SourceKind, string> = {
  meeting: "회의록",
  research: "리서치",
  feedback: "피드백",
  note: "메모",
};

const importProviderLabels: Record<ExternalContextProvider, string> = {
  kakaotalk: "카카오톡",
  teams: "Teams",
  notion: "Notion",
  paste: "붙여넣기",
};

const completedPage: CursorPageMetadata = {
  limit: 50,
  count: 0,
  hasMore: false,
  nextCursor: null,
};

function ProjectPage({ api, token, projectId, navigate }: ProjectPageProps) {
  const [project, setProject] = useState<ProjectResource | null>(null);
  const [sources, setSources] = useState<SourceRecordListResource[]>([]);
  const [runs, setRuns] = useState<AnalysisRunResource[]>([]);
  const [sourcePage, setSourcePage] = useState<CursorPageMetadata>(completedPage);
  const [runPage, setRunPage] = useState<CursorPageMetadata>(completedPage);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [loadingMoreSources, setLoadingMoreSources] = useState(false);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>(() => readProjectViewState().tab);
  const [overviewView, setOverviewView] = useState<OverviewView>(() => readProjectViewState().view);
  const [openaiEnabled, setOpenaiEnabled] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRef[] | null>(null);
  const [evidenceSegments, setEvidenceSegments] = useState<SourceSegmentResource[]>([]);
  const [evidenceSegmentsLoading, setEvidenceSegmentsLoading] = useState(false);
  const [selectedRunStepEvents, setSelectedRunStepEvents] = useState<AnalysisRunStepEventResource[]>([]);
  const [selectedRunAnnotations, setSelectedRunAnnotations] = useState<AnalysisRunAnnotationResource[]>([]);
  const [runArtifactsLoading, setRunArtifactsLoading] = useState(false);
  const [runArtifactsError, setRunArtifactsError] = useState<string | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runDetailError, setRunDetailError] = useState<string | null>(null);
  const [comparisonDetailLoading, setComparisonDetailLoading] = useState(false);
  const [comparisonDetailError, setComparisonDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const evidenceLoadVersion = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncFromUrl = () => {
      const next = readProjectViewState();
      setActiveTab(next.tab);
      setOverviewView(next.view);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (activeTab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", activeTab);
    if (activeTab === "overview" && overviewView !== "analysis") {
      url.searchParams.set("view", overviewView);
    } else {
      url.searchParams.delete("view");
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [activeTab, overviewView]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSourcesError(null);
    setRunsError(null);
    try {
      const [projectResult, sourcesResult, runsResult, capabilitiesResult] = await Promise.allSettled([
        api.getProject(token, projectId),
        api.listSourcesPage
          ? api.listSourcesPage(token, projectId)
          : api.listSources(token, projectId).then(legacyCursorPage),
        api.listAnalysisRunsPage
          ? api.listAnalysisRunsPage(token, projectId)
          : api.listAnalysisRuns(token, projectId).then(legacyCursorPage),
        api.getCapabilities(token),
      ]);
      if (projectResult.status === "rejected") throw projectResult.reason;
      setProject(projectResult.value);

      if (sourcesResult.status === "fulfilled") {
        const nextSources = sourcesResult.value.items;
        setSources(nextSources);
        setSourcePage(sourcesResult.value.page);
        setSelectedSourceIds((current) =>
          current.size > 0
            ? new Set([...current].filter((id) => nextSources.some((item) => item.id === id && !item.archivedAt)))
            : new Set(nextSources.filter((item) => !item.archivedAt).map((item) => item.id)),
        );
      } else {
        setSourcesError(messageFrom(sourcesResult.reason));
      }

      if (runsResult.status === "fulfilled") {
        const orderedRuns = orderRuns(runsResult.value.items);
        setRuns(orderedRuns);
        setRunPage(runsResult.value.page);
        setSelectedRunId((current) =>
          current && orderedRuns.some((run) => run.id === current)
            ? current
            : orderedRuns.find((run) => run.status === "succeeded")?.id ?? orderedRuns[0]?.id ?? null,
        );
      } else {
        setRunsError(messageFrom(runsResult.reason));
      }
      setOpenaiEnabled(
        capabilitiesResult.status === "fulfilled"
          ? capabilitiesResult.value.openaiEnabled
          : false,
      );
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, projectId, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => {
      window.clearTimeout(timer);
      // The latest in-flight controller must be read at unmount time.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      analysisAbort.current?.abort();
    };
  }, [loadWorkspace]);

  const successfulRuns = useMemo(
    () => runs.filter((run) => run.status === "succeeded"),
    [runs],
  );
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? successfulRuns[0] ?? null;
  const latestSuccessful = successfulRuns[0];
  const selectedSuccessfulIndex = successfulRuns.findIndex((run) => run.id === selectedRun?.id);
  const comparisonLatest = selectedSuccessfulIndex >= 0 ? successfulRuns[selectedSuccessfulIndex] : latestSuccessful;
  const comparisonPrevious = selectedSuccessfulIndex >= 0 ? successfulRuns[selectedSuccessfulIndex + 1] : successfulRuns[1];

  const loadRunDetail = useCallback(async (runId: string) => {
    if (!api.getAnalysisRun) {
      setRunDetailError("이 실행의 상세 결과를 불러오는 API를 사용할 수 없습니다.");
      return;
    }
    setRunDetailLoading(true);
    setRunDetailError(null);
    try {
      const detail = await api.getAnalysisRun(token, runId);
      setRuns((current) => current.map((run) => run.id === detail.id ? detail : run));
    } catch (detailError) {
      setRunDetailError(messageFrom(detailError));
    } finally {
      setRunDetailLoading(false);
    }
  }, [api, token]);

  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "succeeded" || selectedRun.result) return undefined;
    const timer = window.setTimeout(() => void loadRunDetail(selectedRun.id), 0);
    return () => window.clearTimeout(timer);
  }, [loadRunDetail, selectedRun]);

  const loadComparisonDetail = useCallback(async (runId: string) => {
    if (!api.getAnalysisRun) {
      setComparisonDetailError("이전 분석의 상세 결과를 불러오는 API를 사용할 수 없습니다.");
      return;
    }
    setComparisonDetailLoading(true);
    setComparisonDetailError(null);
    try {
      const detail = await api.getAnalysisRun(token, runId);
      setRuns((current) => current.map((run) => run.id === detail.id ? detail : run));
    } catch (detailError) {
      setComparisonDetailError(messageFrom(detailError));
    } finally {
      setComparisonDetailLoading(false);
    }
  }, [api, token]);

  useEffect(() => {
    if (
      activeTab !== "overview" ||
      overviewView !== "history" ||
      !comparisonPrevious ||
      comparisonPrevious.result
    ) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => void loadComparisonDetail(comparisonPrevious.id),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [activeTab, comparisonPrevious, loadComparisonDetail, overviewView]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const runId = selectedRun?.id;
      if (!runId || activeTab !== "overview" || overviewView !== "history") {
        setSelectedRunStepEvents([]);
        setSelectedRunAnnotations([]);
        setRunArtifactsError(null);
        return;
      }
      setRunArtifactsLoading(true);
      setRunArtifactsError(null);
      void Promise.all([
        api.listAnalysisRunStepEvents(token, runId),
        api.listAnalysisRunAnnotations(token, runId),
      ]).then(([events, annotations]) => {
        if (!active) return;
        setSelectedRunStepEvents(events);
        setSelectedRunAnnotations(annotations);
      }).catch((artifactError) => {
        if (!active) return;
        setSelectedRunStepEvents([]);
        setSelectedRunAnnotations([]);
        setRunArtifactsError(messageFrom(artifactError));
      }).finally(() => {
        if (active) setRunArtifactsLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeTab, api, overviewView, selectedRun?.id, token]);

  const openEvidence = (nextEvidence: EvidenceRef[]) => {
    const sourceIds = [...new Set(nextEvidence.map((item) => item.sourceRecordId))];
    const version = evidenceLoadVersion.current + 1;
    evidenceLoadVersion.current = version;
    setEvidence(nextEvidence);
    setEvidenceSegments([]);
    setEvidenceSegmentsLoading(sourceIds.length > 0);
    trackProductEvent("evidence_opened", {
      referenceCount: nextEvidence.length,
      sourceCount: sourceIds.length,
    });
    void Promise.all(
      sourceIds.map((sourceId) => api.listSourceSegments(token, sourceId).catch(() => [])),
    ).then((groups) => {
      if (evidenceLoadVersion.current !== version) return;
      setEvidenceSegments(groups.flat());
      setEvidenceSegmentsLoading(false);
    });
  };

  const closeEvidence = () => {
    evidenceLoadVersion.current += 1;
    setEvidence(null);
    setEvidenceSegments([]);
    setEvidenceSegmentsLoading(false);
  };

  const loadMoreSources = async () => {
    if (!api.listSourcesPage || !sourcePage.nextCursor || loadingMoreSources) return;
    setLoadingMoreSources(true);
    setSourcesError(null);
    try {
      const next = await api.listSourcesPage(token, projectId, {
        cursor: sourcePage.nextCursor,
        limit: sourcePage.limit,
      });
      setSources((current) => mergeById(current, next.items));
      setSourcePage(next.page);
    } catch (loadError) {
      setSourcesError(messageFrom(loadError));
    } finally {
      setLoadingMoreSources(false);
    }
  };

  const loadMoreRuns = async () => {
    if (!api.listAnalysisRunsPage || !runPage.nextCursor || loadingMoreRuns) return;
    setLoadingMoreRuns(true);
    setRunsError(null);
    try {
      const next = await api.listAnalysisRunsPage(token, projectId, {
        cursor: runPage.nextCursor,
        limit: runPage.limit,
      });
      setRuns((current) => orderRuns(mergeById(current, next.items)));
      setRunPage(next.page);
    } catch (loadError) {
      setRunsError(messageFrom(loadError));
    } finally {
      setLoadingMoreRuns(false);
    }
  };

  if (loading && !project) {
    return <main className="app-page"><div className="loading-card page-loader" role="status">프로젝트를 불러오는 중…</div></main>;
  }
  if (!project) {
    return (
      <main className="app-page">
        <div className="notice error" role="alert">{error ?? "프로젝트를 찾을 수 없습니다."}</div>
        <button className="button secondary" type="button" onClick={() => navigate("/projects")}>프로젝트 목록</button>
      </main>
    );
  }

  const tabs: { id: ProjectTab; label: string }[] = [
    { id: "overview", label: "개요" },
    { id: "map", label: "지식맵" },
    { id: "onboarding", label: "온보딩 요약" },
  ];
  const overviewViews: { id: OverviewView; label: string }[] = [
    { id: "analysis", label: "분석 실행" },
    { id: "records", label: "기록" },
    { id: "history", label: "분석 이력" },
  ];

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: ProjectTab) => {
    const current = tabs.findIndex((item) => item.id === tab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[next].id;
    setActiveTab(nextTab);
    if (nextTab === "overview") setOverviewView("analysis");
    document.getElementById(`project-tab-${nextTab}`)?.focus();
  };

  const handleOverviewKeyDown = (event: KeyboardEvent<HTMLButtonElement>, view: OverviewView) => {
    const current = overviewViews.findIndex((item) => item.id === view);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % overviewViews.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + overviewViews.length) % overviewViews.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = overviewViews.length - 1;
    else return;
    event.preventDefault();
    const nextView = overviewViews[next].id;
    setOverviewView(nextView);
    document.getElementById(`overview-view-${nextView}`)?.focus();
  };

  return (
    <main className="app-page project-page">
      <button className="text-button back-button" type="button" onClick={() => navigate("/projects")}>
        ← 프로젝트 목록
      </button>
      <header className="project-heading">
        <div>
          <p className="section-kicker">Project workspace</p>
          <h1>{project.title}</h1>
          <p>{project.description || "이 프로젝트의 설명을 개요 탭에서 추가할 수 있습니다."}</p>
        </div>
      </header>

      {latestSuccessful?.result ? (
        <ProjectContextPulse
          run={latestSuccessful}
          onOpen={() => {
            setSelectedRunId(latestSuccessful.id);
            setActiveTab("overview");
            setOverviewView("history");
          }}
        />
      ) : latestSuccessful && runDetailLoading ? (
        <section className="project-context-empty" aria-label="최근 분석 상세 로딩" aria-live="polite">
          <div><strong>최근 분석의 상세 결과를 불러오는 중입니다.</strong><p>목록은 준비되었으며 결과 본문만 안전하게 나중에 불러옵니다.</p></div>
        </section>
      ) : latestSuccessful && runDetailError ? (
        <section className="project-context-empty" aria-label="최근 분석 상세 오류">
          <div><strong>최근 분석의 상세 결과를 불러오지 못했습니다.</strong><p>{runDetailError}</p></div>
          <button className="button secondary" type="button" onClick={() => void loadRunDetail(latestSuccessful.id)}>다시 시도</button>
        </section>
      ) : (
        <section className="project-context-empty" aria-label="프로젝트 맥락 준비 상태">
          <div><strong>아직 구조화된 프로젝트 맥락이 없습니다.</strong><p>기록을 추가한 뒤 첫 분석을 실행하면 관점 차이와 미결 질문이 여기에 표시됩니다.</p></div>
          <button className="button secondary" type="button" onClick={() => { setActiveTab("overview"); setOverviewView("records"); }}>기록 추가하기</button>
        </section>
      )}

      {error && <div className="notice error" role="alert">{error}<button type="button" onClick={() => setError(null)}>닫기</button></div>}
      {sourcesError && (
        <div className="notice warning" role="alert">
          기록 목록 일부를 불러오지 못했습니다. {sourcesError}
          <button type="button" onClick={() => void loadWorkspace()}>다시 불러오기</button>
        </div>
      )}
      {runsError && (
        <div className="notice warning" role="alert">
          분석 이력 일부를 불러오지 못했습니다. {runsError}
          <button type="button" onClick={() => void loadWorkspace()}>다시 불러오기</button>
        </div>
      )}

      <div className="project-tabs" role="tablist" aria-label="프로젝트 보기">
        {tabs.map((tab) => (
          <button
            id={`project-tab-${tab.id}`}
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`project-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => { setActiveTab(tab.id); if (tab.id === "overview") setOverviewView("analysis"); }}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section
        id={`project-panel-${activeTab}`}
        className="project-tab-panel"
        role="tabpanel"
        aria-labelledby={`project-tab-${activeTab}`}
      >
        {activeTab === "overview" && (
          <div className="overview-workspace">
            <div className="overview-view-tabs" role="tablist" aria-label="개요 작업">
              {overviewViews.map((view) => (
                <button
                  id={`overview-view-${view.id}`}
                  key={view.id}
                  className={overviewView === view.id ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={overviewView === view.id}
                  aria-controls={`overview-panel-${view.id}`}
                  tabIndex={overviewView === view.id ? 0 : -1}
                  onClick={() => setOverviewView(view.id)}
                  onKeyDown={(event) => handleOverviewKeyDown(event, view.id)}
                >
                  {view.label}
                </button>
              ))}
            </div>
            <div id={`overview-panel-${overviewView}`} role="tabpanel" aria-labelledby={`overview-view-${overviewView}`}>
              {overviewView === "analysis" && (
                <OverviewTab
                  api={api}
                  token={token}
                  project={project}
                  sources={sources}
                  runs={runs}
                  selectedSourceIds={selectedSourceIds}
                  openaiEnabled={openaiEnabled}
                  hasMoreSources={Boolean(sourcePage.nextCursor)}
                  loadingMoreSources={loadingMoreSources}
                  onLoadMoreSources={loadMoreSources}
                  onToggleSource={(id) => setSelectedSourceIds(toggleSet(selectedSourceIds, id))}
                  onProjectChange={setProject}
                  onProjectDeleted={() => navigate("/projects")}
                  onRunCreated={(run) => {
                    setRuns((current) => orderRuns([run, ...current.filter((item) => item.id !== run.id)]));
                    setSelectedRunId(run.id);
                    setOverviewView("history");
                  }}
                  onError={setError}
                  analysisAbortRef={analysisAbort}
                />
              )}
              {overviewView === "records" && (
                <RecordsTab
                  api={api}
                  token={token}
                  projectId={projectId}
                  sources={sources}
                  hasMore={Boolean(sourcePage.nextCursor)}
                  loadingMore={loadingMoreSources}
                  onLoadMore={loadMoreSources}
                  onSourcesChange={(updateSources, updateSelection) => {
                    setSources(updateSources);
                    setSelectedSourceIds(updateSelection);
                  }}
                  onError={setError}
                />
              )}
              {overviewView === "history" && (
                <HistoryTab
                  runs={runs}
                  selectedRun={selectedRun}
                  latest={comparisonLatest}
                  previous={comparisonPrevious}
                  stepEvents={selectedRunStepEvents}
                  annotations={selectedRunAnnotations}
                  artifactsLoading={runArtifactsLoading}
                  artifactsError={runArtifactsError}
                  detailLoading={runDetailLoading}
                  detailError={runDetailError}
                  comparisonLoading={comparisonDetailLoading}
                  comparisonError={comparisonDetailError}
                  hasMore={Boolean(runPage.nextCursor)}
                  loadingMore={loadingMoreRuns}
                  onLoadMore={loadMoreRuns}
                  onRetryDetail={loadRunDetail}
                  onRetryComparison={loadComparisonDetail}
                  onSelectRun={(id) => {
                    setSelectedRunId(id);
                    trackProductEvent("comparison_opened", {
                      hasPrevious: successfulRuns.some((run) => run.id !== id),
                    });
                  }}
                  onOpenEvidence={openEvidence}
                  onCreateAnnotation={async (input, idempotencyKey) => {
                    const created = await api.createAnalysisRunAnnotation(
                      token,
                      selectedRun?.id ?? "",
                      input,
                      idempotencyKey,
                    );
                    setSelectedRunAnnotations((current) => [
                      created,
                      ...current.filter((item) => item.id !== created.id),
                    ]);
                    return created;
                  }}
                />
              )}
            </div>
          </div>
        )}
        {activeTab === "map" && (
          selectedRun?.result ? (
            <div className="map-workspace">
              <KnowledgeMap result={selectedRun.result} onOpenEvidence={openEvidence} />
              <ContextBacklinks
                sources={sources}
                result={selectedRun.result}
                onOpenEvidence={openEvidence}
              />
            </div>
          ) : <RunDetailFallback run={selectedRun} loading={runDetailLoading} error={runDetailError} onRetry={loadRunDetail} />
        )}
        {activeTab === "onboarding" && (
          selectedRun?.result ? (
            <div className="onboarding-grid">
              <OnboardingSummary summary={selectedRun.result.onboardingSummary} />
              <SharePanel api={api} token={token} run={selectedRun} onError={setError} />
            </div>
          ) : <RunDetailFallback run={selectedRun} loading={runDetailLoading} error={runDetailError} onRetry={loadRunDetail} />
        )}
      </section>
      <EvidenceDrawer
        evidence={evidence}
        segments={evidenceSegments}
        segmentsLoading={evidenceSegmentsLoading}
        onClose={closeEvidence}
      />
    </main>
  );
}

function ProjectContextPulse({ run, onOpen }: { run: AnalysisRunResource; onOpen: () => void }) {
  if (!run.result) return null;
  const result = run.result;
  const priorityQuestion = result.questions[0]?.question;
  const lead = priorityQuestion
    ? `먼저 답할 질문: ${priorityQuestion}`
    : result.summary.overview[0] ?? "최근 분석에서 확인된 프로젝트 맥락을 살펴보세요.";

  return (
    <section className="project-context-pulse" aria-labelledby="project-context-title">
      <div className="project-context-copy">
        <p className="section-kicker">Latest context</p>
        <h2 id="project-context-title">지금 팀이 먼저 볼 맥락</h2>
        <p>{lead}</p>
        <time dateTime={run.completedAt ?? run.createdAt}>{formatDateTime(run.completedAt ?? run.createdAt)} 분석</time>
      </div>
      <dl className="project-context-metrics">
        <div><dt>관점</dt><dd>{result.participants.length}</dd></div>
        <div><dt>미결 질문</dt><dd>{result.questions.length}</dd></div>
        <div><dt>결정</dt><dd>{result.decisions.length}</dd></div>
      </dl>
      <button className="button secondary" type="button" onClick={onOpen}>최근 분석 자세히</button>
    </section>
  );
}

type OverviewTabProps = {
  api: PlatformApi;
  token: string;
  project: ProjectResource;
  sources: SourceRecordListResource[];
  runs: AnalysisRunResource[];
  selectedSourceIds: Set<string>;
  openaiEnabled: boolean;
  hasMoreSources: boolean;
  loadingMoreSources: boolean;
  onLoadMoreSources: () => Promise<void>;
  onToggleSource: (id: string) => void;
  onProjectChange: (project: ProjectResource) => void;
  onProjectDeleted: () => void;
  onRunCreated: (run: AnalysisRunResource) => void;
  onError: (message: string | null) => void;
  analysisAbortRef: React.MutableRefObject<AbortController | null>;
};

function OverviewTab({
  api,
  token,
  project,
  sources,
  runs,
  selectedSourceIds,
  openaiEnabled,
  hasMoreSources,
  loadingMoreSources,
  onLoadMoreSources,
  onToggleSource,
  onProjectChange,
  onProjectDeleted,
  onRunCreated,
  onError,
  analysisAbortRef,
}: OverviewTabProps) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [mode, setMode] = useState<AnalysisMode>("local");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const analysisAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      onProjectChange(await api.updateProject(token, project.id, { title: title.trim(), description: description.trim() }));
    } catch (saveError) {
      onError(messageFrom(saveError));
    } finally {
      setSaving(false);
    }
  };

  const runAnalysis = async () => {
    if (selectedSourceIds.size === 0 || analyzing || (mode === "openai" && !consent)) return;
    const controller = new AbortController();
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = controller;
    setAnalyzing(true);
    onError(null);
    const fingerprint = JSON.stringify({
      sourceIds: [...selectedSourceIds].sort(),
      mode,
    });
    if (analysisAttemptRef.current?.fingerprint !== fingerprint) {
      analysisAttemptRef.current = { fingerprint, key: createIdempotencyKey() };
    }
    const idempotencyKey = analysisAttemptRef.current.key;
    try {
      const run = await api.createAnalysisRun(
        token,
        project.id,
        { sourceIds: [...selectedSourceIds], mode },
        idempotencyKey,
        controller.signal,
      );
      analysisAttemptRef.current = null;
      onRunCreated(run);
    } catch (runError) {
      if (!shouldRetainAnalysisKey(runError)) analysisAttemptRef.current = null;
      if (!controller.signal.aborted) onError(messageFrom(runError));
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setAnalyzing(false);
    }
  };

  const deleteProject = async (permanent: boolean) => {
    if (deleting || (permanent && deleteConfirmation !== "delete")) return;
    setDeleting(true);
    onError(null);
    try {
      await api.deleteProject(token, project.id, permanent);
      onProjectDeleted();
    } catch (deleteError) {
      onError(messageFrom(deleteError));
      setDeleting(false);
    }
  };

  const activeSources = sources.filter((item) => !item.archivedAt);
  return (
    <div className="overview-layout">
      <section className="workspace-card">
        <div className="panel-heading compact"><p className="section-kicker">Project details</p><h2>프로젝트 정보</h2></div>
        <form onSubmit={saveProject}>
          <label className="field"><span>이름</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="field"><span>설명</span><textarea className="short-textarea" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /></label>
          <button className="button secondary" type="submit" disabled={saving || !title.trim()}>{saving ? "저장 중…" : "정보 저장"}</button>
        </form>
        <div className="danger-zone">
          <div><strong>프로젝트 정리</strong><p>보관하면 목록에서 숨겨지고, 영구 삭제하면 기록·분석·공유 링크를 복구할 수 없습니다.</p></div>
          <button className="button secondary" type="button" disabled={deleting} onClick={() => void deleteProject(false)}>프로젝트 보관</button>
          <label className="field compact-field"><span>영구 삭제 확인</span><input aria-label="영구 삭제 확인" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="delete 입력" /></label>
          <button className="button destructive" type="button" disabled={deleting || deleteConfirmation !== "delete"} onClick={() => void deleteProject(true)}>영구 삭제</button>
        </div>
      </section>

      <section className="workspace-card analysis-launcher">
        <div className="panel-heading compact">
          <p className="section-kicker">New analysis</p>
          <h2>선택한 기록 분석</h2>
          <p>실행 결과는 불변 이력으로 저장됩니다. 실패해도 최근 성공 결과는 유지됩니다.</p>
        </div>
        {activeSources.length === 0 ? (
          <p className="empty-card">기록 탭에서 먼저 원문을 저장해 주세요.</p>
        ) : (
          <div className="source-selector">
            {activeSources.map((source) => (
              <label key={source.id} aria-label={`${source.title} 분석에 포함`}>
                <input
                  data-testid={`analysis-source-${source.id}`}
                  type="checkbox"
                  checked={selectedSourceIds.has(source.id)}
                  onChange={() => onToggleSource(source.id)}
                />
                <span><strong>{source.title}</strong><small>{sourceKindLabels[source.kind]} · {source.charCount.toLocaleString("ko-KR")}자</small></span>
              </label>
            ))}
            {hasMoreSources && (
              <button
                className="button secondary"
                type="button"
                disabled={loadingMoreSources}
                onClick={() => void onLoadMoreSources()}
              >
                {loadingMoreSources ? "기록 더 불러오는 중…" : "이전 기록 더 불러오기"}
              </button>
            )}
          </div>
        )}
        <fieldset className="mode-selector">
          <legend>분석 방식</legend>
          <label aria-label="로컬 분석 선택"><input data-testid="analysis-mode-local" type="radio" name="mode" checked={mode === "local"} onChange={() => setMode("local")} /><span><strong>로컬 분석</strong><small>외부 모델 전송 없이 안정적으로 시연</small></span></label>
          <label className={!openaiEnabled ? "disabled-option" : undefined} aria-label="OpenAI 분석 선택"><input data-testid="analysis-mode-openai" type="radio" name="mode" checked={mode === "openai"} disabled={!openaiEnabled} onChange={() => setMode("openai")} /><span><strong>OpenAI 분석</strong><small>선택한 기록을 서버에서 외부 모델로 전송</small></span></label>
        </fieldset>
        {!openaiEnabled && (
          <p className="capability-note" role="status">
            OpenAI 분석은 현재 서버에 구성되지 않아 로컬 분석만 사용할 수 있습니다.
          </p>
        )}
        {mode === "openai" && (
          <label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>선택한 원문이 분석 목적으로 OpenAI API에 전송되는 것에 동의합니다.</span></label>
        )}
        <button
          data-testid="analysis-submit"
          className="button primary full-button"
          type="button"
          disabled={activeSources.length === 0 || selectedSourceIds.size === 0 || analyzing || (mode === "openai" && !consent)}
          onClick={() => void runAnalysis()}
        >
          {analyzing ? "분석 중…" : "선택한 기록 분석"}
        </button>
        <p className="usage-guide">저장된 분석 {runs.length}건 · 사용자당 동시 1건, 시간당 10건 제한</p>
      </section>
    </div>
  );
}

function RecordsTab({ api, token, projectId, sources, hasMore, loadingMore, onLoadMore, onSourcesChange, onError }: {
  api: PlatformApi;
  token: string;
  projectId: string;
  sources: SourceRecordListResource[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
  onSourcesChange: (
    update: (sources: SourceRecordListResource[]) => SourceRecordListResource[],
    updateSelection: (selected: Set<string>) => Set<string>,
  ) => void;
  onError: (message: string | null) => void;
}) {
  const [kind, setKind] = useState<SourceKind>("meeting");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [sourceDetails, setSourceDetails] = useState<Record<string, SourceRecordResource>>({});
  const [sourceDetailLoading, setSourceDetailLoading] = useState<string | null>(null);
  const [sourceDetailErrors, setSourceDetailErrors] = useState<Record<string, string>>({});

  const loadSourceDetail = async (source: SourceRecordListResource) => {
    if (isSourceDetail(source)) {
      setSourceDetails((current) => ({ ...current, [source.id]: source }));
      return;
    }
    if (!api.getSource || sourceDetailLoading === source.id) return;
    setSourceDetailLoading(source.id);
    setSourceDetailErrors((current) => ({ ...current, [source.id]: "" }));
    try {
      const detail = await api.getSource(token, source.id);
      setSourceDetails((current) => ({ ...current, [source.id]: detail }));
    } catch (detailError) {
      setSourceDetailErrors((current) => ({
        ...current,
        [source.id]: messageFrom(detailError),
      }));
    } finally {
      setSourceDetailLoading(null);
    }
  };

  const createSource = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    onError(null);
    try {
      const created = await api.createSource(token, projectId, { kind, title: title.trim(), content: content.trim() });
      setSourceDetails((current) => ({ ...current, [created.id]: created }));
      onSourcesChange(
        (current) => [created, ...current],
        (selected) => new Set(selected).add(created.id),
      );
      setTitle("");
      setContent("");
    } catch (saveError) {
      onError(messageFrom(saveError));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (source: SourceRecordListResource) => {
    onError(null);
    try {
      await api.deleteSource(token, source.id);
      onSourcesChange(
        (current) => current.map((item) =>
          item.id === source.id
            ? { ...item, archivedAt: new Date().toISOString() }
            : item,
        ),
        (selected) => {
          const next = new Set(selected);
          next.delete(source.id);
          return next;
        },
      );
    } catch (deleteError) {
      onError(messageFrom(deleteError));
    }
  };

  const importContext = async (input: ContextImportPanelInput) => {
    const imported = await api.importContext(token, projectId, input);
    setSourceDetails((current) => ({ ...current, [imported.source.id]: imported.source }));
    onSourcesChange(
      (current) => [
        imported.source,
        ...current.filter((item) => item.id !== imported.source.id),
      ],
      (selected) => new Set(selected).add(imported.source.id),
    );
  };

  return (
    <div className="records-workspace">
      <ContextImportPanel onImport={importContext} />
      <div className="records-layout">
        <section className="workspace-card sticky-card">
        <div className="panel-heading compact"><p className="section-kicker">New source</p><h2>원문 기록 추가</h2><p>민감정보를 제거한 뒤 필요한 맥락만 저장해 주세요.</p></div>
        <form onSubmit={createSource}>
          <label className="field"><span>기록 유형</span><select data-testid="source-create-kind" value={kind} onChange={(event) => setKind(event.target.value as SourceKind)}>{Object.entries(sourceKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>제목</span><input data-testid="source-create-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="예: 7월 11일 기획 회의" required /></label>
          <label className="field"><span>원문</span><textarea data-testid="source-create-content" value={content} maxLength={100_000} onChange={(event) => setContent(event.target.value)} placeholder="회의록, 조사 메모 또는 피드백을 붙여넣으세요" required /></label>
          <div className="counter">{content.length.toLocaleString("ko-KR")} / 100,000자</div>
          <button data-testid="source-create-submit" className="button secondary full-button" type="submit" disabled={saving || !title.trim() || !content.trim()}>{saving ? "저장 중…" : "기록 저장"}</button>
        </form>
        </section>
        <section className="source-list-panel">
        <div className="section-row"><div><p className="section-kicker">Source library</p><h2>저장된 기록</h2></div><span>{sources.filter((item) => !item.archivedAt).length}개</span></div>
        {sources.filter((item) => !item.archivedAt).length === 0 ? <p className="empty-card">아직 저장된 원문이 없습니다.</p> : (
          <div className="source-card-list">
            {sources.filter((item) => !item.archivedAt).map((source) => {
              const detail = sourceDetails[source.id] ?? (isSourceDetail(source) ? source : null);
              const participants = detail?.import?.participants ?? [];
              return (
              <article key={source.id} className="source-card">
                <header>
                  <div className="source-card-tags">
                    <span className={`source-kind ${source.kind}`}>{sourceKindLabels[source.kind]}</span>
                    {source.import && (
                      <span className="source-import-badge">
                        {importProviderLabels[source.import.provider] ?? "외부 기록"}
                      </span>
                    )}
                  </div>
                  <time>{formatDateTime(source.occurredAt ?? source.createdAt)}</time>
                </header>
                <h3>{source.title}</h3>
                {source.import && (
                  <div className="source-import-meta">
                    <span>맥락 {source.import.segmentCount.toLocaleString("ko-KR")}개</span>
                    {participants.length > 0 && (
                      <span>참여자 {participants.slice(0, 4).join(" · ")}</span>
                    )}
                  </div>
                )}
                {detail?.content !== undefined ? (
                  <details className="source-content-details">
                    <summary>원문 전체 보기</summary>
                    <div>{detail.content}</div>
                  </details>
                ) : (
                  <div>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={sourceDetailLoading === source.id}
                      onClick={() => void loadSourceDetail(source)}
                    >
                      {sourceDetailLoading === source.id ? "원문 불러오는 중…" : "원문 상세 불러오기"}
                    </button>
                    {sourceDetailErrors[source.id] && (
                      <p className="form-error" role="alert">
                        {sourceDetailErrors[source.id]}
                        <button type="button" onClick={() => void loadSourceDetail(source)}>다시 시도</button>
                      </p>
                    )}
                  </div>
                )}
                <footer><span>{source.charCount.toLocaleString("ko-KR")}자</span><button className="text-button danger" type="button" onClick={() => void archive(source)}>보관</button></footer>
              </article>
            );})}
          </div>
        )}
        {hasMore && (
          <button className="button secondary full-button" type="button" disabled={loadingMore} onClick={() => void onLoadMore()}>
            {loadingMore ? "기록 더 불러오는 중…" : "기록 50개 더 불러오기"}
          </button>
        )}
        </section>
      </div>
    </div>
  );
}

function HistoryTab({
  runs,
  selectedRun,
  latest,
  previous,
  stepEvents,
  annotations,
  artifactsLoading,
  artifactsError,
  detailLoading,
  detailError,
  comparisonLoading,
  comparisonError,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetryDetail,
  onRetryComparison,
  onSelectRun,
  onOpenEvidence,
  onCreateAnnotation,
}: {
  runs: AnalysisRunResource[];
  selectedRun: AnalysisRunResource | null;
  latest?: AnalysisRunResource;
  previous?: AnalysisRunResource;
  stepEvents: AnalysisRunStepEventResource[];
  annotations: AnalysisRunAnnotationResource[];
  artifactsLoading: boolean;
  artifactsError: string | null;
  detailLoading: boolean;
  detailError: string | null;
  comparisonLoading: boolean;
  comparisonError: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
  onRetryDetail: (runId: string) => Promise<void>;
  onRetryComparison: (runId: string) => Promise<void>;
  onSelectRun: (id: string) => void;
  onOpenEvidence: (evidence: EvidenceRef[]) => void;
  onCreateAnnotation: (
    input: CreateAnalysisRunAnnotationInput,
    idempotencyKey: string,
  ) => Promise<AnalysisRunAnnotationResource>;
}) {
  if (runs.length === 0) return <EmptyAnalysis />;
  return (
    <div className="history-layout">
      <aside className="run-list" aria-label="분석 실행 이력">
        <div className="section-row"><div><p className="section-kicker">Run history</p><h2>분석 이력</h2></div><span>{runs.length}건</span></div>
        {runs.map((run) => (
          <button key={run.id} className={selectedRun?.id === run.id ? "active" : ""} type="button" onClick={() => onSelectRun(run.id)}>
            <span className={`run-status ${run.status}`}>{statusLabel(run.status)}</span>
            <strong>{formatDateTime(run.createdAt)}</strong>
            <small>{run.provider.mode === "openai" ? run.provider.model ?? "OpenAI" : "로컬 분석"} · 기록 {run.sourceIds.length}개</small>
          </button>
        ))}
        {hasMore && (
          <button className="button secondary" type="button" disabled={loadingMore} onClick={() => void onLoadMore()}>
            {loadingMore ? "이력 더 불러오는 중…" : "분석 이력 50건 더 불러오기"}
          </button>
        )}
      </aside>
      <div className="run-detail">
        {selectedRun && (
          <AgentExecutionRail
            events={stepEvents}
            runStatus={selectedRun.status}
            loading={artifactsLoading}
          />
        )}
        {artifactsError && <div className="notice error" role="alert">{artifactsError}</div>}
        {selectedRun?.status === "failed" ? <div className="notice error">{selectedRun.error?.message ?? "분석 실행이 실패했습니다."}</div> : selectedRun?.status === "running" ? <div className="loading-card">분석이 진행 중입니다.</div> : detailLoading ? <div className="loading-card" role="status">선택한 분석의 상세 결과를 불러오는 중…</div> : detailError && selectedRun ? <div className="notice error" role="alert">{detailError}<button type="button" onClick={() => void onRetryDetail(selectedRun.id)}>다시 시도</button></div> : selectedRun?.result ? (
          <>
            <header className="history-context-heading">
              <p className="section-kicker">Context first</p>
              <h2>관점과 미결 질문부터 확인하세요</h2>
              <p>요약보다 먼저 누가 무엇을 중요하게 보는지, 다음 회의에서 무엇을 답해야 하는지 보여줍니다.</p>
            </header>
            <div className="history-priority-stack">
              <PerspectiveTable participants={selectedRun.result.participants} onOpenEvidence={onOpenEvidence} />
              <div className="priority-pair">
              <QuestionList questions={selectedRun.result.questions} onOpenEvidence={onOpenEvidence} />
              <DecisionList decisions={selectedRun.result.decisions} onOpenEvidence={onOpenEvidence} />
              </div>
              <ParticipantAgentPanel synthesis={selectedRun.result.participantAgents} />
              {comparisonLoading && <div className="loading-card" role="status">비교할 이전 성공 분석을 불러오는 중…</div>}
              {comparisonError && previous && (
                <div className="notice warning" role="alert">
                  이전 분석 비교를 불러오지 못했습니다. {comparisonError}
                  <button type="button" onClick={() => void onRetryComparison(previous.id)}>다시 시도</button>
                </div>
              )}
              <AnalysisComparison previous={previous?.result} latest={latest?.result} />
              <SummaryPanel result={selectedRun.result} />
              <KeyTerms terms={selectedRun.result.keyTerms} />
            </div>
            <AnalysisFeedbackPanel
              result={selectedRun.result}
              annotations={annotations}
              loading={artifactsLoading}
              onCreate={onCreateAnnotation}
            />
          </>
        ) : <div className="empty-card">이 실행에는 표시할 결과가 없습니다.</div>}
      </div>
    </div>
  );
}

function SharePanel({ api, token, run, onError }: { api: PlatformApi; token: string; run: AnalysisRunResource; onError: (message: string | null) => void }) {
  const [links, setLinks] = useState<ShareLinkResource[]>([]);
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [freshUrls, setFreshUrls] = useState<Record<string, string>>({});
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const confirmRevokeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    api.listShareLinks(token, run.id).then((items) => { if (active) setLinks(items); }).catch((loadError) => { if (active) onError(messageFrom(loadError)); });
    return () => { active = false; };
  }, [api, onError, run.id, token]);

  useEffect(() => {
    if (confirmingRevokeId) confirmRevokeButtonRef.current?.focus();
  }, [confirmingRevokeId]);

  const create = async () => {
    setCreating(true);
    onError(null);
    try {
      const link = await api.createShareLink(token, run.id, days);
      setLinks((current) => [link, ...current]);
      trackProductEvent("share_link_created", { expiresInDays: days });
      if (link.token) setFreshUrls((current) => ({ ...current, [link.id]: `${window.location.origin}/share#token=${encodeURIComponent(link.token ?? "")}` }));
    } catch (createError) {
      onError(messageFrom(createError));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (linkId: string) => {
    setRevokingId(linkId);
    try {
      await api.revokeShareLink(token, linkId);
      setLinks((current) => current.map((link) => link.id === linkId ? { ...link, revokedAt: new Date().toISOString() } : link));
      setConfirmingRevokeId(null);
    } catch (revokeError) {
      onError(messageFrom(revokeError));
    } finally {
      setRevokingId(null);
    }
  };

  const cancelRevoke = (linkId: string) => {
    setConfirmingRevokeId(null);
    window.setTimeout(() => document.getElementById(`share-revoke-${linkId}`)?.focus(), 0);
  };

  const copyLink = async (linkId: string, url: string) => {
    setCopiedLinkId(null);
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(linkId);
    } catch {
      setCopyError("자동 복사가 지원되지 않습니다. 링크 입력란을 선택해 직접 복사해 주세요.");
    }
  };

  return (
    <section className="share-panel workspace-card" aria-labelledby="share-title">
      <div className="panel-heading compact"><p className="section-kicker">Read-only share</p><h2 id="share-title">온보딩 링크 공유</h2><p>토큰은 생성 직후 한 번만 확인할 수 있습니다.</p></div>
      <div className="notice warning" role="note">
        공유 분석에는 근거 인용문, 사람 이름 또는 입력 원문의 개인정보 일부가 포함될 수 있습니다.
        링크를 만들기 전에 현재 분석 결과를 확인하고 필요한 경우 원문을 정리해 주세요.
      </div>
      <div className="share-create-row">
        <label><span>만료</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>1일</option><option value={7}>7일</option><option value={14}>14일</option><option value={30}>30일</option></select></label>
        <button data-testid="share-create" className="button primary" type="button" disabled={creating} onClick={() => void create()}>{creating ? "만드는 중…" : "읽기 전용 링크 만들기"}</button>
      </div>
      {links.length === 0 ? <p className="empty-card">이 분석에 생성된 공유 링크가 없습니다.</p> : (
        <ul className="share-link-list">
          {links.map((link) => {
            const url = freshUrls[link.id];
            const revoked = Boolean(link.revokedAt);
            const confirming = confirmingRevokeId === link.id;
            return (
              <li key={link.id} className={revoked ? "revoked" : ""}>
                <div>
                  <strong>{revoked ? "폐기됨" : `${formatDateTime(link.expiresAt)} 만료`}</strong>
                  {url ? (
                    <div>
                      <input aria-label="새 공유 링크" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                      <button className="button secondary" type="button" onClick={() => void copyLink(link.id, url)}>링크 복사</button>
                    </div>
                  ) : <small>보안을 위해 기존 토큰은 다시 표시되지 않습니다.</small>}
                </div>
                {!revoked && !confirming && (
                  <button
                    id={`share-revoke-${link.id}`}
                    data-testid={`share-revoke-${link.id}`}
                    className="text-button danger"
                    type="button"
                    aria-expanded="false"
                    aria-controls={`share-revoke-confirm-${link.id}`}
                    onClick={() => setConfirmingRevokeId(link.id)}
                  >
                    링크 폐기
                  </button>
                )}
                {confirming && (
                  <div
                    id={`share-revoke-confirm-${link.id}`}
                    role="alertdialog"
                    aria-labelledby={`share-revoke-title-${link.id}`}
                    aria-describedby={`share-revoke-description-${link.id}`}
                  >
                    <strong id={`share-revoke-title-${link.id}`}>이 공유 링크를 폐기할까요?</strong>
                    <p id={`share-revoke-description-${link.id}`}>즉시 열 수 없게 되며 되돌릴 수 없습니다.</p>
                    <button
                      ref={confirmRevokeButtonRef}
                      className="button destructive"
                      type="button"
                      disabled={revokingId === link.id}
                      onClick={() => void revoke(link.id)}
                    >
                      {revokingId === link.id ? "폐기하는 중…" : "폐기 확인"}
                    </button>
                    <button className="button secondary" type="button" disabled={revokingId === link.id} onClick={() => cancelRevoke(link.id)}>취소</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={`copy-status ${copiedLinkId ? "copied" : copyError ? "error" : ""}`} aria-live="polite">
        {copiedLinkId ? "공유 링크를 클립보드에 복사했습니다." : copyError ?? ""}
      </p>
    </section>
  );
}

function RunDetailFallback({
  run,
  loading,
  error,
  onRetry,
}: {
  run: AnalysisRunResource | null;
  loading: boolean;
  error: string | null;
  onRetry: (runId: string) => Promise<void>;
}) {
  if (!run) return <EmptyAnalysis />;
  if (loading) {
    return <div className="loading-card" role="status">선택한 분석의 상세 결과를 불러오는 중…</div>;
  }
  if (error) {
    return <div className="notice error" role="alert">{error}<button type="button" onClick={() => void onRetry(run.id)}>다시 시도</button></div>;
  }
  return <div className="empty-card">이 실행에는 표시할 상세 결과가 없습니다.</div>;
}

function EmptyAnalysis() {
  return <div className="empty-card large-empty"><strong>아직 성공한 분석이 없습니다.</strong><p>개요 탭에서 기록을 선택하고 새 분석을 실행해 주세요.</p></div>;
}

function toggleSet(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function orderRuns(runs: AnalysisRunResource[]) {
  return [...runs].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

function isSourceDetail(source: SourceRecordListResource): source is SourceRecordResource {
  return "content" in source && typeof source.content === "string";
}

function legacyCursorPage<T>(items: T[]) {
  return {
    items,
    page: { ...completedPage, limit: Math.max(1, items.length), count: items.length },
  };
}

function statusLabel(status: AnalysisRunResource["status"]) {
  return { running: "진행 중", succeeded: "성공", failed: "실패", cancelled: "취소" }[status];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function createIdempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function shouldRetainAnalysisKey(error: unknown) {
  return !(error instanceof PlatformApiError) || error.status === 0;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function readProjectViewState(): { tab: ProjectTab; view: OverviewView } {
  if (typeof window === "undefined") return { tab: "overview", view: "analysis" };
  const params = new URLSearchParams(window.location.search);
  const tabValue = params.get("tab");
  const viewValue = params.get("view");
  const tab: ProjectTab = tabValue === "map" || tabValue === "onboarding"
    ? tabValue
    : "overview";
  const view: OverviewView = viewValue === "records" || viewValue === "history"
    ? viewValue
    : "analysis";
  return { tab, view };
}

export default ProjectPage;
