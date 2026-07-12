import { ContextAnalysisApiError } from "./contextAnalysisErrors.mjs";
import { analyzeWithOpenAI } from "./providers/openaiContextAnalysis.mjs";

const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 120;
const MIN_RAW_TEXT_LENGTH = 120;
const MAX_RAW_TEXT_LENGTH = 20000;
export const providerTelemetrySymbol = Symbol.for("modu-brain.provider-telemetry");

const COMMON_NON_ACTORS = new Set([
  "오늘",
  "팀은",
  "팀",
  "모든",
  "참여자",
  "사용자",
  "서비스",
  "프로젝트",
  "회의록",
  "멘토",
  "다음",
  "아직",
  "논의",
  "기록",
  "결정",
  "분석",
  "기능",
  "화면",
  "개발",
  "내용",
  "보고서",
  "근거",
  "의견",
  "이번",
  "현재",
]);

export { ContextAnalysisApiError } from "./contextAnalysisErrors.mjs";

export function validateContextAnalysisRequest(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ContextAnalysisApiError(400, "INVALID_JSON", "요청 본문은 JSON 객체여야 합니다.");
  }

  const projectTitle = typeof payload.projectTitle === "string" ? payload.projectTitle.trim() : "";
  const rawText = typeof payload.rawText === "string" ? payload.rawText.trim() : "";

  const projectTitleLength = unicodeLength(projectTitle);
  if (projectTitleLength < MIN_TITLE_LENGTH || projectTitleLength > MAX_TITLE_LENGTH) {
    throw new ContextAnalysisApiError(
      400,
      "INVALID_PROJECT_TITLE",
      "프로젝트 이름을 2자 이상 120자 이하로 입력하세요.",
      {
        minLength: MIN_TITLE_LENGTH,
        maxLength: MAX_TITLE_LENGTH,
      },
    );
  }

  const rawTextLength = unicodeLength(rawText);
  if (rawTextLength < MIN_RAW_TEXT_LENGTH) {
    throw new ContextAnalysisApiError(400, "RAW_TEXT_TOO_SHORT", "회의록, 메모, 피드백을 120자 이상 입력하세요.", {
      minLength: MIN_RAW_TEXT_LENGTH,
      currentLength: rawTextLength,
    });
  }

  const maxRawTextLength = options.maxRawTextLength || MAX_RAW_TEXT_LENGTH;
  if (rawTextLength > maxRawTextLength) {
    throw new ContextAnalysisApiError(413, "RAW_TEXT_TOO_LONG", "입력 기록은 20,000자 이하로 줄여주세요.", {
      maxLength: maxRawTextLength,
      currentLength: rawTextLength,
    });
  }

  return { projectTitle, rawText };
}

export async function analyzeProjectContext(payload, options = {}) {
  const { projectTitle, rawText } = validateContextAnalysisRequest(payload, {
    maxRawTextLength: options.maxRawTextLength,
  });
  const providerName = resolveProviderName(options.provider);

  if (providerName === "openai") {
    const { analysis, provider, usage, requestId } = await analyzeWithOpenAI(
      { projectTitle, rawText },
      {
        apiKey: options.apiKey,
        model: options.model,
        client: options.openAIClient,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        safetyIdentifier: options.safetyIdentifier,
        reasoningEffort: options.reasoningEffort,
      },
    );

    const result = assembleAnalysisResult(projectTitle, rawText, analysis, provider);
    Object.defineProperty(result, providerTelemetrySymbol, {
      value: { usage, requestId },
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return result;
  }

  const analysis = analyzeProjectContextLocally(projectTitle, rawText);
  return assembleAnalysisResult(projectTitle, rawText, analysis, {
    mode: "mock",
    name: "local-heuristic",
    usedExternalModel: false,
  });
}

export function analyzeProjectContextLocally(projectTitle, rawText) {
  const sentences = splitSentences(rawText);
  const overview = buildOverview(sentences, rawText);
  const participants = buildParticipants(sentences);
  const decisions = buildDecisions(sentences);
  const questions = buildQuestions(sentences);
  const keyTerms = buildKeyTerms(rawText);
  const participantAgents = buildParticipantAgents(participants, questions, sentences, decisions);

  return {
    overview,
    keyTerms,
    decisions,
    participants,
    questions,
    participantAgents,
  };
}

function assembleAnalysisResult(projectTitle, rawText, analysis, provider) {
  const participants = analysis.participants.map((participant) => ({
    actor: participant.actor,
    role: participant.role,
    focus: participant.focus,
    concern: participant.concern,
    question: participant.question,
    evidence: participant.evidence,
  }));
  const knowledgeMap = buildKnowledgeMap(
    projectTitle,
    participants,
    analysis.decisions,
    analysis.questions,
  );
  const onboardingSummary = buildOnboardingSummary(
    projectTitle,
    analysis.overview,
    analysis.decisions,
    analysis.questions,
  );

  return {
    projectTitle,
    summary: {
      projectTitle,
      overview: analysis.overview,
      sourceLength: unicodeLength(rawText),
      generatedAt: new Date().toISOString(),
    },
    keyTerms: analysis.keyTerms,
    decisions: analysis.decisions,
    participants,
    questions: analysis.questions,
    knowledgeMap,
    onboardingSummary,
    participantAgents: analysis.participantAgents,
    provider,
  };
}

function resolveProviderName(requestedProvider) {
  const normalized = String(
    requestedProvider || process.env.MODU_BRAIN_ANALYSIS_PROVIDER || "local-heuristic",
  )
    .trim()
    .toLowerCase();

  if (["mock", "local", "local-heuristic"].includes(normalized)) {
    return "local-heuristic";
  }

  if (normalized === "openai") {
    return "openai";
  }

  throw new ContextAnalysisApiError(
    503,
    "PROVIDER_NOT_SUPPORTED",
    `지원하지 않는 분석 provider입니다: ${normalized}`,
    { supported: ["local-heuristic", "openai"] },
  );
}

function splitSentences(rawText) {
  return rawText
    .replace(/\r/g, "")
    .split(/(?<=[.!?。]|다\.|했다\.|한다\.|됐다\.|였다\.)\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildOverview(sentences, rawText) {
  const candidates = sentences.filter((sentence) =>
    /문제|목표|결정|MVP|에이전트|관점|질문|피드백|공유|맥락/.test(sentence),
  );
  const selected = uniqueByText(candidates.length > 0 ? candidates : sentences).slice(0, 3);

  if (selected.length > 0) {
    return selected.map((sentence) => summarizeSentence(sentence));
  }

  return [
    `${rawText.slice(0, 80)}${rawText.length > 80 ? "..." : ""}`,
    "입력 기록에서 결정 배경, 참여자 관점, 미결 질문을 구조화해야 합니다.",
    "다음 회의에서 확인할 질문과 새 팀원 온보딩 요약을 함께 생성합니다.",
  ];
}

function buildParticipants(sentences) {
  const participantMap = new Map();

  for (const sentence of sentences) {
    const actor = extractActor(sentence);
    if (!actor) continue;

    const existing = participantMap.get(actor);
    const focus = extractFocus(sentence);
    const concern = extractConcern(sentence);
    const question = extractQuestionFromSentence(sentence);

    participantMap.set(actor, {
      actor,
      role: existing?.role || inferRole(sentence),
      focus: existing?.focus || focus,
      concern: existing?.concern || concern,
      question: existing?.question || question,
      evidence: uniqueByText([...(existing?.evidence || []), exactEvidence(sentence)]).slice(0, 3),
    });
  }

  const participants = [...participantMap.values()].slice(0, 6);

  if (participants.length > 0) {
    return participants;
  }

  return [];
}

function buildDecisions(sentences) {
  const decisions = sentences
    .filter((sentence) =>
      /하기로|기로\s*(?:결정)?했|결정했다|결정하였다|정했다|확정했다|선택했다|보류했다|제외하기로|우선하기로/.test(
        sentence,
      ),
    )
    .map((sentence) => ({
      decision: summarizeSentence(sentence),
      reason: inferDecisionReason(sentence),
      status: /아직|검토|보류|논의|미정|필요/.test(sentence) ? "tentative" : "confirmed",
      evidence: [exactEvidence(sentence)],
    }))
    .slice(0, 5);

  if (decisions.length > 0) {
    return decisions;
  }

  return [];
}

function buildQuestions(sentences) {
  const explicitQuestions = sentences
    .flatMap((sentence) => sentence.split(/(?<=\?)/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.includes("?"));

  const unresolvedSentences = sentences.filter((sentence) =>
    /아직|불확실|논의|검토|정해야|확인해야|미정/.test(sentence) ||
    /(어떻게|무엇|어떤|왜).*(할지|할까|정할지|선택할지)/.test(sentence),
  );
  const selected = uniqueByText([...explicitQuestions, ...unresolvedSentences]).slice(0, 5);

  if (selected.length > 0) {
    return selected.map((sentence) => ({
      question: normalizeQuestion(sentence),
      reason: "입력 기록에서 아직 합의나 결정이 필요한 내용으로 감지되었습니다.",
      ownerHint: inferOwnerHint(sentence),
      evidence: [exactEvidence(sentence)],
    }));
  }

  return [];
}

function buildKeyTerms(rawText) {
  const candidates = [
    ["협업 맥락", "팀이 같은 배경지식 위에서 움직이기 위해 공유해야 하는 결정 배경과 관점 차이입니다."],
    ["관점 차이", "참여자별 역할, 우려, 우선순위가 다르게 드러나는 지점입니다."],
    ["미결 질문", "다음 회의에서 답해야 하는 불확실한 항목입니다."],
    ["공유 지식맵", "사람, 주제, 결정사항, 질문을 노드와 연결 관계로 보여주는 구조입니다."],
    ["온보딩 요약", "새 팀원이 긴 기록을 읽기 전에 먼저 알아야 할 프로젝트 현재 상태입니다."],
  ];

  const termSignals = {
    "협업 맥락": /협업|맥락/,
    "관점 차이": /관점|의견/,
    "미결 질문": /미결|질문|아직/,
    "공유 지식맵": /지식맵|노드|연결/,
    "온보딩 요약": /온보딩|새 팀원/,
  };

  return candidates
    .filter(([term]) => termSignals[term].test(rawText))
    .slice(0, 5)
    .map(([term, meaning]) => ({ term, meaning }));
}

function buildKnowledgeMap(projectTitle, participants, decisions, questions) {
  const nodes = [
    {
      id: "topic-main",
      label: projectTitle,
      type: "topic",
      summary: "입력 기록에서 분석한 프로젝트의 중심 주제입니다.",
    },
    ...participants.slice(0, 3).map((participant, index) => ({
      id: `person-${index + 1}`,
      label: participant.actor,
      type: "person",
      summary: participant.focus,
    })),
    ...decisions.slice(0, 2).map((decision, index) => ({
      id: `decision-${index + 1}`,
      label: `결정 ${index + 1}`,
      type: "decision",
      summary: decision.decision,
    })),
    ...questions.slice(0, 2).map((question, index) => ({
      id: `question-${index + 1}`,
      label: `질문 ${index + 1}`,
      type: "question",
      summary: question.question,
    })),
  ];

  const links = [
    ...participants.slice(0, 3).map((_, index) => ({
      from: `person-${index + 1}`,
      to: "topic-main",
      relation: "관점 제공",
    })),
    ...decisions.slice(0, 2).map((_, index) => ({
      from: "topic-main",
      to: `decision-${index + 1}`,
      relation: "결정사항",
    })),
    ...questions.slice(0, 2).map((_, index) => ({
      from: `decision-${Math.min(index + 1, Math.max(decisions.length, 1))}`,
      to: `question-${index + 1}`,
      relation: "추가 확인 필요",
    })),
  ].filter((link) => nodes.some((node) => node.id === link.from) && nodes.some((node) => node.id === link.to));

  return { nodes, links };
}

function buildOnboardingSummary(projectTitle, overview, decisions, questions) {
  const currentDecisions = decisions
    .filter((decision) => decision.status === "confirmed")
    .slice(0, 3)
    .map((decision) => decision.decision);
  const remainingQuestions = questions.slice(0, 3).map((question) => question.question);
  const items = [
    `${projectTitle}${getTopicParticle(projectTitle)} 팀 기록에서 결정 배경과 관점 차이를 구조화하는 흐름으로 정리되었습니다.`,
    overview[0] || "현재 기록에서 핵심 맥락을 추출했습니다.",
    currentDecisions[0] ? `현재 확정된 내용은 ${currentDecisions[0]}` : "아직 확정된 결정은 제한적으로 확인됩니다.",
    remainingQuestions[0]
      ? `다음 회의에서는 "${remainingQuestions[0]}" 항목을 먼저 확인해야 합니다.`
      : "다음 회의에서 미결 질문을 더 명확히 정해야 합니다.",
  ];

  return {
    items,
    currentDecisions,
    remainingQuestions,
    shareText: `${projectTitle}의 현재 맥락은 결정 배경, 참여자 관점, 미결 질문을 중심으로 정리되었습니다.`,
  };
}

function buildParticipantAgents(participants, questions, sentences, decisions) {
  const views = participants.slice(0, 6).map((participant) => ({
    actor: participant.actor,
    role: participant.role,
    priority: participant.focus,
    interpretation: `${participant.actor} 관점에서는 "${stripSentenceEnding(participant.focus)}"를 프로젝트 판단의 우선순위로 봅니다.`,
    evidence: participant.evidence?.length ? participant.evidence : [participant.focus].filter(Boolean),
    risk: participant.concern,
  }));

  const agreementPoints = uniqueByText(
    [
      ...sentences
        .filter((sentence) => /합의|동의|공통|모두|함께|찬성/.test(sentence))
        .map((sentence) => summarizeSentence(sentence)),
      ...decisions
        .filter((decision) => decision.status === "confirmed")
        .map((decision) => decision.decision),
    ],
  ).slice(0, 3);
  const tensionPoints = uniqueByText([
    ...sentences
      .filter((sentence) => /반대|이견|충돌|우려|그러나|하지만|보류/.test(sentence))
      .map((sentence) => summarizeSentence(sentence)),
    ...questions.map((question) => question.question),
  ]).slice(0, 4);

  return {
    views,
    agreementPoints,
    tensionPoints,
    privacyNote: "팀원의 성격을 추정하지 않고 입력 기록에 근거가 있는 프로젝트 관점만 표현합니다.",
  };
}

function extractActor(sentence) {
  const cleaned = sentence.replace(/^[-*•\d.)\s]+/, "").trim();
  const match = cleaned.match(/^([가-힣A-Za-z][가-힣A-Za-z0-9]{1,11})(?:님)?(?:은|는|이|가|께서)\s/);
  const actor = match?.[1]?.trim() || "";
  const documentNoun = actor.endsWith("에") ? actor.slice(0, -1) : actor;
  return actor && !COMMON_NON_ACTORS.has(actor) && !COMMON_NON_ACTORS.has(documentNoun)
    ? actor
    : "";
}

function extractFocus(sentence) {
  return summarizeSentence(sentence.replace(/^[가-힣A-Za-z0-9]{2,12}(?:은|는|이|가|께서|님은|님이)\s*/, ""));
}

function extractConcern(sentence) {
  if (/우려|걱정|문제|리스크|부족|어렵/.test(sentence)) {
    return summarizeSentence(sentence);
  }
  return "현재 관점에서 추가로 확인할 리스크를 정리해야 한다.";
}

function extractQuestionFromSentence(sentence) {
  if (sentence.includes("?")) return normalizeQuestion(sentence);
  if (/(어떻게|무엇|어떤|왜).*(확인|정해야|논의|질문|물었)/.test(sentence)) {
    return normalizeQuestion(sentence);
  }
  return "이 관점이 다음 결정에 어떤 영향을 주는가?";
}

function inferRole(sentence) {
  if (/사용자|UX|흐름|입력/.test(sentence)) return "사용자 흐름 관점";
  if (/디자인|화면|Figma|시각/.test(sentence)) return "시각화 관점";
  if (/API|서버|개발|구현|기술/.test(sentence)) return "구현 관점";
  if (/발표|기획|차별/.test(sentence)) return "기획 관점";
  return "프로젝트 참여자";
}

function inferDecisionReason(sentence) {
  if (/때문/.test(sentence)) return summarizeSentence(sentence.split(/때문/)[0]) + " 때문입니다.";
  if (/위해/.test(sentence)) return summarizeSentence(sentence.split(/위해/)[0]) + " 위해서입니다.";
  return "입력 기록에서 팀의 다음 행동과 연결되는 결정으로 감지되었습니다.";
}

function inferOwnerHint(sentence) {
  if (/디자인|시각|Figma/.test(sentence)) return "시각화 담당";
  if (/API|개발|서버|구현/.test(sentence)) return "개발 담당";
  if (/사용자|입력|흐름/.test(sentence)) return "사용자 흐름 담당";
  return "팀 전체";
}

function normalizeQuestion(sentence) {
  const cleaned = summarizeSentence(sentence).replace(/[.。]+$/, "");
  return cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
}

function summarizeSentence(sentence) {
  const compact = sentence.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function exactEvidence(sentence) {
  return sentence.trim().slice(0, 600);
}

function stripSentenceEnding(sentence) {
  return sentence.replace(/[.!?。]+$/, "").trim();
}

function getTopicParticle(text) {
  const lastCharacter = [...text.trim()].at(-1);
  if (!lastCharacter) return "는";

  const codePoint = lastCharacter.codePointAt(0);
  const isHangulSyllable = codePoint >= 0xac00 && codePoint <= 0xd7a3;
  if (!isHangulSyllable) return "는";

  return (codePoint - 0xac00) % 28 === 0 ? "는" : "은";
}

function uniqueByText(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unicodeLength(value) {
  return Array.from(value).length;
}
