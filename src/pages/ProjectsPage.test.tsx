import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlatformApi } from "../services/platformApi";
import type {
  AnalysisRunResource,
  ProjectResource,
  SourceRecordResource,
} from "../types/platform";
import ProjectsPage from "./ProjectsPage";

const project: ProjectResource = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "캠퍼스 공모전",
  description: "시연 프로젝트",
  archivedAt: null,
  createdAt: "2026-07-10T00:00:00Z",
  updatedAt: "2026-07-11T00:00:00Z",
  sourceCount: 3,
  analysisCount: 1,
};

describe("ProjectsPage", () => {
  it("creates a project and navigates to its workspace", async () => {
    const user = userEvent.setup();
    const api = apiMock();
    const navigate = vi.fn();
    vi.mocked(api.listProjects).mockResolvedValue([project]);
    vi.mocked(api.createProject).mockResolvedValue(project);
    render(<ProjectsPage api={api} token="access" navigate={navigate} />);

    expect(await screen.findByRole("button", { name: /캠퍼스 공모전/ })).toBeInTheDocument();
    await user.type(screen.getByTestId("project-create-title"), "새 프로젝트");
    await user.type(screen.getByPlaceholderText("팀이 해결하려는 문제를 한 줄로 적어보세요"), "설명");
    await user.click(screen.getByTestId("project-create-submit"));
    expect(api.createProject).toHaveBeenCalledWith("access", { title: "새 프로젝트", description: "설명" });
    expect(navigate).toHaveBeenCalledWith(`/projects/${project.id}`);
  });

  it("shows a recoverable loading error and retries", async () => {
    const user = userEvent.setup();
    const api = apiMock();
    vi.mocked(api.listProjects).mockRejectedValueOnce(new Error("데이터베이스에 연결할 수 없습니다.")).mockResolvedValueOnce([]);
    render(<ProjectsPage api={api} token="access" navigate={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("데이터베이스에 연결할 수 없습니다.");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("아직 저장된 프로젝트가 없습니다.")).toBeInTheDocument();
    expect(api.listProjects).toHaveBeenCalledTimes(2);
  });

  it("loads the archive on demand and restores an owned project", async () => {
    const archived = { ...project, archivedAt: "2026-07-12T00:00:00Z" };
    const api = apiMock();
    vi.mocked(api.listProjects).mockImplementation(async (_token, options) =>
      options?.archived ? [archived] : [project],
    );
    api.restoreProject = vi.fn().mockResolvedValue({ ...project, archivedAt: null });
    const user = userEvent.setup();

    render(<ProjectsPage api={api} token="access" navigate={vi.fn()} />);
    await screen.findByRole("button", { name: /캠퍼스 공모전/ });
    await user.click(screen.getByRole("button", { name: "보관함 보기" }));

    expect(await screen.findByRole("heading", { name: archived.title, level: 3 })).toBeInTheDocument();
    expect(api.listProjects).toHaveBeenLastCalledWith("access", { archived: true });
    await user.click(screen.getByRole("button", { name: "프로젝트 복원" }));
    expect(api.restoreProject).toHaveBeenCalledWith("access", archived.id);
    expect(await screen.findByRole("status")).toHaveTextContent("프로젝트를 복원했습니다");
  });

  it("copies the deterministic three-source demo once and opens the analyzed project", async () => {
    const user = userEvent.setup();
    const api = apiMock();
    const navigate = vi.fn();
    vi.mocked(api.listProjects).mockResolvedValue([]);
    let resolveProject: (value: ProjectResource) => void = () => undefined;
    vi.mocked(api.createProject).mockReturnValue(
      new Promise<ProjectResource>((resolve) => { resolveProject = resolve; }),
    );
    vi.mocked(api.createSource).mockImplementation(async (_token, projectId, input) =>
      sourceResource(`${input.kind}-id`, projectId, input.kind, input.title, input.content),
    );
    vi.mocked(api.createAnalysisRun).mockResolvedValue(analysisRun(project.id));
    render(<ProjectsPage api={api} token="access" navigate={navigate} />);
    await screen.findByText("아직 저장된 프로젝트가 없습니다.");

    await user.click(screen.getByTestId("demo-project-copy"));
    expect(screen.getByTestId("demo-project-copy")).toBeDisabled();
    await user.click(screen.getByTestId("demo-project-copy"));
    expect(api.createProject).toHaveBeenCalledTimes(1);

    resolveProject(project);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/projects/${project.id}`));
    expect(api.createSource).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.createSource).mock.calls.map((call) => call[2].kind)).toEqual([
      "meeting",
      "research",
      "feedback",
    ]);
    expect(api.createAnalysisRun).toHaveBeenCalledWith(
      "access",
      project.id,
      {
        sourceIds: ["meeting-id", "research-id", "feedback-id"],
        mode: "local",
      },
      expect.any(String),
    );
  });

  it("reports partial demo copy failures and links to the project that was created", async () => {
    const user = userEvent.setup();
    const api = apiMock();
    const navigate = vi.fn();
    vi.mocked(api.listProjects).mockResolvedValue([]);
    vi.mocked(api.createProject).mockResolvedValue(project);
    vi.mocked(api.createSource)
      .mockResolvedValueOnce(
        sourceResource("meeting-id", project.id, "meeting", "회의록", "회의 내용"),
      )
      .mockRejectedValueOnce(new Error("기록 저장 실패"));
    render(<ProjectsPage api={api} token="access" navigate={navigate} />);
    await screen.findByText("아직 저장된 프로젝트가 없습니다.");

    await user.click(screen.getByTestId("demo-project-copy"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기록 1/3개만 저장되었습니다",
    );
    expect(api.createAnalysisRun).not.toHaveBeenCalled();
    expect(screen.getByTestId("demo-project-copy")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "생성된 프로젝트 열기" }));
    expect(navigate).toHaveBeenCalledWith(`/projects/${project.id}`);
  });
});

function sourceResource(
  id: string,
  projectId: string,
  kind: SourceRecordResource["kind"],
  title: string,
  content: string,
): SourceRecordResource {
  return {
    id,
    projectId,
    kind,
    title,
    content,
    charCount: content.length,
    occurredAt: null,
    archivedAt: null,
    createdAt: "2026-07-11T00:00:00Z",
    updatedAt: "2026-07-11T00:00:00Z",
  };
}

function analysisRun(projectId: string): AnalysisRunResource {
  return {
    id: "run-id",
    projectId,
    status: "succeeded",
    schemaVersion: "2.0",
    sourceIds: ["meeting-id", "research-id", "feedback-id"],
    provider: { mode: "local" },
    createdAt: "2026-07-11T00:00:00Z",
    completedAt: "2026-07-11T00:00:01Z",
  };
}

function apiMock(): PlatformApi {
  return {
    getCapabilities: vi.fn().mockResolvedValue({ openaiEnabled: false }),
    listProjects: vi.fn(), createProject: vi.fn(), getProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
    listSources: vi.fn(), createSource: vi.fn(), importContext: vi.fn(), updateSource: vi.fn(), deleteSource: vi.fn(), listSourceSegments: vi.fn(),
    listAnalysisRuns: vi.fn(), createAnalysisRun: vi.fn(), getAnalysisRun: vi.fn(), deleteAnalysisRun: vi.fn(),
    listAnalysisRunStepEvents: vi.fn().mockResolvedValue([]), listAnalysisRunAnnotations: vi.fn().mockResolvedValue([]), createAnalysisRunAnnotation: vi.fn(),
    listShareLinks: vi.fn(), createShareLink: vi.fn(), revokeShareLink: vi.fn(), resolveSharedAnalysis: vi.fn(),
  };
}
