import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ContextImportPanel, {
  CONTEXT_IMPORT_FILE_LIMIT_BYTES,
  type ContextImportInput,
} from "./ContextImportPanel";

describe("ContextImportPanel", () => {
  it("prefills the single public composer with a deterministic demo payload", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ContextImportPanel
        mode="ephemeral"
        textareaId="public-context-text"
        initialInput={{ provider: "paste", title: "공개 데모", text: "샘플 회의 맥락" }}
        onImport={onImport}
      />,
    );

    expect(screen.getByLabelText("회의 맥락 붙여넣기")).toHaveAttribute("id", "public-context-text");
    expect(screen.getByLabelText("회의 맥락 붙여넣기")).toHaveValue("샘플 회의 맥락");
    expect(screen.getByLabelText(/기록 제목/)).toHaveValue("공개 데모");
    await user.click(screen.getByRole("button", { name: "가져와 바로 분석" }));
    expect(onImport).toHaveBeenCalledWith({
      provider: "paste",
      title: "공개 데모",
      text: "샘플 회의 맥락",
    });
  });

  it("offers account-free provider choices and imports pasted context", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn<(input: ContextImportInput) => Promise<void>>().mockResolvedValue();
    render(<ContextImportPanel onImport={onImport} />);

    expect(screen.getByText("계정 연결 없음")).toBeInTheDocument();
    expect(screen.getByText("내 계정과 연동하지 않습니다.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /바로 붙여넣기/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /카카오톡 내보내기/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Teams JSON/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Notion JSON/ })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /바로 붙여넣기/ }));
    await user.type(screen.getByLabelText(/기록 제목/), "  주간 제품 회의  ");
    await user.type(screen.getByLabelText("회의 맥락 붙여넣기"), "  결정: 금요일까지 시안을 검토한다.  ");
    await user.click(screen.getByRole("button", { name: "파싱하고 가져오기" }));

    expect(onImport).toHaveBeenCalledWith({
      provider: "paste",
      title: "주간 제품 회의",
      text: "결정: 금요일까지 시안을 검토한다.",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("맥락을 가져왔습니다.");
  });

  it("loads a provider-specific demo without a personal account or file", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn<(input: ContextImportInput) => Promise<void>>().mockResolvedValue();
    render(<ContextImportPanel onImport={onImport} />);

    await user.click(screen.getByRole("radio", { name: /Teams JSON/ }));
    await user.click(screen.getByRole("button", { name: "샘플 불러오기" }));

    expect(screen.getByLabelText(/기록 제목/)).toHaveValue("Teams 주간 제품 회의");
    expect(
      (screen.getByLabelText("가져올 내용 확인") as HTMLTextAreaElement).value,
    ).toContain("teams-demo-1");
  });

  it("clears stale payloads when the provider changes", async () => {
    const user = userEvent.setup();
    render(<ContextImportPanel onImport={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "샘플 불러오기" }));
    expect(screen.getByLabelText(/기록 제목/)).not.toHaveValue("");

    await user.click(screen.getByRole("radio", { name: /Notion JSON/ }));

    expect(screen.getByLabelText(/기록 제목/)).toHaveValue("");
    expect(screen.getByLabelText("가져올 내용 확인")).toHaveValue("");
    expect(screen.getByRole("button", { name: "파싱하고 가져오기" })).toBeDisabled();
  });

  it("reads a matching export file and supplies its content", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn<(input: ContextImportInput) => Promise<void>>().mockResolvedValue();
    render(<ContextImportPanel onImport={onImport} />);
    const file = new File(["2026-07-11, 서준 : 안건을 확정합니다."], "기획회의.txt", { type: "text/plain" });

    await user.upload(screen.getByLabelText(/내보내기 파일/), file);
    expect(await screen.findByDisplayValue("2026-07-11, 서준 : 안건을 확정합니다.")).toBeInTheDocument();
    expect(screen.getByLabelText(/기록 제목/)).toHaveValue("기획회의");
    await user.click(screen.getByRole("button", { name: "파싱하고 가져오기" }));

    expect(onImport).toHaveBeenCalledWith({
      provider: "kakaotalk",
      title: "기획회의",
      text: "2026-07-11, 서준 : 안건을 확정합니다.",
    });
  });

  it("detects a Notion JSON file without requiring a provider choice", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn<(input: ContextImportInput) => Promise<void>>().mockResolvedValue();
    render(<ContextImportPanel onImport={onImport} />);
    const file = new File([
      JSON.stringify({
        page: { url: "https://www.notion.so/demo" },
        blocks: [{ paragraph: { rich_text: [{ plain_text: "근거를 연결해 확인합니다." }] } }],
      }),
    ], "회의정리.json", { type: "application/json" });

    await user.upload(screen.getByLabelText(/내보내기 파일/), file);
    expect(screen.getByRole("radio", { name: /Notion JSON/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "파싱하고 가져오기" }));

    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
      provider: "notion",
      title: "회의정리",
    }));
  });

  it("explains that ephemeral imports are analyzed without being stored", () => {
    render(<ContextImportPanel mode="ephemeral" onImport={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole("heading", { name: "계정 없이 외부 기록 바로 정리" })).toBeInTheDocument();
    expect(screen.getByText("저장 안 함")).toBeInTheDocument();
    expect(screen.getByText("이 기록은 저장하지 않습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "가져와 바로 분석" })).toBeDisabled();
  });

  it("rejects files larger than 256KB before importing", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn<(input: ContextImportInput) => Promise<void>>().mockResolvedValue();
    render(<ContextImportPanel onImport={onImport} />);
    const oversizedFile = new File(
      [new Uint8Array(CONTEXT_IMPORT_FILE_LIMIT_BYTES + 1)],
      "큰회의.txt",
      { type: "text/plain" },
    );

    await user.upload(screen.getByLabelText(/내보내기 파일/), oversizedFile);

    expect(await screen.findByRole("alert")).toHaveTextContent("파일은 256KB 이하");
    expect(screen.getByRole("button", { name: "파싱하고 가져오기" })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("announces pending and failed imports without allowing duplicate submission", async () => {
    const user = userEvent.setup();
    let rejectImport: (reason: Error) => void = () => undefined;
    const onImport = vi.fn<(input: ContextImportInput) => Promise<void>>().mockReturnValue(
      new Promise<void>((_resolve, reject) => { rejectImport = reject; }),
    );
    render(<ContextImportPanel onImport={onImport} />);

    await user.click(screen.getByRole("radio", { name: /바로 붙여넣기/ }));
    await user.type(screen.getByLabelText("회의 맥락 붙여넣기"), "다음 회의에서 예산을 확정한다.");
    await user.click(screen.getByRole("button", { name: "파싱하고 가져오기" }));

    expect(screen.getByRole("button", { name: "가져오는 중…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("가져오는 중");
    rejectImport(new Error("가져오기 서버에 연결할 수 없습니다."));

    expect(await screen.findByRole("alert")).toHaveTextContent("가져오기 서버에 연결할 수 없습니다.");
    await waitFor(() => expect(screen.getByRole("button", { name: "파싱하고 가져오기" })).toBeEnabled());
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
