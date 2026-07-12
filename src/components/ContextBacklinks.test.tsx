import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import type { SourceRecordResource } from "../types/platform";
import ContextBacklinks from "./ContextBacklinks";

describe("ContextBacklinks", () => {
  it("groups analysis evidence by imported source and opens exact quotes", async () => {
    const user = userEvent.setup();
    const sourceId = sampleAnalysis.decisions[0].evidence?.[0]?.sourceRecordId ?? "source-1";
    const source: SourceRecordResource = {
      id: sourceId,
      projectId: "project-1",
      kind: "meeting",
      title: "나중에 변경된 실시간 제목",
      content: "원문",
      charCount: 2,
      occurredAt: null,
      archivedAt: null,
      createdAt: "2026-07-11T00:00:00Z",
      updatedAt: "2026-07-11T00:00:00Z",
      import: {
        id: "import-1",
        provider: "kakaotalk",
        participants: ["서준"],
        segmentCount: 3,
        importedAt: "2026-07-11T00:00:00Z",
      },
    };
    const onOpenEvidence = vi.fn();

    render(
      <ContextBacklinks
        sources={[source]}
        result={sampleAnalysis}
        onOpenEvidence={onOpenEvidence}
      />,
    );

    expect(screen.getByRole("heading", { name: "원문 백링크" })).toBeInTheDocument();
    expect(screen.getByText("카카오톡")).toBeInTheDocument();
    expect(screen.getByText(sampleAnalysis.decisions[0].evidence![0].sourceTitle)).toBeInTheDocument();
    expect(screen.queryByText("나중에 변경된 실시간 제목")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /원문 인용문 열기$/ }));
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: sourceId }),
      ]),
    );
  });

  it("keeps immutable run backlinks after the live source is archived or deleted", () => {
    render(
      <ContextBacklinks
        sources={[]}
        result={sampleAnalysis}
        onOpenEvidence={vi.fn()}
      />,
    );

    expect(screen.getAllByText("분석 스냅숏").length).toBeGreaterThan(0);
    expect(screen.getByText("1개 기록 연결")).toBeInTheDocument();
  });
});
