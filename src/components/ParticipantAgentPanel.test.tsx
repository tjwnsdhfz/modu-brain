import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "../data/sampleAnalysis";
import ParticipantAgentPanel from "./ParticipantAgentPanel";

describe("ParticipantAgentPanel", () => {
  it("presents tension, agreement, and participant risk as a linked reading rail", () => {
    render(<ParticipantAgentPanel synthesis={sampleAnalysis.participantAgents} />);

    const navigation = screen.getByRole("navigation", { name: "참여자 관점 종합 읽기 순서" });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#agent-step-tension",
      "#agent-step-agreement",
      "#agent-step-views",
    ]);
    expect(screen.getByRole("heading", { name: "관점 충돌 · 먼저 확인" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "참여자별 다음 확인" })).toBeInTheDocument();
  });
});
