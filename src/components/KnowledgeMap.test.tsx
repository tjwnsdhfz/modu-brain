import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleAnalysis } from "../data/sampleAnalysis";
import type { ContextAnalysisResult } from "../types/context";
import KnowledgeMap from "./KnowledgeMap";

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

const dynamicMap: ContextAnalysisResult["knowledgeMap"] = {
  nodes: [
    {
      id: "topic-main",
      label: "동적 프로젝트",
      type: "topic",
      summary: "분석 API가 생성한 중심 주제",
    },
    {
      id: "person-1",
      label: "민지",
      type: "person",
      summary: "입력 흐름 관점",
    },
    {
      id: "decision-1",
      label: "직접 입력 MVP",
      type: "decision",
      summary: "직접 입력 방식으로 시작",
      evidence: [{ sourceRecordId: "source-1", sourceTitle: "첫 회의", quote: "직접 입력으로 시작한다." }],
    },
    {
      id: "question-1",
      label: "다음 회의 질문",
      type: "question",
      summary: "다음 회의 확인 질문",
    },
  ],
  links: [
    { from: "person-1", to: "topic-main", relation: "관점 제공" },
    { from: "topic-main", to: "decision-1", relation: "결정사항" },
    { from: "decision-1", to: "question-1", relation: "추가 확인 필요" },
    { from: "missing", to: "question-1", relation: "고아 연결" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("KnowledgeMap", () => {
  it("defaults to the interactive graph and toggles to the semantic relationship list", async () => {
    const user = userEvent.setup();
    render(<KnowledgeMap map={dynamicMap} />);

    const canvas = screen.getByTestId("brain-canvas");
    expect(screen.getByRole("button", { name: "그래프 보기" })).toHaveAttribute("aria-pressed", "true");
    expect(within(canvas).getByRole("img", { name: /프로젝트 맥락 지도/ })).toBeInTheDocument();
    expect(within(canvas).getByTestId("brain-node-brain-topic-topic-main")).toHaveAccessibleName(
      "중심 주제 생각: 동적 프로젝트",
    );
    expect(within(canvas).getByTestId("brain-node-brain-perspective-person-1")).toBeInTheDocument();
    expect(within(canvas).getByTestId("brain-node-brain-decision-decision-1")).toHaveClass("brain-kind-decision");
    expect(within(canvas).getByTestId("brain-node-brain-question-question-1")).toHaveClass("brain-kind-question");

    await user.click(screen.getByRole("button", { name: "의미 목록" }));
    expect(screen.getByRole("button", { name: "의미 목록" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "생각과 연결 관계 목록" })).toBeInTheDocument();
    expect(screen.queryByText("고아 연결")).not.toBeInTheDocument();
  });

  it("selects a thought, exposes typed relationships, and opens its evidence", async () => {
    const user = userEvent.setup();
    const onOpenEvidence = vi.fn();
    render(<KnowledgeMap map={dynamicMap} onOpenEvidence={onOpenEvidence} />);

    const decision = screen.getByTestId("brain-node-brain-decision-decision-1");
    await user.click(decision);

    expect(decision).toHaveAttribute("aria-pressed", "true");
    const inspector = screen.getByRole("complementary", { name: "선택한 생각 상세" });
    expect(within(inspector).getByRole("heading", { name: "직접 입력 MVP" })).toBeInTheDocument();
    expect(within(inspector).getByRole("button", {
      name: "추가 확인 필요: 질문 다음 회의 질문",
    })).toBeInTheDocument();

    await user.click(within(inspector).getByRole("button", { name: "근거 1개 열기" }));
    expect(onOpenEvidence).toHaveBeenCalledWith(dynamicMap.nodes[2].evidence);
  });

  it("uses roving focus, directional navigation, Enter selection, Escape clearing, and zoom shortcuts", async () => {
    const user = userEvent.setup();
    const { container } = render(<KnowledgeMap result={sampleAnalysis} />);

    const thoughtButtons = screen.getAllByRole("button", { name: /생각:/ });
    expect(thoughtButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1);

    const perspective = screen.getByTestId("brain-node-brain-perspective-participant-hyunwoo");
    perspective.focus();
    await user.keyboard("{ArrowRight}");
    const focused = document.activeElement as HTMLButtonElement;
    expect(focused).not.toBe(perspective);
    expect(focused).toHaveAttribute("tabindex", "0");

    await user.keyboard("{Enter}");
    expect(focused).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(focused).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("생각을 선택하면 내용과 연결 관계가 여기에 표시됩니다.")).toBeInTheDocument();

    await user.keyboard("+");
    expect(container.querySelector(".brain-zoom-value")).toHaveTextContent("125%");
    await user.keyboard("-");
    expect(container.querySelector(".brain-zoom-value")).toHaveTextContent("100%");
    await user.keyboard("+");
    await user.keyboard("0");
    expect(container.querySelector(".brain-zoom-value")).toHaveTextContent("100%");
    expect(container.querySelector(".brain-zoom-value")).toHaveAttribute("aria-live", "polite");
    await user.click(screen.getByRole("button", { name: "그래프 확대" }));
    expect(container.querySelector(".brain-zoom-value")).toHaveTextContent("125%");
    await user.click(screen.getByRole("button", { name: "그래프 배율 초기화" }));
    expect(container.querySelector(".brain-zoom-value")).toHaveTextContent("100%");
  });

  it("keeps category filtering and search in both representations", async () => {
    const user = userEvent.setup();
    render(<KnowledgeMap result={sampleAnalysis} />);

    const questionFilter = screen.getByRole("button", { name: "질문 3" });
    await user.click(questionFilter);
    expect(questionFilter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /질문 생각:/ })).toHaveLength(3);

    const search = screen.getByRole("searchbox", { name: "생각 검색" });
    await user.type(search, "개인정보");
    expect(screen.getByRole("status")).toHaveTextContent("2개 생각을 표시합니다.");
    expect(screen.getAllByRole("button", { name: /개인정보 주의 문구/ }).length).toBeGreaterThan(0);

    await user.clear(search);
    await user.type(search, "존재하지 않는 생각");
    expect(screen.getByRole("status")).toHaveTextContent("검색 조건과 일치하는 생각이 없습니다.");
    expect(screen.getByText("필터나 검색어를 바꿔 다른 생각을 찾아보세요.")).toBeInTheDocument();
  });

  it("puts the 21-item semantic summary before the graph on compact screens", () => {
    mockMedia({ compact: true });
    const largeMap: ContextAnalysisResult["knowledgeMap"] = {
      nodes: [
        { id: "topic", label: "모바일 맥락", type: "topic", summary: "중심" },
        ...Array.from({ length: 30 }, (_, index) => ({
          id: `person-${index}`,
          label: `관점 ${index}`,
          type: "person" as const,
          summary: `요약 ${index}`,
        })),
      ],
      links: [],
    };

    render(<KnowledgeMap map={largeMap} />);

    expect(screen.getByRole("button", { name: "의미 목록" })).toHaveAttribute("aria-pressed", "true");
    const outline = screen.getByRole("region", { name: "생각과 연결 의미 목록" });
    const list = within(outline).getByRole("list", { name: "생각과 연결 관계 목록" });
    const stage = screen.getByTestId("brain-stage");
    expect(within(list).getAllByRole("listitem")).toHaveLength(21);
    expect(screen.getByRole("status")).toHaveTextContent("31개 중 21개");
    expect(outline.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("does not auto-pan when reduced motion is requested", async () => {
    mockMedia({ reducedMotion: true });
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    const user = userEvent.setup();
    render(<KnowledgeMap map={dynamicMap} />);

    await user.click(screen.getByTestId("brain-node-brain-decision-decision-1"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("renders an explicit empty state", () => {
    render(<KnowledgeMap map={{ nodes: [], links: [] }} />);
    expect(screen.getByText("분석 결과에서 표시할 생각을 찾지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByTestId("brain-canvas")).not.toBeInTheDocument();
  });
});

function mockMedia({
  compact = false,
  reducedMotion = false,
}: {
  compact?: boolean;
  reducedMotion?: boolean;
}) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("max-width") ? compact : reducedMotion,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as MediaQueryList)));
}
