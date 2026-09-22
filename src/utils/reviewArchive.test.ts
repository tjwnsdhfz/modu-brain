import { describe, it, expect } from "vitest";
import { sampleAnalysis, sampleInput } from "../data/sampleAnalysis";
import {
  parseReviewArchive,
  serializeReviewArchive,
  reviewMarkdown,
} from "./reviewArchive";
const input = { provider: "paste" as const, text: sampleInput, title: "회의" };
describe("portable context review", () => {
  it("preserves exact input, result, edited report and sample label", () => {
    const result = parseReviewArchive(
      serializeReviewArchive(
        input,
        sampleAnalysis,
        "검토자가 수정한 문서",
        true,
      ),
    );
    expect(result.input).toEqual(input);
    expect(result.result).toEqual(sampleAnalysis);
    expect(result.report).toBe("검토자가 수정한 문서");
    expect(result.sample).toBe(true);
  });
  it("exports source-grounded sections without promoting inference to verification", () => {
    const text = reviewMarkdown(sampleAnalysis);
    expect(text).toContain("분석 초안");
    expect(text).toContain(sampleAnalysis.decisions[0].decision);
    expect(text).toContain("## 남은 질문");
    expect(reviewMarkdown(sampleAnalysis, true)).toContain("합성 샘플");
  });
  it.each([
    "invalid",
    "{}",
    JSON.stringify({ format: "modu-review", version: 2 }),
  ])("rejects malformed archives", (text) => {
    expect(() => parseReviewArchive(text)).toThrow();
  });
  it("supports public heuristic quote strings as well as project evidence references", () => {
    const result = structuredClone(sampleAnalysis);
    Reflect.set(result.decisions[0], "evidence", ["정확한 입력 문장"]);
    expect(reviewMarkdown(result)).toContain("정확한 입력 문장");
    expect(
      parseReviewArchive(serializeReviewArchive(input, result, "문서", false))
        .result.decisions[0].evidence,
    ).toEqual(["정확한 입력 문장"]);
  });
  it("rejects malformed optional evidence and confidence instead of crashing the view", () => {
    const archive = JSON.parse(
      serializeReviewArchive(input, sampleAnalysis, "문서", false),
    );
    archive.result.decisions[0].evidence = [23];
    expect(() => parseReviewArchive(JSON.stringify(archive))).toThrow();
  });
  it("rejects invalid result structures and excessive files", () => {
    const archive = JSON.parse(
      serializeReviewArchive(input, sampleAnalysis, "문서", false),
    );
    archive.result.decisions = [{ decision: 4 }];
    expect(() => parseReviewArchive(JSON.stringify(archive))).toThrow();
    expect(() => parseReviewArchive(" ".repeat(1048577))).toThrow("1MB");
  });
});
