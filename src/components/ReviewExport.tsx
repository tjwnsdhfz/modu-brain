import { useState } from "react";
import type { ContextAnalysisResult } from "../types/context";
import type { ContextImportInput } from "./ContextImportPanel";
import {
  downloadReview,
  reviewMarkdown,
  serializeReviewArchive,
} from "../utils/reviewArchive";

export default function ReviewExport({
  result,
  input,
  sample,
  initialReport,
}: {
  result: ContextAnalysisResult;
  input: ContextImportInput;
  sample: boolean;
  initialReport?: string;
}) {
  const [report, setReport] = useState(
    () => initialReport ?? reviewMarkdown(result, sample),
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  function download(archive: boolean) {
    try {
      setError("");
      const content = archive
        ? serializeReviewArchive(input, result, report, sample)
        : report;
      downloadReview(
        content,
        archive ? "modu-review.json" : "modu-review.md",
        archive ? "application/json" : "text/markdown;charset=utf-8",
      );
      setNotice(
        archive
          ? "입력·분석·검토 문서 백업을 내려받았습니다. 위의 백업 열기로 다시 사용할 수 있습니다."
          : "검토 문서를 Markdown으로 내려받았습니다.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "다운로드를 준비하지 못했습니다. 문서를 복사해 보관하세요.",
      );
    }
  }
  return (
    <section className="review-export" aria-labelledby="review-export-title">
      <div className="panel-heading">
        <p className="section-kicker">검토하고 가져가기</p>
        <h2 id="review-export-title">팀에 전달할 문서로 다듬으세요</h2>
        <p>
          원문을 대조하고 아래 문서를 수정하세요. 분석 원본은 유지됩니다.
          다운로드 파일에는 입력과 인용이 포함될 수 있으니 공유 전 확인하세요.
        </p>
      </div>
      <label htmlFor="review-document">검토 문서 · Markdown</label>
      <textarea
        id="review-document"
        maxLength={100000}
        value={report}
        onChange={(e) => setReport(e.target.value)}
        rows={12}
      />
      <div className="review-export-actions">
        <button className="button primary" onClick={() => download(false)}>
          검토 문서 다운로드
        </button>
        <button className="button secondary" onClick={() => download(true)}>
          입력과 결과 백업
        </button>
      </div>
      <p role="status">{notice}</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
