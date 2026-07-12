export type NodeType = "topic" | "person" | "role" | "decision" | "question";

export type EvidenceRef = {
  sourceRecordId: string;
  sourceTitle: string;
  quote: string;
};

export type KnowledgeNode = {
  id: string;
  label: string;
  type: NodeType;
  summary: string;
  evidence?: EvidenceRef[];
};

export type KnowledgeLink = {
  from: string;
  to: string;
  relation: string;
};

export type PerspectiveItem = {
  id?: string;
  actor: string;
  role: string;
  focus: string;
  concern: string;
  question: string;
  evidence?: EvidenceRef[];
};

export type ParticipantAgentView = {
  id?: string;
  actor: string;
  role: string;
  priority: string;
  interpretation: string;
  evidence: string[];
  evidenceRefs?: EvidenceRef[];
  risk: string;
};

export type ParticipantAgentSynthesis = {
  views: ParticipantAgentView[];
  agreementPoints: string[];
  tensionPoints: string[];
  privacyNote: string;
};

export type ContextSummary = {
  projectTitle: string;
  overview: string[];
  sourceLength: number;
  generatedAt: string;
};

export type QuestionItem = {
  id?: string;
  question: string;
  reason: string;
  ownerHint: string;
  evidence?: EvidenceRef[];
};

export type OnboardingSummary = {
  items: string[];
  currentDecisions: string[];
  remainingQuestions: string[];
  shareText: string;
};

export type ProviderInfo = {
  mode: "mock" | "llm";
  name: string;
  usedExternalModel: boolean;
};

export type ContextAnalysisResult = {
  projectTitle: string;
  summary: ContextSummary;
  keyTerms: {
    id?: string;
    term: string;
    meaning: string;
    evidence?: EvidenceRef[];
  }[];
  decisions: {
    id?: string;
    decision: string;
    reason: string;
    status: "confirmed" | "tentative" | "unclear";
    evidence?: EvidenceRef[];
  }[];
  participants: PerspectiveItem[];
  questions: QuestionItem[];
  knowledgeMap: {
    nodes: KnowledgeNode[];
    links: KnowledgeLink[];
  };
  onboardingSummary: OnboardingSummary;
  participantAgents: ParticipantAgentSynthesis;
  provider: ProviderInfo;
};

export type ContextAnalysisResultV2 = ContextAnalysisResult & {
  schemaVersion?: "2.0";
};
