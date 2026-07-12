export type NodeType = "topic" | "person" | "role" | "decision" | "question";

export type EvidenceRef = {
  sourceRecordId: string;
  sourceTitle: string;
  quote: string;
};

export type ConfidenceLevel = "low" | "medium" | "high";

/**
 * A deterministic grounding assessment produced from exact snapshot matches.
 * This describes confidence in the extraction, not whether a decision is good.
 */
export type AgentConfidence = {
  score: number;
  level: ConfidenceLevel;
  rationale: string;
  evidenceCount: number;
  sourceCount: number;
};

export type DecisionLifecycleStatus = "new" | "changed" | "stable" | "resolved";

export type TemporalKnowledgeMeta = {
  lifecycle?: DecisionLifecycleStatus;
  observedAt?: string;
  previousObservedAt?: string;
  contradictionIds?: string[];
};

export type AgentAssessed = {
  agentConfidence?: AgentConfidence;
};

export type KnowledgeNode = AgentAssessed & TemporalKnowledgeMeta & {
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

export type PerspectiveItem = AgentAssessed & {
  id?: string;
  actor: string;
  role: string;
  focus: string;
  concern: string;
  question: string;
  evidence?: EvidenceRef[];
};

export type ParticipantAgentView = AgentAssessed & {
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

export type QuestionItem = AgentAssessed & {
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

export type KeyTermItem = AgentAssessed & {
  id?: string;
  term: string;
  meaning: string;
  evidence?: EvidenceRef[];
};

export type DecisionItem = AgentAssessed & TemporalKnowledgeMeta & {
  id?: string;
  decision: string;
  reason: string;
  status: "confirmed" | "tentative" | "unclear";
  evidence?: EvidenceRef[];
};

export type ContextAnalysisResult = {
  projectTitle: string;
  summary: ContextSummary;
  keyTerms: KeyTermItem[];
  decisions: DecisionItem[];
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
