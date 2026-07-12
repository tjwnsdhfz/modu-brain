import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthRequestError, type AuthService } from "../services/auth";
import LoginPage from "./LoginPage";

describe("LoginPage", () => {
  it("starts a 60 second resend cooldown after a magic link is sent", async () => {
    const user = userEvent.setup();
    const auth = authMock();
    vi.mocked(auth.sendMagicLink).mockResolvedValue({ email: "team@example.com" });
    render(<LoginPage auth={auth} onGuestContinue={vi.fn()} />);

    await user.type(screen.getByLabelText("이메일"), "team@example.com");
    await user.click(screen.getByRole("button", { name: "로그인 링크 받기" }));

    expect(await screen.findByRole("heading", { name: "로그인 링크를 보냈습니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "60초 후 다시 보내기" })).toBeDisabled();
  });

  it("explains a 429 Retry-After response and prevents immediate retries", async () => {
    const user = userEvent.setup();
    const auth = authMock();
    vi.mocked(auth.sendMagicLink).mockRejectedValue(
      new AuthRequestError("rate limit", 429, 75),
    );
    render(<LoginPage auth={auth} onGuestContinue={vi.fn()} />);

    await user.type(screen.getByLabelText("이메일"), "team@example.com");
    await user.click(screen.getByRole("button", { name: "로그인 링크 받기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("75초 후 로그인 링크를 다시 요청");
    expect(screen.getByRole("button", { name: "75초 후 다시 요청 가능" })).toBeDisabled();
  });
});

function authMock(): AuthService {
  return {
    isConfigured: () => true,
    restoreSession: vi.fn(),
    refreshSession: vi.fn(),
    consumeCallback: vi.fn(),
    sendMagicLink: vi.fn(),
    signOut: vi.fn(),
  };
}
