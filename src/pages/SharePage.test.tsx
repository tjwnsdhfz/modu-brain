import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import type { PlatformApi } from "../services/platformApi";
import type { PublicContextAnalysisResult } from "../types/platform";
import SharePage from "./SharePage";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("SharePage", () => {
  it("resolves the fragment token and renders only the sanitized analysis", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/share#token=share-secret-abcdefghijklmnopqrstuvwxyz123456");
    const api = apiMock();
    vi.mocked(api.resolveSharedAnalysis).mockResolvedValue({
      projectTitle: "공유 프로젝트",
      result: withoutProvider(sampleAnalysis),
      completedAt: "2026-07-11T00:00:00Z",
      expiresAt: "2026-07-18T00:00:00Z",
    });
    render(<SharePage api={api} />);

    expect(await screen.findByRole("heading", { name: "공유 프로젝트" })).toBeInTheDocument();
    expect(screen.getByText("수정 불가")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "공유 개인정보 주의" })).toHaveTextContent(
      "근거 인용문에는 입력 원문의 일부",
    );
    expect(screen.getByRole("heading", { name: "참여자별 관점 차이" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "현재 확정된 결정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "아직 열린 질문" })).toBeInTheDocument();
    const canvas = screen.getByTestId("brain-canvas");
    await user.click(within(canvas).getByTestId("brain-node-brain-decision-decision-direct-input"));
    expect(screen.getByRole("complementary", { name: "선택한 생각 상세" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /근거 \d+개 열기/ })).not.toBeInTheDocument();
    expect(api.resolveSharedAnalysis).toHaveBeenCalledWith("share-secret-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("rejects a fragment without a share token before calling the API", () => {
    window.history.replaceState(null, "", "/share#unrelated=value");
    const api = apiMock();
    render(<SharePage api={api} />);
    expect(screen.getByRole("alert")).toHaveTextContent("공유 토큰이 없습니다.");
    expect(api.resolveSharedAnalysis).not.toHaveBeenCalled();
  });

  it("renders expired or revoked share errors", async () => {
    window.history.replaceState(null, "", "/share#token=expired-token-abcdefghijklmnopqrstuvwxyz1234");
    const api = apiMock();
    vi.mocked(api.resolveSharedAnalysis).mockRejectedValue(new Error("공유 링크가 만료되었거나 폐기되었습니다."));
    render(<SharePage api={api} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("공유 링크가 만료되었거나 폐기되었습니다.");
  });
});

function withoutProvider(result: typeof sampleAnalysis): PublicContextAnalysisResult {
  const clone: Partial<typeof sampleAnalysis> = { ...result };
  delete clone.provider;
  return clone as PublicContextAnalysisResult;
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
