import { useMemo, useRef, useState, type FormEvent } from "react";
import type { ContextAnalysisResultV2 } from "../types/context";
import type {
  AnalysisAnnotationTargetType,
  AnalysisAnnotationType,
  AnalysisRunAnnotationResource,
  CreateAnalysisRunAnnotationInput,
} from "../types/platform";

type TargetOption = {
  value: string;
  type: AnalysisAnnotationTargetType;
  id?: string;
  label: string;
};

function AnalysisFeedbackPanel({
  result,
  annotations,
  loading,
  onCreate,
}: {
  result: ContextAnalysisResultV2;
  annotations: AnalysisRunAnnotationResource[];
  loading: boolean;
  onCreate: (
    input: CreateAnalysisRunAnnotationInput,
    idempotencyKey: string,
  ) => Promise<AnalysisRunAnnotationResource>;
}) {
  const targets = useMemo(() => buildTargets(result), [result]);
  const [targetValue, setTargetValue] = useState("run");
  const [annotationType, setAnnotationType] = useState<AnalysisAnnotationType>("correction");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const target = targets.find((item) => item.value === targetValue) ?? targets[0];
    const normalizedBody = body.trim();
    if (!target || !normalizedBody || submitting) return;
    const input: CreateAnalysisRunAnnotationInput = {
      annotationType,
      targetType: target.type,
      ...(target.id ? { targetId: target.id } : {}),
      body: normalizedBody,
    };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: createIdempotencyKey() };
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await onCreate(input, attempt.current.key);
      attempt.current = null;
      setBody("");
      setMessage("검토 메모를 불변 이력으로 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검토 메모를 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="analysis-feedback-panel" aria-labelledby="analysis-feedback-title">
      <div className="panel-heading compact">
        <p className="section-kicker">Human review</p>
        <h2 id="analysis-feedback-title">결과 정정과 검토 메모</h2>
        <p>기존 분석을 덮어쓰지 않습니다. 잘못된 화자, 결정 여부, 해결된 질문을 이력으로 남깁니다.</p>
      </div>

      <form className="analysis-feedback-form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>검토 대상</span>
          <select value={targetValue} onChange={(event) => { setTargetValue(event.target.value); attempt.current = null; }}>
            {targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>검토 유형</span>
          <select value={annotationType} onChange={(event) => { setAnnotationType(event.target.value as AnalysisAnnotationType); attempt.current = null; }}>
            <option value="correction">내용 정정</option>
            <option value="confirmation">확인 또는 해결</option>
            <option value="question">추가 확인 질문</option>
            <option value="note">검토 메모</option>
          </select>
        </label>
        <label className="field feedback-body-field">
          <span>메모</span>
          <textarea
            value={body}
            minLength={1}
            maxLength={2_000}
            placeholder="예: 이 항목은 결정이 아니라 제안입니다."
            onChange={(event) => { setBody(event.target.value); attempt.current = null; }}
            required
          />
        </label>
        <button className="button secondary" type="submit" disabled={submitting || !body.trim()}>
          {submitting ? "저장 중…" : "검토 이력 저장"}
        </button>
      </form>
      {message && <p className="feedback-status" role="status">{message}</p>}

      <div className="analysis-annotation-history">
        <h3>저장된 검토 이력</h3>
        {loading ? <p role="status">검토 이력을 불러오는 중…</p> : annotations.length === 0 ? (
          <p className="empty-card">아직 저장된 정정이나 검토 메모가 없습니다.</p>
        ) : (
          <ol>
            {annotations.map((annotation) => (
              <li key={annotation.id}>
                <div><strong>{annotationTypeLabel(annotation.annotationType)}</strong><span>{targetLabel(annotation, targets)}</span></div>
                <p>{annotation.body}</p>
                <time dateTime={annotation.createdAt}>{formatDateTime(annotation.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function buildTargets(result: ContextAnalysisResultV2): TargetOption[] {
  const options: TargetOption[] = [{ value: "run", type: "run", label: "분석 실행 전체" }];
  const add = (
    type: AnalysisAnnotationTargetType,
    items: { id?: string; label: string }[],
  ) => {
    for (const item of items) {
      if (!item.id) continue;
      options.push({ value: `${type}:${item.id}`, type, id: item.id, label: item.label });
    }
  };
  add("decision", result.decisions.map((item) => ({ id: item.id, label: `결정 · ${item.decision}` })));
  add("participant", result.participants.map((item) => ({ id: item.id, label: `참여자 · ${item.actor}` })));
  add("question", result.questions.map((item) => ({ id: item.id, label: `질문 · ${item.question}` })));
  add("term", result.keyTerms.map((item) => ({ id: item.id, label: `용어 · ${item.term}` })));
  add("knowledge_node", result.knowledgeMap.nodes.map((item) => ({ id: item.id, label: `지식맵 · ${item.label}` })));
  add("participant_view", result.participantAgents.views.map((item) => ({ id: item.id, label: `관점 · ${item.actor}` })));
  return options;
}

function targetLabel(annotation: AnalysisRunAnnotationResource, targets: TargetOption[]) {
  const value = annotation.target.id
    ? `${annotation.target.type}:${annotation.target.id}`
    : annotation.target.type;
  return targets.find((target) => target.value === value)?.label ?? "분석 실행 전체";
}

function annotationTypeLabel(type: AnalysisAnnotationType) {
  return { confirmation: "확인·해결", correction: "내용 정정", question: "추가 질문", note: "검토 메모" }[type];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function createIdempotencyKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default AnalysisFeedbackPanel;
