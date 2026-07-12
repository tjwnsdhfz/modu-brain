import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sampleAnalysis, sampleInput } from "./data/sampleAnalysis";
import type { AuthService, AuthSession } from "./services/auth";
import { COOKIE_SESSION_SENTINEL } from "./services/auth";
import {
  ContextAnalysisRequestError,
  analyzeImportedContext,
} from "./services/analyzeContext";
import type { PlatformApi } from "./services/platformApi";
import type { ContextAnalysisResult } from "./types/context";

vi.mock("./services/analyzeContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/analyzeContext")>();
  return { ...actual, analyzeImportedContext: vi.fn() };
});

const analyzeImportedContextMock = vi.mocked(analyzeImportedContext);

beforeEach(() => {
  analyzeImportedContextMock.mockReset();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
});

afterEach(() => vi.useRealTimers());

describe("public landing prototype", () => {
  it("opens a deterministic sample directly from the public demo route", () => {
    window.history.replaceState(null, "", "/demo");
    render(<App auth={anonymousAuth()} />);

    expect(screen.getByRole("heading", { name: "로그인 없이 확인하는 근거 기반 맥락 분석" })).toBeInTheDocument();
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
    expect(screen.getByLabelText(/기록 제목/)).toHaveValue(sampleAnalysis.projectTitle);
    expect(screen.getByLabelText("회의 맥락 붙여넣기")).toHaveValue(sampleInput);
    expect(screen.getByRole("link", { name: "공개 데모" })).toHaveAttribute("aria-current", "page");
  });

  it("restores the deterministic sample after leaving and reopening the demo route", async () => {
    window.history.replaceState(null, "", "/demo");
    const user = userEvent.setup();
    render(<App auth={anonymousAuth()} />);

    const input = screen.getByLabelText("회의 맥락 붙여넣기");
    await user.clear(input);
    await user.type(input, "편집 중인 임시 내용");
    expect(input).toHaveValue("편집 중인 임시 내용");

    await user.click(screen.getByRole("link", { name: "Modu Brain 홈" }));
    await user.click(screen.getByRole("link", { name: "공개 데모" }));

    expect(screen.getByLabelText("회의 맥락 붙여넣기")).toHaveValue(sampleInput);
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
  });

  it("starts empty and labels data as sample only after an explicit load", async () => {
    const user = userEvent.setup();
    render(<App auth={anonymousAuth()} />);

    expect(screen.getByText("분석 대기")).toBeInTheDocument();
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/기록 제목/)).toHaveValue("");
    expect(screen.getByLabelText("회의 맥락 붙여넣기")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));

    expect(screen.getByLabelText(/기록 제목/)).toHaveValue(sampleAnalysis.projectTitle);
    expect(screen.getByLabelText("회의 맥락 붙여넣기")).toHaveValue(sampleInput);
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
  });

  it("imports and analyzes external context without requiring a login", async () => {
    const user = userEvent.setup();
    analyzeImportedContextMock.mockResolvedValue({
      import: {
        provider: "paste",
        title: "붙여넣은 후속 회의",
        content: sampleInput,
        participantCount: 3,
        segmentCount: 1,
      },
      result: sampleAnalysis,
    });
    render(<App auth={anonymousAuth()} />);

    fireEvent.change(screen.getByLabelText("회의 맥락 붙여넣기"), { target: { value: sampleInput } });
    await user.click(screen.getByRole("button", { name: "가져와 바로 분석" }));

    expect(analyzeImportedContextMock).toHaveBeenCalledWith({
      provider: "paste",
      text: sampleInput,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await screen.findByText(/맥락을 정리해 분석했습니다/)).toBeInTheDocument();
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: sampleAnalysis.projectTitle })).toBeInTheDocument();
  });

  it("loads the sample from the primary hero action and surfaces context before summary", async () => {
    const user = userEvent.setup();
    render(<App auth={anonymousAuth()} />);

    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));

    expect(window.location.pathname).toBe("/demo");
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "요약 전에 확인할 맥락" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: sampleAnalysis.projectTitle })).toBeInTheDocument();
  });

  it("prevents duplicate submission while loading and renders the provider on success", async () => {
    const user = userEvent.setup();
    const liveResult: ContextAnalysisResult = {
      ...sampleAnalysis,
      projectTitle: "실시간 분석 결과",
      summary: { ...sampleAnalysis.summary, projectTitle: "실시간 분석 결과" },
      provider: { mode: "mock", name: "local-heuristic", usedExternalModel: false },
    };
    const importedResult = {
      import: {
        provider: "paste" as const,
        title: sampleAnalysis.projectTitle,
        content: sampleInput,
        participantCount: 3,
        segmentCount: 1,
      },
      result: liveResult,
    };
    let resolveAnalysis: (result: typeof importedResult) => void = () => undefined;
    const pending = new Promise<typeof importedResult>((resolve) => { resolveAnalysis = resolve; });
    analyzeImportedContextMock.mockReturnValue(pending);
    render(<App auth={anonymousAuth()} />);

    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));
    await user.click(screen.getByRole("button", { name: "가져와 바로 분석" }));

    expect(screen.getByRole("button", { name: "정리하는 중…" })).toBeDisabled();
    expect(screen.getByText("분석 중")).toBeInTheDocument();
    expect(analyzeImportedContextMock).toHaveBeenCalledTimes(1);

    await act(async () => { resolveAnalysis(importedResult); await pending; });
    expect(await screen.findByText("local-heuristic 분석 결과")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "실시간 분석 결과" })).toBeInTheDocument();
  });

  it("cancels an in-flight request when leaving the public demo", async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    analyzeImportedContextMock.mockImplementation((_input, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });
    render(<App auth={anonymousAuth()} />);

    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));
    await user.click(screen.getByRole("button", { name: "가져와 바로 분석" }));
    expect(signal?.aborted).toBe(false);
    await user.click(screen.getByRole("link", { name: "Modu Brain 홈" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText("분석 대기")).toBeInTheDocument();
  });

  it("announces a structured API failure and never labels it as success", async () => {
    const user = userEvent.setup();
    analyzeImportedContextMock.mockRejectedValue(new ContextAnalysisRequestError("회의록을 120자 이상 입력하세요.", 400, "RAW_TEXT_TOO_SHORT"));
    render(<App auth={anonymousAuth()} />);

    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));
    await user.click(screen.getByRole("button", { name: "가져와 바로 분석" }));
    expect((await screen.findAllByRole("alert")).some((alert) => alert.textContent?.includes("회의록을 120자 이상 입력하세요."))).toBe(true);
    expect(screen.getByText("분석 오류")).toBeInTheDocument();
    expect(screen.queryByText(/분석 결과$/, { selector: ".demo-badge.success" })).not.toBeInTheDocument();
  });

  it("switches result panels and supports keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<App auth={anonymousAuth()} />);
    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));

    const overview = screen.getByRole("tab", { name: "개요" });
    overview.focus();
    await user.keyboard("{ArrowRight}");
    const map = screen.getByRole("tab", { name: "지식맵" });
    expect(map).toHaveFocus();
    expect(map).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "공유 지식맵" })).toBeInTheDocument();

    await user.keyboard("{End}");
    const onboarding = screen.getByRole("tab", { name: "온보딩 요약" });
    expect(onboarding).toHaveFocus();
    expect(screen.getByRole("heading", { name: "새 팀원 온보딩 요약" })).toBeInTheDocument();
  });

  it("shows honest empty states when the provider finds no structured items", async () => {
    const user = userEvent.setup();
    analyzeImportedContextMock.mockResolvedValue({
      import: {
        provider: "paste",
        title: sampleAnalysis.projectTitle,
        content: sampleInput,
        participantCount: 0,
        segmentCount: 1,
      },
      result: {
        ...sampleAnalysis,
        keyTerms: [], participants: [], decisions: [], questions: [],
        participantAgents: { ...sampleAnalysis.participantAgents, views: [], agreementPoints: [], tensionPoints: [] },
      },
    });
    render(<App auth={anonymousAuth()} />);
    await user.click(screen.getByRole("button", { name: "샘플 직접 체험" }));
    await user.click(screen.getByRole("button", { name: "가져와 바로 분석" }));

    expect(await screen.findByText("입력 기록에서 명시적으로 확인된 결정사항이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("입력 기록에서 명시적으로 확인된 미해결 질문이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("입력 기록에서 참여자별 발언 주체를 구분할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("입력 기록에서 별도로 정의할 핵심 용어가 없습니다.")).toBeInTheDocument();
  });
});

describe("application routes", () => {
  it("sends a Supabase magic link from /login", async () => {
    window.history.replaceState(null, "", "/login");
    const user = userEvent.setup();
    const sendMagicLink = vi.fn().mockResolvedValue({ email: "team@example.com" });
    render(<App auth={anonymousAuth({ configured: true, sendMagicLink })} />);

    await user.type(screen.getByTestId("login-email"), "team@example.com");
    await user.click(screen.getByTestId("login-submit"));

    expect(sendMagicLink).toHaveBeenCalledWith("team@example.com", `${window.location.origin}/login`);
    expect(await screen.findByText("로그인 링크를 보냈습니다")).toBeInTheDocument();
  });

  it("continues to the public demo from login without creating an account", async () => {
    window.history.replaceState(null, "", "/login");
    const user = userEvent.setup();
    render(<App auth={anonymousAuth({ configured: true })} />);

    await user.click(screen.getByRole("button", { name: "로그인 없이 공개 데모 계속" }));

    expect(window.location.pathname).toBe("/demo");
    expect(screen.getByRole("heading", { name: "로그인 없이 확인하는 근거 기반 맥락 분석" })).toBeInTheDocument();
  });

  it("loads the authenticated project list through the injected API", async () => {
    window.history.replaceState(null, "", "/projects");
    const session = signedInSession();
    const api = emptyApi();
    vi.mocked(api.listProjects).mockResolvedValue([{ id: "p1", title: "공모전", description: "시연 프로젝트", archivedAt: null, createdAt: "2026-07-10T00:00:00Z", updatedAt: "2026-07-11T00:00:00Z", sourceCount: 3, analysisCount: 1 }]);

    render(<App auth={anonymousAuth({ session })} api={api} />);

    expect(await screen.findByRole("heading", { name: "내 프로젝트" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /공모전/ })).toHaveTextContent("기록 3 · 분석 1");
    expect(api.listProjects).toHaveBeenCalledWith(session.accessToken);
  });

  it("clears a cookie-backed session immediately after an authenticated API 401", async () => {
    window.history.replaceState(null, "", "/projects");
    const session = signedInSession();
    const api = emptyApi();
    vi.mocked(api.listProjects).mockResolvedValue([]);
    render(<App auth={anonymousAuth({ session })} api={api} />);
    expect(await screen.findByRole("heading", { name: "내 프로젝트" })).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("modu-brain:auth-required")));

    expect(window.location.pathname).toBe("/login");
    expect(screen.getByRole("alert")).toHaveTextContent("로그인 세션이 만료되었습니다");
  });

  it("refreshes the session before expiry and clears it with a login notice on failure", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-11T00:00:00Z");
    vi.setSystemTime(now);
    const initial = {
      ...signedInSession(),
      expiresAt: now.getTime() + 120_000,
    };
    const refreshed = {
      ...initial,
      expiresAt: now.getTime() + 180_000,
    };
    const refreshSession = vi
      .fn<AuthService["refreshSession"]>()
      .mockResolvedValueOnce(refreshed)
      .mockRejectedValueOnce(new Error("refresh expired"));
    const auth = anonymousAuth({ session: initial, refreshSession });

    render(<App auth={auth} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refreshSession).toHaveBeenNthCalledWith(1, initial);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refreshSession).toHaveBeenNthCalledWith(2, refreshed);
    expect(screen.getByRole("alert")).toHaveTextContent("다시 로그인해 주세요.");
    expect(screen.getByRole("link", { name: "로그인" })).toBeInTheDocument();
  });
});

function anonymousAuth(options: {
  configured?: boolean;
  session?: AuthSession | null;
  sendMagicLink?: AuthService["sendMagicLink"];
  refreshSession?: AuthService["refreshSession"];
} = {}): AuthService {
  return {
    isConfigured: () => options.configured ?? false,
    restoreSession: vi.fn().mockResolvedValue(options.session ?? null),
    refreshSession:
      options.refreshSession ?? vi.fn().mockRejectedValue(new Error("not configured")),
    consumeCallback: vi.fn().mockResolvedValue(null),
    sendMagicLink: options.sendMagicLink ?? vi.fn().mockRejectedValue(new Error("not configured")),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

function signedInSession(): AuthSession {
  return { accessToken: COOKIE_SESSION_SENTINEL, expiresAt: Date.now() + 3_600_000, user: { id: "u1", email: "team@example.com" } };
}

function emptyApi(): PlatformApi {
  return {
    getCapabilities: vi.fn().mockResolvedValue({ openaiEnabled: false }),
    listProjects: vi.fn(), createProject: vi.fn(), getProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
    listSources: vi.fn(), createSource: vi.fn(), importContext: vi.fn(), updateSource: vi.fn(), deleteSource: vi.fn(), listSourceSegments: vi.fn(),
    listAnalysisRuns: vi.fn(), createAnalysisRun: vi.fn(), getAnalysisRun: vi.fn(), deleteAnalysisRun: vi.fn(),
    listAnalysisRunStepEvents: vi.fn().mockResolvedValue([]), listAnalysisRunAnnotations: vi.fn().mockResolvedValue([]), createAnalysisRunAnnotation: vi.fn(),
    listShareLinks: vi.fn(), createShareLink: vi.fn(), revokeShareLink: vi.fn(), resolveSharedAnalysis: vi.fn(),
  };
}
