import type { ContextAnalysisResultV2 } from "./context";

export type SourceKind = "meeting" | "research" | "feedback" | "note";
export type ExternalContextProvider = "kakaotalk" | "teams" | "notion" | "paste";
export type AnalysisMode = "local" | "openai";
export type AnalysisRunStatus = "running" | "succeeded" | "failed" | "cancelled";
export type AnalysisRunStep =
  | "source_snapshot"
  | "provider_analysis"
  | "evidence_validation"
  | "result_persistence";
export type AnalysisRunStepStatus = "started" | "succeeded" | "failed" | "cancelled";
export type AnalysisAnnotationType = "confirmation" | "correction" | "question" | "note";
export type AnalysisAnnotationTargetType =
  | "run"
  | "decision"
  | "participant"
  | "question"
  | "term"
  | "knowledge_node"
  | "participant_view";

export type CapabilitiesResource = {
  openaiEnabled: boolean;
  accountExportEnabled?: boolean;
  accountDeletionEnabled?: boolean;
};

export type CursorPageOptions = {
  cursor?: string | null;
  limit?: number;
};

export type CursorPageMetadata = {
  limit: number;
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type CursorPage<T> = {
  items: T[];
  page: CursorPageMetadata;
};

export type ProjectResource = {
  id: string;
  ownerId?: string;
  title: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceCount?: number;
  analysisCount?: number;
};

type SourceRecordBaseResource = {
  id: string;
  projectId: string;
  kind: SourceKind;
  title: string;
  contentSha256?: string;
  charCount: number;
  occurredAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SourceRecordListResource = SourceRecordBaseResource & {
  import?: {
    id: string;
    provider: ExternalContextProvider;
    segmentCount: number;
    importedAt: string;
  };
};

export type SourceRecordResource = SourceRecordBaseResource & {
  content: string;
  import?: {
    id: string;
    provider: ExternalContextProvider;
    participants: string[];
    segmentCount: number;
    importedAt: string;
    metadata?: Record<string, unknown>;
  };
};

export type ImportContextInput = {
  provider: ExternalContextProvider;
  title?: string;
  text: string;
};

export type ContextImportResource = {
  source: SourceRecordResource;
  importId: string;
  provider: ExternalContextProvider;
  participants: string[];
  segmentCount: number;
  duplicate: boolean;
};

export type SourceSegmentResource = {
  id: string;
  sourceRecordId: string;
  ordinal: number;
  speaker: string | null;
  text: string;
  occurredAt: string | null;
  externalId: string | null;
  sourceUrl: string | null;
};

export type AnalysisRunResource = {
  id: string;
  projectId: string;
  status: AnalysisRunStatus;
  schemaVersion: "2.0";
  sourceIds: string[];
  provider: {
    mode: AnalysisMode;
    name?: string;
    model?: string;
  };
  result?: ContextAnalysisResultV2;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  completedAt?: string | null;
};

export type AnalysisRunStepEventResource = {
  id: string;
  analysisRunId: string;
  sequence: number;
  eventKey: string;
  step: AnalysisRunStep;
  status: AnalysisRunStepStatus;
  validationOutcome: "passed" | "failed" | null;
  code: string | null;
  durationMs: number | null;
  sourceCount: number | null;
  inputCharacters: number | null;
  outputItemCount: number | null;
  evidenceReferenceCount: number | null;
  createdAt: string;
};

export type AnalysisRunAnnotationResource = {
  id: string;
  analysisRunId: string;
  annotationType: AnalysisAnnotationType;
  target: {
    type: AnalysisAnnotationTargetType;
    id?: string;
  };
  body: string;
  createdAt: string;
};

export type CreateAnalysisRunAnnotationInput = {
  annotationType: AnalysisAnnotationType;
  targetType: AnalysisAnnotationTargetType;
  targetId?: string;
  body: string;
};

export type ShareLinkResource = {
  id: string;
  analysisRunId: string;
  token?: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type PublicContextAnalysisResult = Omit<ContextAnalysisResultV2, "provider">;

export type SharedAnalysisResource = {
  projectTitle: string;
  result: PublicContextAnalysisResult;
  completedAt: string;
  expiresAt: string;
};

export type AccountExportResource = {
  schemaVersion: "1.0";
  generatedAt: string;
  data: unknown;
};

export type CreateProjectInput = {
  title: string;
  description?: string;
};

export type UpdateProjectInput = Partial<Pick<ProjectResource, "title" | "description">> & {
  permanentlyDelete?: boolean;
};

export type CreateSourceInput = {
  kind: SourceKind;
  title: string;
  content: string;
  occurredAt?: string | null;
};

export type UpdateSourceInput = Partial<CreateSourceInput>;
