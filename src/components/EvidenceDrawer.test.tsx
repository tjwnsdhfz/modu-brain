import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EvidenceDrawer from "./EvidenceDrawer";

const evidence = [{
  sourceRecordId: "source-1",
  sourceTitle: "회의",
  quote: "확인",
}];

describe("EvidenceDrawer external backlinks", () => {
  it("shows an external URL only for one unambiguous containing segment", () => {
    render(
      <EvidenceDrawer
        evidence={evidence}
        segments={[segment("segment-1", "결정 내용을 확인합니다.", "https://example.test/1")]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "외부 원문 위치 열기" })).toHaveAttribute(
      "href",
      "https://example.test/1",
    );
    expect(screen.getByLabelText("스냅숏 검증 전체 연결 · 1/1 · 인용 1개")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("외부 원본 위치 1개");
  });

  it("does not guess when the same quote appears in multiple segments", () => {
    render(
      <EvidenceDrawer
        evidence={evidence}
        segments={[
          segment("segment-1", "첫 번째 확인", "https://example.test/1"),
          segment("segment-2", "두 번째 확인", "https://example.test/2"),
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: "외부 원문 위치 열기" })).not.toBeInTheDocument();
    expect(screen.getByText("확인")).toBeInTheDocument();
  });
});

function segment(id: string, text: string, sourceUrl: string) {
  return {
    id,
    sourceRecordId: "source-1",
    ordinal: 0,
    speaker: "민지",
    text,
    occurredAt: "2026-07-11T00:00:00Z",
    externalId: id,
    sourceUrl,
  };
}
