import type {
  AnalysisMode,
  AnalysisRunAnnotationResource,
  AnalysisRunResource,
  AnalysisRunStepEventResource,
  AccountExportResource,
  CapabilitiesResource,
  CreateProjectInput,
  CreateSourceInput,
  ContextImportResource,
  CursorPage,
  CursorPageMetadata,
  CursorPageOptions,
  CreateAnalysisRunAnnotationInput,
  ImportContextInput,
  ProjectResource,
  ShareLinkResource,
  SharedAnalysisResource,
  SourceRecordListResource,
  SourceRecordResource,
  SourceSegmentResource,
  UpdateProjectInput,
  UpdateSourceInput,
} from "../types/platform";
import { COOKIE_SESSION_SENTINEL } from "./auth";

export const AUTH_REQUIRED_EVENT = "modu-brain:auth-required";

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class PlatformApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code: string,
    details: unknown = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface PlatformApi {
  getCapabilities(token: string): Promise<CapabilitiesResource>;
  listProjects(token: string, options?: { archived?: boolean }): Promise<ProjectResource[]>;
  createProject(token: string, input: CreateProjectInput): Promise<ProjectResource>;
  getProject(token: string, projectId: string): Promise<ProjectResource>;
  updateProject(
    token: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectResource>;
  deleteProject(token: string, projectId: string, permanent?: boolean): Promise<void>;
  restoreProject?(token: string, projectId: string): Promise<ProjectResource>;
  listSources(token: string, projectId: string): Promise<SourceRecordListResource[]>;
  listSourcesPage?(
    token: string,
    projectId: string,
    options?: CursorPageOptions,
  ): Promise<CursorPage<SourceRecordListResource>>;
  getSource?(token: string, sourceId: string): Promise<SourceRecordResource>;
  createSource(
    token: string,
    projectId: string,
    input: CreateSourceInput,
  ): Promise<SourceRecordResource>;
  importContext(
    token: string,
    projectId: string,
    input: ImportContextInput,
  ): Promise<ContextImportResource>;
  updateSource(
    token: string,
    sourceId: string,
    input: UpdateSourceInput,
  ): Promise<SourceRecordResource>;
  deleteSource(token: string, sourceId: string): Promise<void>;
  restoreSource?(token: string, sourceId: string): Promise<SourceRecordResource>;
  listSourceSegments(token: string, sourceId: string): Promise<SourceSegmentResource[]>;
  listSourceSegmentsPage?(
    token: string,
    sourceId: string,
    options?: CursorPageOptions,
  ): Promise<CursorPage<SourceSegmentResource>>;
  getSourceSegment?(token: string, segmentId: string): Promise<SourceSegmentResource>;
  listAnalysisRuns(token: string, projectId: string): Promise<AnalysisRunResource[]>;
  listAnalysisRunsPage?(
    token: string,
    projectId: string,
    options?: CursorPageOptions,
  ): Promise<CursorPage<AnalysisRunResource>>;
  createAnalysisRun(
    token: string,
    projectId: string,
    input: { sourceIds: string[]; mode: AnalysisMode },
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AnalysisRunResource>;
  getAnalysisRun(token: string, runId: string): Promise<AnalysisRunResource>;
  deleteAnalysisRun(token: string, runId: string): Promise<void>;
  listAnalysisRunStepEvents(
    token: string,
    runId: string,
  ): Promise<AnalysisRunStepEventResource[]>;
  listAnalysisRunAnnotations(
    token: string,
    runId: string,
  ): Promise<AnalysisRunAnnotationResource[]>;
  createAnalysisRunAnnotation(
    token: string,
    runId: string,
    input: CreateAnalysisRunAnnotationInput,
    idempotencyKey: string,
  ): Promise<AnalysisRunAnnotationResource>;
  listShareLinks(token: string, runId: string): Promise<ShareLinkResource[]>;
  createShareLink(
    token: string,
    runId: string,
    expiresInDays: number,
  ): Promise<ShareLinkResource>;
  revokeShareLink(token: string, shareLinkId: string): Promise<void>;
  resolveSharedAnalysis(token: string): Promise<SharedAnalysisResource>;
  exportAccount?(token: string): Promise<AccountExportResource>;
  deleteAccount?(token: string, confirmation: "delete my account"): Promise<void>;
}

class HttpPlatformApi implements PlatformApi {
  getCapabilities(token: string) {
    return this.request<CapabilitiesResource>("/api/v1/capabilities", { token });
  }

  listProjects(token: string, options: { archived?: boolean } = {}) {
    return this.request<ProjectResource[]>(
      `/api/v1/projects${options.archived ? "?archived=true" : ""}`,
      { token },
    );
  }

  createProject(token: string, input: CreateProjectInput) {
    return this.request<ProjectResource>("/api/v1/projects", {
      token,
      method: "POST",
      body: input,
    });
  }

  getProject(token: string, projectId: string) {
    return this.request<ProjectResource>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      token,
    });
  }

  updateProject(token: string, projectId: string, input: UpdateProjectInput) {
    return this.request<ProjectResource>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      token,
      method: "PATCH",
      body: input,
    });
  }

  async deleteProject(token: string, projectId: string, permanent = false) {
    await this.request<unknown>(
      `/api/v1/projects/${encodeURIComponent(projectId)}${permanent ? "?permanent=true" : ""}`,
      {
        token,
        method: "DELETE",
        headers: permanent ? { "X-Confirm-Permanent-Delete": "delete" } : undefined,
      },
    );
  }

  restoreProject(token: string, projectId: string) {
    return this.request<ProjectResource>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/restore`,
      { token, method: "POST" },
    );
  }

  listSources(token: string, projectId: string) {
    return collectCursorPages((cursor) =>
      this.listSourcesPage(token, projectId, { cursor }),
    );
  }

  listSourcesPage(token: string, projectId: string, options: CursorPageOptions = {}) {
    return this.requestPage<SourceRecordListResource>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources${pageQuery(options)}`,
      { token },
    );
  }

  getSource(token: string, sourceId: string) {
    return this.request<SourceRecordResource>(
      `/api/v1/sources/${encodeURIComponent(sourceId)}`,
      { token },
    );
  }

  createSource(token: string, projectId: string, input: CreateSourceInput) {
    return this.request<SourceRecordResource>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources`,
      { token, method: "POST", body: input },
    );
  }

  importContext(token: string, projectId: string, input: ImportContextInput) {
    return this.request<ContextImportResource>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/imports`,
      { token, method: "POST", body: input },
    );
  }

  updateSource(token: string, sourceId: string, input: UpdateSourceInput) {
    return this.request<SourceRecordResource>(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
      token,
      method: "PATCH",
      body: input,
    });
  }

  async deleteSource(token: string, sourceId: string) {
    await this.request<unknown>(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
      token,
      method: "DELETE",
    });
  }

  restoreSource(token: string, sourceId: string) {
    return this.request<SourceRecordResource>(
      `/api/v1/sources/${encodeURIComponent(sourceId)}/restore`,
      { token, method: "POST" },
    );
  }

  listSourceSegments(token: string, sourceId: string) {
    return collectCursorPages((cursor) =>
      this.listSourceSegmentsPage(token, sourceId, { cursor }),
    );
  }

  listSourceSegmentsPage(token: string, sourceId: string, options: CursorPageOptions = {}) {
    return this.requestPage<SourceSegmentResource>(
      `/api/v1/sources/${encodeURIComponent(sourceId)}/segments${pageQuery(options)}`,
      { token },
    );
  }

  getSourceSegment(token: string, segmentId: string) {
    return this.request<SourceSegmentResource>(
      `/api/v1/source-segments/${encodeURIComponent(segmentId)}`,
      { token },
    );
  }

  listAnalysisRuns(token: string, projectId: string) {
    return collectCursorPages((cursor) =>
      this.listAnalysisRunsPage(token, projectId, { cursor }),
    );
  }

  listAnalysisRunsPage(token: string, projectId: string, options: CursorPageOptions = {}) {
    return this.requestPage<AnalysisRunResource>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-runs${pageQuery(options)}`,
      { token },
    );
  }

  createAnalysisRun(
    token: string,
    projectId: string,
    input: { sourceIds: string[]; mode: AnalysisMode },
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    return this.request<AnalysisRunResource>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-runs`,
      {
        token,
        method: "POST",
        body: input,
        signal,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  }

  getAnalysisRun(token: string, runId: string) {
    return this.request<AnalysisRunResource>(`/api/v1/analysis-runs/${encodeURIComponent(runId)}`, {
      token,
    });
  }

  async deleteAnalysisRun(token: string, runId: string) {
    await this.request<unknown>(`/api/v1/analysis-runs/${encodeURIComponent(runId)}`, {
      token,
      method: "DELETE",
    });
  }

  listAnalysisRunStepEvents(token: string, runId: string) {
    return this.request<AnalysisRunStepEventResource[]>(
      `/api/v1/analysis-runs/${encodeURIComponent(runId)}/step-events`,
      { token },
    );
  }

  listAnalysisRunAnnotations(token: string, runId: string) {
    return this.request<AnalysisRunAnnotationResource[]>(
      `/api/v1/analysis-runs/${encodeURIComponent(runId)}/annotations`,
      { token },
    );
  }

  createAnalysisRunAnnotation(
    token: string,
    runId: string,
    input: CreateAnalysisRunAnnotationInput,
    idempotencyKey: string,
  ) {
    return this.request<AnalysisRunAnnotationResource>(
      `/api/v1/analysis-runs/${encodeURIComponent(runId)}/annotations`,
      {
        token,
        method: "POST",
        body: input,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  }

  listShareLinks(token: string, runId: string) {
    return this.request<ShareLinkResource[]>(
      `/api/v1/analysis-runs/${encodeURIComponent(runId)}/share-links`,
      { token },
    );
  }

  createShareLink(token: string, runId: string, expiresInDays: number) {
    return this.request<ShareLinkResource>(
      `/api/v1/analysis-runs/${encodeURIComponent(runId)}/share-links`,
      { token, method: "POST", body: { expiresInDays } },
    );
  }

  async revokeShareLink(token: string, shareLinkId: string) {
    await this.request<unknown>(`/api/v1/share-links/${encodeURIComponent(shareLinkId)}`, {
      token,
      method: "DELETE",
    });
  }

  resolveSharedAnalysis(token: string) {
    return this.request<SharedAnalysisResource>("/api/v1/shared/resolve", {
      method: "POST",
      body: { token },
    });
  }

  exportAccount(token: string) {
    return this.request<AccountExportResource>("/api/v1/account/export", { token });
  }

  async deleteAccount(token: string, confirmation: "delete my account") {
    await this.request<unknown>("/api/v1/account", {
      token,
      method: "DELETE",
      headers: { "X-Confirm-Account-Delete": confirmation },
    });
  }

  private async request<T>(
    path: string,
    options: {
      token?: string;
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    return (await this.requestEnvelope<T>(path, options)).data;
  }

  private async requestPage<T>(
    path: string,
    options: {
      token?: string;
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<CursorPage<T>> {
    const envelope = await this.requestEnvelope<T[]>(path, options);
    return {
      items: envelope.data,
      page: envelope.page ?? {
        limit: envelope.data.length,
        count: envelope.data.length,
        hasMore: false,
        nextCursor: null,
      },
    };
  }

  private async requestEnvelope<T>(
    path: string,
    options: {
      token?: string;
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<{ data: T; page?: CursorPageMetadata }> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: options.method ?? "GET",
        credentials: "same-origin",
        signal: options.signal,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.token && options.token !== COOKIE_SESSION_SENTINEL
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new PlatformApiError(
        "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.",
        0,
        "NETWORK_ERROR",
      );
    }

    if (response.status === 204) return { data: undefined as T };
    const payload = (await response.json().catch(() => null)) as
      | { data?: T; page?: CursorPageMetadata }
      | ErrorPayload
      | null;
    if (!response.ok) {
      if (
        response.status === 401 &&
        options.token === COOKIE_SESSION_SENTINEL &&
        typeof window !== "undefined"
      ) {
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      }
      const error = (payload as ErrorPayload | null)?.error;
      const retryAfterHeader = Number(response.headers?.get?.("Retry-After") ?? NaN);
      const retryAfterDetail = Number(
        error?.details && typeof error.details === "object" && "retryAfter" in error.details
          ? error.details.retryAfter
          : NaN,
      );
      throw new PlatformApiError(
        error?.message ?? "요청을 처리하지 못했습니다.",
        response.status,
        error?.code ?? "REQUEST_FAILED",
        error?.details,
        Number.isFinite(retryAfterHeader)
          ? retryAfterHeader
          : Number.isFinite(retryAfterDetail)
            ? retryAfterDetail
            : null,
      );
    }
    if (!payload || !("data" in payload)) {
      throw new PlatformApiError(
        "서버 응답 형식이 올바르지 않습니다.",
        response.status,
        "INVALID_RESPONSE",
      );
    }
    return {
      data: payload.data as T,
      ...("page" in payload && payload.page ? { page: payload.page } : {}),
    };
  }
}

function pageQuery(options: CursorPageOptions) {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 50));
  if (options.cursor) params.set("cursor", options.cursor);
  return `?${params.toString()}`;
}

async function collectCursorPages<T>(
  load: (cursor: string | null) => Promise<CursorPage<T>>,
) {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let pageCount = 0; pageCount < 100; pageCount += 1) {
    const page = await load(cursor);
    items.push(...page.items);
    if (!page.page.nextCursor) return items;
    if (page.page.nextCursor === cursor) {
      throw new PlatformApiError(
        "서버가 같은 페이지 커서를 반복했습니다.",
        502,
        "INVALID_PAGINATION",
      );
    }
    cursor = page.page.nextCursor;
  }
  throw new PlatformApiError(
    "한 번에 불러올 수 있는 목록 범위를 초과했습니다.",
    413,
    "PAGINATION_LIMIT_EXCEEDED",
  );
}

export const platformApi: PlatformApi = new HttpPlatformApi();
