import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import AccountSafetyPanel from "../components/AccountSafetyPanel";
import type { Navigate } from "../hooks/useRoute";
import type { PlatformApi } from "../services/platformApi";
import type { CreateSourceInput, ProjectResource, SourceKind } from "../types/platform";

const DEMO_PROJECT = {
  title: "캠퍼스 공모전 서비스 기획",
  description: "회의·리서치·멘토 피드백에서 결정과 질문의 변화를 보여주는 공개 시연 프로젝트",
};

const DEMO_SOURCES: Array<CreateSourceInput & { kind: SourceKind }> = [
  {
    kind: "meeting",
    title: "1차 기획 회의록",
    content:
      "팀은 대학생 공모전 준비 과정에서 회의록과 조사 자료가 흩어지는 문제를 해결하기로 했다. 민지는 첫 화면에서 입력 행동을 쉽게 이해해야 한다고 말했다. 서준은 단순 요약이 아니라 결정 배경과 미해결 질문을 보여줘야 한다고 제안했다. 현우는 지식맵이 복잡해지지 않도록 핵심 노드만 표시해야 한다고 우려했다. MVP는 메신저 자동 연동 없이 사용자가 직접 기록을 붙여 넣는 방식으로 시작하기로 확정했다.",
  },
  {
    kind: "research",
    title: "사용자 인터뷰 리서치",
    content:
      "공모전 참가자 다섯 명을 인터뷰한 결과, 새 팀원이 이전 결정의 결론은 찾을 수 있어도 왜 그렇게 정했는지는 파악하기 어렵다고 답했다. 세 명은 회의록이 날짜순으로만 쌓여 필요한 질문을 다시 찾는 데 시간이 오래 걸린다고 말했다. 분석 결과에는 결론, 근거 문장, 아직 답하지 못한 질문이 함께 보여야 한다는 가설을 세웠다.",
  },
  {
    kind: "feedback",
    title: "멘토 중간 피드백",
    content:
      "멘토는 발표에서 AI 요약 자체보다 분석 결과가 실제 원문과 어떻게 연결되는지를 먼저 시연하라고 조언했다. 공유 링크에는 원문 전체와 사용자 정보가 노출되지 않아야 하며, 새 팀원이 현재 결정과 다음 행동을 빠르게 읽을 수 있어야 한다. 다음 발표 전까지 근거 패널, 분석 이력 비교, 읽기 전용 온보딩 링크를 하나의 흐름으로 검증하기로 했다.",
  },
];

type ProjectsPageProps = {
  api: PlatformApi;
  token: string;
  navigate: Navigate;
  onAccountDeleted?: () => Promise<void> | void;
};

function ProjectsPage({ api, token, navigate, onAccountDeleted }: ProjectsPageProps) {
  const [projects, setProjects] = useState<ProjectResource[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ProjectResource[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null);
  const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [demoCopying, setDemoCopying] = useState(false);
  const [demoIssue, setDemoIssue] = useState<{ message: string; projectId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoCopyInFlightRef = useRef(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.listProjects(token));
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProjects(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  const loadArchivedProjects = useCallback(async () => {
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      setArchivedProjects(await api.listProjects(token, { archived: true }));
    } catch (loadError) {
      setArchiveError(messageFrom(loadError));
    } finally {
      setArchiveLoading(false);
    }
  }, [api, token]);

  const toggleArchive = async () => {
    if (showArchived) {
      setShowArchived(false);
      return;
    }
    setShowArchived(true);
    setArchiveStatus(null);
    await loadArchivedProjects();
  };

  const restoreProject = async (project: ProjectResource) => {
    if (!api.restoreProject || restoringProjectId) return;
    setRestoringProjectId(project.id);
    setArchiveError(null);
    setArchiveStatus(null);
    try {
      const restored = await api.restoreProject(token, project.id);
      setArchivedProjects((current) => current.filter((item) => item.id !== project.id));
      setProjects((current) => [restored, ...current.filter((item) => item.id !== restored.id)]);
      setArchiveStatus(`${restored.title} 프로젝트를 복원했습니다.`);
    } catch (restoreError) {
      setArchiveError(messageFrom(restoreError));
    } finally {
      setRestoringProjectId(null);
    }
  };

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const project = await api.createProject(token, {
        title: title.trim(),
        description: description.trim(),
      });
      navigate(`/projects/${encodeURIComponent(project.id)}`);
    } catch (saveError) {
      setError(messageFrom(saveError));
    } finally {
      setSaving(false);
    }
  };

  const copyDemoProject = async () => {
    if (demoCopyInFlightRef.current) return;
    demoCopyInFlightRef.current = true;
    setDemoCopying(true);
    setDemoIssue(null);
    let createdProject: ProjectResource;
    try {
      createdProject = await api.createProject(token, DEMO_PROJECT);
      setProjects((current) => [
        createdProject,
        ...current.filter((item) => item.id !== createdProject.id),
      ]);
    } catch (copyError) {
      setDemoIssue({
        message: `데모 프로젝트를 만들지 못했습니다. ${messageFrom(copyError)}`,
      });
      demoCopyInFlightRef.current = false;
      setDemoCopying(false);
      return;
    }

    const sourceIds: string[] = [];
    for (const source of DEMO_SOURCES) {
      try {
        const created = await api.createSource(token, createdProject.id, source);
        sourceIds.push(created.id);
      } catch (copyError) {
        setDemoIssue({
          projectId: createdProject.id,
          message: `프로젝트는 생성됐지만 기록 ${sourceIds.length}/${DEMO_SOURCES.length}개만 저장되었습니다. 생성된 프로젝트에서 이어서 준비해 주세요. ${messageFrom(copyError)}`,
        });
        demoCopyInFlightRef.current = false;
        setDemoCopying(false);
        return;
      }
    }

    try {
      await api.createAnalysisRun(
        token,
        createdProject.id,
        { sourceIds, mode: "local" },
        createDemoIdempotencyKey(),
      );
      navigate(`/projects/${encodeURIComponent(createdProject.id)}`);
    } catch (copyError) {
      setDemoIssue({
        projectId: createdProject.id,
        message: `프로젝트와 기록 ${DEMO_SOURCES.length}개는 저장됐지만 첫 분석은 완료하지 못했습니다. 프로젝트에서 분석을 다시 실행해 주세요. ${messageFrom(copyError)}`,
      });
    } finally {
      demoCopyInFlightRef.current = false;
      setDemoCopying(false);
    }
  };

  const projectListSection = (
    <section className="project-list-section" aria-labelledby="project-list-title">
      <div className="section-row">
        <div><p className="section-kicker">Saved projects</p><h2 id="project-list-title">최근 프로젝트</h2></div>
        <span>{projects.length}개</span>
      </div>
      {loading ? (
        <div className="loading-card" role="status">프로젝트를 불러오는 중…</div>
      ) : projects.length === 0 ? (
        <div className="empty-card"><strong>아직 저장된 프로젝트가 없습니다.</strong><p>아래 양식으로 첫 프로젝트를 만들어 보세요.</p></div>
      ) : (
        <div className="project-card-grid">
          {projects.map((project) => (
            <button
              className="project-card"
              type="button"
              key={project.id}
              onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
            >
              <span className="project-card-date">{formatDate(project.updatedAt)}</span>
              <strong>{project.title}</strong>
              <p>{project.description || "설명이 아직 없습니다."}</p>
              <span className="project-card-metrics">
                기록 {project.sourceCount ?? "–"} · 분석 {project.analysisCount ?? "–"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="section-kicker">Workspace</p>
          <h1>내 프로젝트</h1>
          <p>원문 기록과 분석 이력이 계정별로 안전하게 보관됩니다.</p>
        </div>
      </header>

      {error && <div className="notice error" role="alert">{error}<button type="button" onClick={() => void loadProjects()}>다시 시도</button></div>}
      {projectListSection}

      <section className="archive-section" aria-labelledby="archive-section-title">
        <div className="section-row">
          <div>
            <p className="section-kicker">Archive</p>
            <h2 id="archive-section-title">보관한 프로젝트</h2>
          </div>
          <button
            className="button secondary"
            type="button"
            aria-expanded={showArchived}
            aria-controls="archived-project-list"
            onClick={() => void toggleArchive()}
          >
            {showArchived ? "보관함 닫기" : "보관함 보기"}
          </button>
        </div>
        {showArchived && (
          <div id="archived-project-list" className="archive-content">
            {archiveLoading ? (
              <div className="loading-card" role="status">보관함을 불러오는 중…</div>
            ) : archiveError ? (
              <div className="notice error" role="alert">
                {archiveError}
                <button type="button" onClick={() => void loadArchivedProjects()}>다시 시도</button>
              </div>
            ) : archivedProjects.length === 0 ? (
              <div className="empty-card"><strong>보관한 프로젝트가 없습니다.</strong><p>프로젝트를 보관하면 여기에서 복원할 수 있습니다.</p></div>
            ) : (
              <div className="archived-project-list">
                {archivedProjects.map((project) => (
                  <article className="archived-project-card" key={project.id}>
                    <div>
                      <span>{project.archivedAt ? `${formatDate(project.archivedAt)} 보관` : "보관됨"}</span>
                      <h3>{project.title}</h3>
                      <p>{project.description || "설명이 아직 없습니다."}</p>
                    </div>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!api.restoreProject || restoringProjectId !== null}
                      onClick={() => void restoreProject(project)}
                    >
                      {restoringProjectId === project.id ? "복원하는 중…" : "프로젝트 복원"}
                    </button>
                  </article>
                ))}
              </div>
            )}
            {archiveStatus && <p className="notice success" role="status">{archiveStatus}</p>}
          </div>
        )}
      </section>

      <section className="demo-copy-card" aria-labelledby="demo-copy-title">
        <div>
          <p className="section-kicker">Ready-to-run demo</p>
          <h2 id="demo-copy-title">6분 시연용 프로젝트를 바로 준비하세요</h2>
          <p>회의록·리서치·멘토 피드백 3건과 첫 로컬 분석을 내 계정에 복사합니다.</p>
        </div>
        <button
          data-testid="demo-project-copy"
          className="button secondary"
          type="button"
          disabled={demoCopying}
          onClick={() => void copyDemoProject()}
        >
          {demoCopying ? "데모 프로젝트 준비 중…" : "데모 프로젝트 복사"}
        </button>
      </section>
      {demoCopying && (
        <p className="demo-progress" role="status">
          프로젝트, 기록 3건, 첫 분석을 순서대로 저장하고 있습니다. 창을 닫지 마세요.
        </p>
      )}
      {demoIssue && (
        <div className="notice warning" role="alert">
          <span>{demoIssue.message}</span>
          {demoIssue.projectId && (
            <button
              type="button"
              onClick={() => navigate(`/projects/${encodeURIComponent(demoIssue.projectId ?? "")}`)}
            >
              생성된 프로젝트 열기
            </button>
          )}
        </div>
      )}

      <section className="project-create-card" aria-labelledby="project-create-title-label">
        <div>
          <p className="section-kicker">New project</p>
          <h2 id="project-create-title-label">새 맥락 공간 만들기</h2>
          <p>프로젝트 이름만으로 시작하고 기록은 다음 화면에서 추가할 수 있습니다.</p>
        </div>
        <form onSubmit={createProject}>
          <label className="field compact-field">
            <span>프로젝트 이름</span>
            <input
              data-testid="project-create-title"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 캠퍼스 공모전 서비스"
              required
            />
          </label>
          <label className="field compact-field">
            <span>설명 <small>선택</small></span>
            <input
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="팀이 해결하려는 문제를 한 줄로 적어보세요"
            />
          </label>
          <button
            data-testid="project-create-submit"
            className="button primary"
            type="submit"
            disabled={saving || !title.trim()}
          >
            {saving ? "만드는 중…" : "프로젝트 만들기"}
          </button>
        </form>
      </section>

      <AccountSafetyPanel
        api={api}
        token={token}
        onAccountDeleted={onAccountDeleted ?? (() => navigate("/"))}
      />
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "최근 수정" : new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function createDemoIdempotencyKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default ProjectsPage;
