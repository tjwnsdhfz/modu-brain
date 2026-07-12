import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformApi } from "../services/platformApi";
import AccountSafetyPanel from "./AccountSafetyPanel";

afterEach(() => vi.restoreAllMocks());

describe("AccountSafetyPanel", () => {
  it("downloads an allowlisted account export", async () => {
    const exportAccount = vi.fn().mockResolvedValue({
      schemaVersion: "1.0",
      generatedAt: "2026-07-12T00:00:00Z",
      data: { projects: [] },
    });
    const api = { exportAccount, deleteAccount: vi.fn() } as unknown as PlatformApi;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:account-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(<AccountSafetyPanel api={api} token="cookie-session" onAccountDeleted={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "내 데이터 내려받기" }));

    expect(exportAccount).toHaveBeenCalledWith("cookie-session");
    expect(await screen.findByRole("status")).toHaveTextContent("계정 데이터 JSON 파일을 만들었습니다.");
  });

  it("requires the exact Korean confirmation before permanent deletion", async () => {
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    const onAccountDeleted = vi.fn().mockResolvedValue(undefined);
    const api = { exportAccount: vi.fn(), deleteAccount } as unknown as PlatformApi;
    const user = userEvent.setup();

    render(<AccountSafetyPanel api={api} token="cookie-session" onAccountDeleted={onAccountDeleted} />);
    await user.click(screen.getByRole("button", { name: "계정 영구 삭제" }));
    const confirmation = screen.getByLabelText("확인 문구");
    const submit = screen.getByRole("button", { name: "모든 데이터와 계정 삭제" });
    expect(submit).toBeDisabled();

    await user.type(confirmation, "내 계정 삭제");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(deleteAccount).toHaveBeenCalledWith("cookie-session", "delete my account");
    expect(onAccountDeleted).toHaveBeenCalledTimes(1);
  });

  it("announces deletion failures inside the modal and restores focus on Escape", async () => {
    const deleteAccount = vi.fn().mockRejectedValue(new Error("계정 삭제를 완료하지 못했습니다."));
    const api = { exportAccount: vi.fn(), deleteAccount } as unknown as PlatformApi;
    const user = userEvent.setup();
    render(<AccountSafetyPanel api={api} token="cookie-session" onAccountDeleted={vi.fn()} />);

    const open = screen.getByRole("button", { name: "계정 영구 삭제" });
    await user.click(open);
    const confirmation = screen.getByLabelText("확인 문구");
    expect(confirmation).toHaveFocus();

    await user.type(confirmation, "내 계정 삭제");
    await user.click(screen.getByRole("button", { name: "모든 데이터와 계정 삭제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("계정 삭제를 완료하지 못했습니다.");
    expect(confirmation).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});
