import {
  analyzeProjectContext,
  providerTelemetrySymbol,
} from "./contextAnalysisCore.mjs";
import { ApiError, toApiError } from "./apiErrors.mjs";
import {
  AUTH_REFRESH_LEAD_MS,
  authSessionCacheHeaders,
  clearAuthSessionCookies,
  deriveAccessExpiresAt,
  readAuthSessionCookies,
  setAuthSessionCacheHeaders,
  writeAuthSessionCookies,
} from "./authSession.mjs";
import { buildContextAnalysisResultV2 } from "./analysisResultV2.mjs";
import { normalizeContextImport } from "./contextImport.mjs";
import { allowOnly, readJson, setApiHeaders, writeApiError, writeData } from "./httpJson.mjs";
import {
  createModuBrainRepository,
  createModuBrainServiceRepository,
  createPublicShareRepository,
} from "./moduBrainRepository.mjs";
import {
  analysisRunAnnotationResource,
  analysisRunResource,
  analysisRunStepEventResource,
  contextImportResource,
  projectResource,
  shareLinkResource,
  sharedAnalysisResource,
  sourceSegmentResource,
  sourceResource,
} from "./resourceMappers.mjs";
import {
  createShareToken,
  privacyIdentifier,
  rateLimitIdentifier,
  requireUuid,
  sha256,
} from "./security.mjs";
import { createSupabaseGateway } from "./supabaseGateway.mjs";

const SOURCE_KINDS = new Set(["meeting", "research", "feedback", "note"]);
const ANNOTATION_TYPES = new Set(["confirmation", "correction", "question", "note"]);
const ANNOTATION_TARGET_TYPES = new Set([
  "run",
  "decision",
  "participant",
  "question",
  "term",
  "knowledge_node",
  "participant_view",
]);
const INPUT_CHARACTER_LIMIT = 100_000;
const OPENAI_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const TELEMETRY_BODY_LIMIT = 16 * 1024;
const AUTH_SESSION_BODY_LIMIT = 16 * 1024;
// Leave headroom for the cookie name and security attributes below the common
// 4 KiB per-cookie implementation limit. The limit applies after encoding,
// because an otherwise short value may expand when serialized.
const AUTH_COOKIE_VALUE_LIMIT = 3_500;
const TELEMETRY_PROPERTIES = {
  demo_opened: new Set(["sampleReady"]),
  sample_loaded: new Set(["entryPoint"]),
  analysis_started: new Set(["mode", "inputCharacters", "sourceCount"]),
  analysis_succeeded: new Set(["provider", "durationMs", "evidenceCount"]),
  analysis_failed: new Set(["code", "stage"]),
  evidence_opened: new Set(["referenceCount", "sourceCount"]),
  comparison_opened: new Set(["hasPrevious", "addedCount", "changedCount", "resolvedCount"]),
  share_link_created: new Set(["expiresInDays"]),
};
const TELEMETRY_PATHS = new Set([
  "/",
  "/demo",
  "/login",
  "/projects",
  "/projects/:projectId",
  "/share",
]);
const telemetryRateBuckets = new Map();

export function createApiV1Handler(options = {}) {
  const gateway = options.gateway || createSupabaseGateway(options.supabase);
  const analyze = options.analyze || analyzeProjectContext;

  return async function handleApiV1(req, res, pathname) {
    if (pathname === "/api/health/live") {
      try {
        if (!allowOnly(req, res, ["GET"])) return true;
        writeData(res, 200, { status: "ok", commit: resolveBuildCommit(options) });
      } catch (error) {
        writeApiError(res, toApiError(error));
      }
      return true;
    }

    if (pathname === "/api/health/ready") {
      try {
        if (!allowOnly(req, res, ["GET"])) return true;
        if (options.readyCheck) await options.readyCheck();
        else {
          const repository = createModuBrainRepository(gateway.asServiceRole());
          await repository.ready();
        }
        writeData(res, 200, { status: "ready" });
      } catch {
        writeApiError(
          res,
          new ApiError(503, "DATABASE_UNAVAILABLE", "데이터베이스를 사용할 수 없습니다."),
        );
      }
      return true;
    }

    if (!pathname.startsWith("/api/v1/")) return false;

    try {
      if (req.method === "OPTIONS") {
        allowOnly(req, res, ["GET", "POST", "PATCH", "DELETE"]);
        return true;
      }
      if (isMutation(req.method)) assertSameOrigin(req);

      if (pathname === "/api/v1/telemetry") {
        await handleTelemetry(req, res, options);
        return true;
      }

      if (pathname === "/api/v1/auth/session") {
        await handleAuthSession(req, res, options, gateway);
        return true;
      }

      if (pathname === "/api/v1/auth/refresh") {
        await handleAuthRefresh(req, res, options, gateway);
        return true;
      }

      if (pathname === "/api/v1/shared/resolve") {
        await handleSharedResolve(req, res, options, gateway);
        return true;
      }

      const user = await authenticateApiRequest(req, res, options, gateway);

      if (pathname === "/api/v1/capabilities") {
        if (!allowOnly(req, res, ["GET"])) return true;
        writeData(res, 200, {
          openaiEnabled: openAIEnabled(options),
          accountExportEnabled: typeof options.accountDataOperations?.export === "function",
          accountDeletionEnabled: typeof options.accountDataOperations?.delete === "function",
        });
        return true;
      }

      if (pathname === "/api/v1/account/export") {
        await handleAccountExport(req, res, options, user);
        return true;
      }

      if (pathname === "/api/v1/account") {
        await handleAccountDelete(req, res, options, user);
        return true;
      }

      const repository = options.repositoryFactory
        ? await options.repositoryFactory(user, req)
        : createModuBrainRepository(gateway.forUser(user.accessToken));

      if (pathname === "/api/v1/projects") {
        await handleProjects(
          req,
          res,
          repository,
          req.method === "POST"
            ? await resolveServiceRepository(options, gateway, user, req)
            : null,
          user,
        );
        return true;
      }

      let match = pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
      if (match) {
        await handleProject(
          req,
          res,
          repository,
          isMutation(req.method)
            ? await resolveServiceRepository(options, gateway, user, req)
            : null,
          user,
          requireUuid(match[1], "projectId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/restore$/);
      if (match) {
        await handleProjectRestore(
          req,
          res,
          await resolveServiceRepository(options, gateway, user, req),
          user,
          requireUuid(match[1], "projectId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/sources$/);
      if (match) {
        await handleProjectSources(
          req,
          res,
          repository,
          req.method === "POST"
            ? await resolveServiceRepository(options, gateway, user, req)
            : null,
          user,
          requireUuid(match[1], "projectId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/imports$/);
      if (match) {
        await handleContextImport(
          req,
          res,
          repository,
          requireUuid(match[1], "projectId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/sources\/([^/]+)$/);
      if (match) {
        await handleSource(
          req,
          res,
          repository,
          isMutation(req.method)
            ? await resolveServiceRepository(options, gateway, user, req)
            : null,
          user,
          requireUuid(match[1], "sourceId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/sources\/([^/]+)\/restore$/);
      if (match) {
        await handleSourceRestore(
          req,
          res,
          await resolveServiceRepository(options, gateway, user, req),
          user,
          requireUuid(match[1], "sourceId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/sources\/([^/]+)\/segments$/);
      if (match) {
        await handleSourceSegments(
          req,
          res,
          repository,
          requireUuid(match[1], "sourceId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/source-segments\/([^/]+)$/);
      if (match) {
        await handleSourceSegment(
          req,
          res,
          repository,
          requireUuid(match[1], "segmentId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/analysis-runs$/);
      if (match) {
        const serviceRepository =
          req.method === "POST"
            ? await resolveServiceRepository(options, gateway, user, req)
            : null;
        await handleAnalysisRuns(req, res, {
          repository,
          serviceRepository,
          projectId: requireUuid(match[1], "projectId"),
          user,
          req,
          analyze,
          openAIEnabled: openAIEnabled(options),
          analysisOptions: options.analysisOptions,
        });
        return true;
      }

      match = pathname.match(/^\/api\/v1\/analysis-runs\/([^/]+)$/);
      if (match) {
        await handleAnalysisRun(
          req,
          res,
          repository,
          req.method === "DELETE"
            ? await resolveServiceRepository(options, gateway, user, req)
            : null,
          user,
          requireUuid(match[1], "runId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/analysis-runs\/([^/]+)\/step-events$/);
      if (match) {
        await handleAnalysisRunStepEvents(
          req,
          res,
          repository,
          requireUuid(match[1], "runId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/analysis-runs\/([^/]+)\/annotations$/);
      if (match) {
        await handleAnalysisRunAnnotations(
          req,
          res,
          repository,
          requireUuid(match[1], "runId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/analysis-runs\/([^/]+)\/share-links$/);
      if (match) {
        const serviceRepository =
          req.method === "POST"
            ? await resolveServiceRepository(options, gateway, user, req)
            : null;
        await handleShareLinks(
          req,
          res,
          repository,
          serviceRepository,
          user,
          requireUuid(match[1], "runId"),
        );
        return true;
      }

      match = pathname.match(/^\/api\/v1\/share-links\/([^/]+)$/);
      if (match) {
        await handleShareLink(
          req,
          res,
          await resolveServiceRepository(options, gateway, user, req),
          user,
          requireUuid(match[1], "shareLinkId"),
        );
        return true;
      }

      throw new ApiError(404, "NOT_FOUND", "요청한 API 경로를 찾을 수 없습니다.");
    } catch (error) {
      if (res.destroyed) return true;
      writeApiError(res, toApiError(error));
      return true;
    }
  };
}

async function handleProjects(req, res, repository, serviceRepository, user) {
  if (!allowOnly(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const archivedParam = url.searchParams.get("archived");
    if (archivedParam !== null && archivedParam !== "true" && archivedParam !== "false") {
      throw new ApiError(400, "INVALID_ARCHIVE_FILTER", "보관함 필터가 올바르지 않습니다.");
    }
    const rows = await repository.listProjects({ archived: archivedParam === "true" });
    writeData(res, 200, rows.map(projectResource));
    return;
  }

  const body = await readJson(req);
  const values = validateProject(body, false);
  const row = await serviceRepository.createProject(user.id, values);
  writeData(res, 201, projectResource(row), { Location: `/api/v1/projects/${row.id}` });
}

async function handleProjectRestore(req, res, serviceRepository, user, projectId) {
  if (!allowOnly(req, res, ["POST"])) return;
  writeData(
    res,
    200,
    projectResource(await serviceRepository.restoreProject(user.id, projectId)),
  );
}

async function handleProject(req, res, repository, serviceRepository, user, projectId) {
  if (!allowOnly(req, res, ["GET", "PATCH", "DELETE"])) return;
  if (req.method === "GET") {
    writeData(res, 200, projectResource(await repository.getProject(projectId)));
    return;
  }
  if (req.method === "PATCH") {
    const values = validateProject(await readJson(req), true);
    writeData(
      res,
      200,
      projectResource(await serviceRepository.updateProject(user.id, projectId, values)),
    );
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.searchParams.get("permanent") === "true") {
    if (req.headers["x-confirm-permanent-delete"] !== "delete") {
      throw new ApiError(
        400,
        "DELETE_CONFIRMATION_REQUIRED",
        "영구 삭제에는 X-Confirm-Permanent-Delete: delete 헤더가 필요합니다.",
      );
    }
    await serviceRepository.deleteProject(user.id, projectId, "delete");
  } else {
    await serviceRepository.archiveProject(user.id, projectId);
  }
  writeData(res, 200, { id: projectId, deleted: true, permanent: url.searchParams.get("permanent") === "true" });
}

async function handleProjectSources(req, res, repository, serviceRepository, user, projectId) {
  if (!allowOnly(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") {
    const page = readCursorPage(req, "sources");
    const result = await listRepositoryPage(
      repository,
      "listSourcesPage",
      "listSources",
      [projectId],
      page,
    );
    writePageData(
      res,
      result.rows.map(sourceListResource),
      page,
      result.hasMore,
      "sources",
      result.rows.at(-1),
    );
    return;
  }
  const values = validateSource(await readJson(req), false);
  const row = await serviceRepository.createSource(user.id, projectId, {
    ...values,
    content_sha256: sha256(values.content),
    char_count: unicodeLength(values.content),
  });
  writeData(res, 201, sourceResource(row), { Location: `/api/v1/sources/${row.id}` });
}

async function handleSource(req, res, repository, serviceRepository, user, sourceId) {
  if (!allowOnly(req, res, ["GET", "PATCH", "DELETE"])) return;
  if (req.method === "GET") {
    writeData(res, 200, sourceResource(await repository.getSource(sourceId)));
    return;
  }
  if (req.method === "DELETE") {
    writeData(
      res,
      200,
      sourceResource(await serviceRepository.archiveSource(user.id, sourceId)),
    );
    return;
  }
  const body = await readJson(req);
  const values = validateSource(body, true);
  if (
    body.kind !== undefined ||
    body.content !== undefined ||
    body.occurredAt !== undefined
  ) {
    const current = await repository.getSource(sourceId);
    if (hasSourceImport(current)) {
      throw new ApiError(
        409,
        "IMPORTED_SOURCE_IMMUTABLE",
        "가져온 원문의 내용과 시각은 변경할 수 없습니다. 제목만 수정하거나 새로 가져와 주세요.",
      );
    }
  }
  if (values.content !== undefined) {
    values.content_sha256 = sha256(values.content);
    values.char_count = unicodeLength(values.content);
  }
  writeData(
    res,
    200,
    sourceResource(await serviceRepository.updateSource(user.id, sourceId, values)),
  );
}

async function handleSourceRestore(req, res, serviceRepository, user, sourceId) {
  if (!allowOnly(req, res, ["POST"])) return;
  writeData(
    res,
    200,
    sourceResource(await serviceRepository.restoreSource(user.id, sourceId)),
  );
}

function hasSourceImport(source) {
  return Array.isArray(source?.source_imports)
    ? source.source_imports.length > 0
    : Boolean(source?.source_imports);
}

async function handleContextImport(req, res, repository, projectId) {
  if (!allowOnly(req, res, ["POST"])) return;
  const normalized = normalizeContextImport(await readJson(req));
  const title = boundedString(normalized.title, "title", 1, 120);
  const content = boundedString(
    normalized.content,
    "content",
    1,
    INPUT_CHARACTER_LIMIT,
    false,
  );
  const imported = await repository.importSourceContext(projectId, {
    kind: normalized.kind,
    title,
    content,
    occurredAt: normalized.occurredAt,
    provider: normalized.provider,
    externalId: boundedOptionalString(normalized.externalId, "externalId", 500),
    participants: normalized.participants.slice(0, 200),
    metadata: normalized.metadata,
    segments: normalized.segments,
  });
  writeData(
    res,
    imported.duplicate ? 200 : 201,
    contextImportResource(imported),
    { Location: `/api/v1/sources/${imported.source.id}` },
  );
}

async function handleSourceSegments(req, res, repository, sourceId) {
  if (!allowOnly(req, res, ["GET"])) return;
  const page = readCursorPage(req, "segments");
  const result = await listRepositoryPage(
    repository,
    "listSourceSegmentsPage",
    "listSourceSegments",
    [sourceId],
    page,
  );
  writePageData(
    res,
    result.rows.map(sourceSegmentResource),
    page,
    result.hasMore,
    "segments",
    result.rows.at(-1),
  );
}

async function handleSourceSegment(req, res, repository, segmentId) {
  if (!allowOnly(req, res, ["GET"])) return;
  if (typeof repository.getSourceSegment !== "function") {
    throw new ApiError(503, "FEATURE_NOT_AVAILABLE", "원문 구간 상세 조회를 사용할 수 없습니다.");
  }
  writeData(res, 200, sourceSegmentResource(await repository.getSourceSegment(segmentId)));
}

async function handleAnalysisRuns(req, res, context) {
  if (!allowOnly(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") {
    const page = readCursorPage(context.req, "runs");
    const result = await listRepositoryPage(
      context.repository,
      "listRunsPage",
      "listRuns",
      [context.projectId],
      page,
    );
    writePageData(
      res,
      result.rows.map(analysisRunListResource),
      page,
      result.hasMore,
      "runs",
      result.rows.at(-1),
    );
    return;
  }

  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "8~128자의 Idempotency-Key 헤더가 필요합니다.",
    );
  }

  const body = validateAnalysisRequest(await readJson(req));
  const mode = body.mode;
  if (mode === "openai" && !context.openAIEnabled) {
    throw new ApiError(503, "OPENAI_NOT_ENABLED", "OpenAI 분석이 활성화되지 않았습니다.");
  }
  const model =
    mode === "openai"
      ? context.analysisOptions?.model ||
        process.env.MODU_BRAIN_OPENAI_MODEL ||
        "gpt-5.6-terra"
      : null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  const startedAt = Date.now();
  let createdRunId = null;
  let terminal = false;
  let stepSequence = 0;
  let activeStep = null;
  let activeStepStartedAt = null;

  const appendStepEvent = async (step, status, values = {}) => {
    if (!createdRunId) return null;
    stepSequence += 1;
    return context.serviceRepository.appendRunStepEvent(
      createdRunId,
      context.user.id,
      {
        sequence: stepSequence,
        eventKey: `${step}:${status}`,
        step,
        status,
        ...values,
      },
    );
  };
  const beginStep = async (step) => {
    activeStep = step;
    activeStepStartedAt = Date.now();
    await appendStepEvent(step, "started");
  };
  const finishStep = async (status, code, values = {}) => {
    const step = activeStep;
    if (!step) return;
    const durationMs = Math.max(0, Date.now() - activeStepStartedAt);
    await appendStepEvent(step, status, { code, durationMs, ...values });
    activeStep = null;
    activeStepStartedAt = null;
  };

  try {
    throwIfAborted(controller, req, res);
    const project = await context.repository.getProject(context.projectId);
    throwIfAborted(controller, req, res);
    const selected = await context.repository.getSources(context.projectId, body.sourceIds);
    throwIfAborted(controller, req, res);
    if (selected.length !== body.sourceIds.length) {
      throw new ApiError(400, "INVALID_SOURCE_SELECTION", "선택한 기록을 사용할 수 없습니다.");
    }
    const totalCharacters = selected.reduce(
      (sum, source) => sum + unicodeLength(source.content),
      0,
    );
    if (totalCharacters > INPUT_CHARACTER_LIMIT) {
      throw new ApiError(
        413,
        "ANALYSIS_INPUT_TOO_LARGE",
        "분석 입력은 총 100,000자 이하여야 합니다.",
      );
    }
    const requestFingerprint = sha256(
      JSON.stringify({
        projectTitle: project.title,
        sources: selected
          .map((source) => ({
            id: source.id,
            kind: source.kind,
            title: source.title,
            contentSha256: source.content_sha256,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        mode,
        model,
      }),
    );

    const started = await context.serviceRepository.startRun(context.user.id, {
      projectId: context.projectId,
      sourceIds: body.sourceIds,
      idempotencyKey,
      requestFingerprint,
      providerMode: mode,
      providerModel: model,
    });
    if (started.outcome === "rate_limited" || started.outcome === "already_running") {
      const retryAfter = Math.max(
        1,
        Number(started.retryAfterSeconds) || (started.outcome === "already_running" ? 5 : 3600),
      );
      throw new ApiError(
        429,
        started.outcome === "already_running"
          ? "ANALYSIS_ALREADY_RUNNING"
          : "ANALYSIS_RATE_LIMITED",
        started.outcome === "already_running"
          ? "이 프로젝트의 분석이 이미 진행 중입니다. 잠시 후 다시 확인해 주세요."
          : "분석 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
        { retryAfter },
        { "Retry-After": String(retryAfter) },
      );
    }
    if (!started.run?.id) {
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "분석 실행을 저장하지 못했습니다.");
    }
    if (!started.reused) {
      createdRunId = started.run.id;
      await beginStep("source_snapshot");
    }
    throwIfAborted(controller, req, res);
    if (started.reused) {
      writeData(res, 200, analysisRunResource(started.run));
      return;
    }

    const snapshots = await context.repository.getRunSnapshots(createdRunId);
    throwIfAborted(controller, req, res);
    await finishStep("succeeded", "SNAPSHOT_READY", {
      sourceCount: snapshots.length,
      inputCharacters: snapshots.reduce(
        (sum, source) => sum + unicodeLength(String(source.content_snapshot || "")),
        0,
      ),
    });

    await beginStep("provider_analysis");

    if (mode === "openai") {
      const [globalAllowed, ipAllowed] = await Promise.all([
        context.serviceRepository.consumeOpenAIRateLimit("openai:global:day", "global"),
        context.serviceRepository.consumeOpenAIRateLimit(
          "openai:ip:hour",
          rateLimitIdentifier(context.req, {
            secret: context.analysisOptions?.rateLimitIdentifierSecret,
          }),
        ),
      ]);
      throwIfAborted(controller, req, res);
      if (!globalAllowed || !ipAllowed) {
        throw new ApiError(
          429,
          "OPENAI_RATE_LIMITED",
          "OpenAI 분석 사용량 한도를 초과했습니다.",
          undefined,
          { "Retry-After": "3600" },
        );
      }
    }
    const rawText = snapshots
      .map(
        (source) =>
          `[${source.source_kind}: ${source.source_title}]\n${source.content_snapshot}`,
      )
      .join("\n\n");
    const result = await context.analyze(
      { projectTitle: project.title, rawText },
      {
        ...(context.analysisOptions || {}),
        provider: mode === "openai" ? "openai" : "local-heuristic",
        model,
        reasoningEffort: "low",
        timeoutMs: OPENAI_TIMEOUT_MS,
        maxRawTextLength: INPUT_CHARACTER_LIMIT + body.sourceIds.length * 150,
        safetyIdentifier: privacyIdentifier(
          context.user.id,
          context.analysisOptions?.safetyIdentifierSecret,
        ),
        signal: controller.signal,
      },
    );
    const providerTelemetry = result?.[providerTelemetrySymbol] || {};
    throwIfAborted(controller, req, res);
    await finishStep("succeeded", "PROVIDER_COMPLETED");

    await beginStep("evidence_validation");
    const resultV2 = buildContextAnalysisResultV2(result, snapshots, createdRunId);
    await finishStep("succeeded", "EVIDENCE_VERIFIED", {
      validationOutcome: "passed",
      outputItemCount: countAnalysisItems(resultV2),
      evidenceReferenceCount: countEvidenceReferences(resultV2),
    });

    await beginStep("result_persistence");
    const completed = await context.serviceRepository.completeRun(
      createdRunId,
      context.user.id,
      {
        status: "succeeded",
        result_jsonb: resultV2,
        latency_ms: Date.now() - startedAt,
        input_tokens: providerTelemetry.usage?.inputTokens ?? null,
        output_tokens: providerTelemetry.usage?.outputTokens ?? null,
        reasoning_tokens: providerTelemetry.usage?.reasoningTokens ?? null,
        provider_request_id: providerTelemetry.requestId ?? null,
        completed_at: new Date().toISOString(),
      },
    );
    terminal = true;
    try {
      await finishStep("succeeded", "RUN_PERSISTED");
    } catch {
      // The succeeded run is authoritative; observability must not turn it into an HTTP failure.
      activeStep = null;
      activeStepStartedAt = null;
    }
    if (!res.destroyed) {
      writeData(res, 201, analysisRunResource(completed), {
        Location: `/api/v1/analysis-runs/${createdRunId}`,
      });
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    if (createdRunId && activeStep) {
      try {
        await finishStep(
          cancelled ? "cancelled" : "failed",
          cancelled ? "REQUEST_CANCELLED" : safeAnalysisCode(error),
          !cancelled && activeStep === "evidence_validation"
            ? { validationOutcome: "failed" }
            : {},
        );
      } catch {
        // The run terminal state remains authoritative if event persistence is unavailable.
      }
    }
    if (createdRunId && !terminal) {
      try {
        await context.serviceRepository.completeRun(createdRunId, context.user.id, {
          status: cancelled ? "cancelled" : "failed",
          error_code: cancelled ? "REQUEST_CANCELLED" : safeAnalysisCode(error),
          error_message: cancelled ? "요청이 취소되었습니다." : "분석을 완료하지 못했습니다.",
          latency_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        });
        terminal = true;
      } catch {
        // A stale running lease is recovered transactionally by the next start request.
      }
    }
    throw error;
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
  }
}

async function handleAnalysisRun(req, res, repository, serviceRepository, user, runId) {
  if (!allowOnly(req, res, ["GET", "DELETE"])) return;
  if (req.method === "GET") {
    writeData(res, 200, analysisRunResource(await repository.getRun(runId)));
    return;
  }
  await serviceRepository.deleteRun(runId, user.id);
  writeData(res, 200, { id: runId, deleted: true });
}

async function handleAnalysisRunStepEvents(req, res, repository, runId) {
  if (!allowOnly(req, res, ["GET"])) return;
  const rows = await repository.listRunStepEvents(runId);
  writeData(res, 200, rows.map(analysisRunStepEventResource));
}

async function handleAnalysisRunAnnotations(req, res, repository, runId) {
  if (!allowOnly(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") {
    const rows = await repository.listRunAnnotations(runId);
    writeData(res, 200, rows.map(analysisRunAnnotationResource));
    return;
  }

  const idempotencyKey = requireIdempotencyKey(req);
  const values = validateRunAnnotation(await readJson(req));
  const created = await repository.createRunAnnotation(runId, {
    idempotencyKey,
    ...values,
  });
  writeData(
    res,
    created.reused ? 200 : 201,
    analysisRunAnnotationResource(created.annotation),
    { Location: `/api/v1/analysis-runs/${runId}/annotations` },
  );
}

async function handleShareLinks(req, res, repository, serviceRepository, user, runId) {
  if (!allowOnly(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") {
    const rows = await repository.listShareLinks(runId);
    writeData(res, 200, rows.map(shareLinkResource));
    return;
  }
  const run = await repository.getRun(runId);
  if (run.status !== "succeeded") {
    throw new ApiError(409, "RUN_NOT_SHAREABLE", "성공한 분석만 공유할 수 있습니다.");
  }
  const body = await readJson(req);
  const expiresInDays = body.expiresInDays === undefined ? 7 : Number(body.expiresInDays);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
    throw new ApiError(400, "INVALID_EXPIRATION", "공유 링크 만료일은 1~30일이어야 합니다.");
  }
  const token = createShareToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  const row = await serviceRepository.createShareLink(runId, user.id, sha256(token), expiresAt);
  writeData(res, 201, {
    ...shareLinkResource(row),
    token,
    urlPath: `/share#token=${encodeURIComponent(token)}`,
  });
}

async function handleShareLink(req, res, serviceRepository, user, shareLinkId) {
  if (!allowOnly(req, res, ["DELETE"])) return;
  const row = await serviceRepository.revokeShareLink(shareLinkId, user.id);
  writeData(res, 200, shareLinkResource(row));
}

async function handleTelemetry(req, res, options) {
  if (!allowOnly(req, res, ["POST"])) return;
  if (!consumeTelemetryRateLimit(rateLimitIdentifier(req, options.rateLimitIdentifierOptions))) {
    throw new ApiError(429, "RATE_LIMITED", "이벤트 요청 한도를 초과했습니다.", undefined, {
      "Retry-After": "3600",
    });
  }
  const event = validateTelemetryEvent(await readJson(req, { maxBytes: TELEMETRY_BODY_LIMIT }));
  if (typeof options.recordProductEvent === "function") {
    try {
      await options.recordProductEvent(event, req);
    } catch {
      // Product analytics must never block the product flow or persist a retry payload.
    }
  }
  writeData(res, 202, { accepted: true });
}

async function handleAuthSession(req, res, options, gateway) {
  if (!allowOnly(req, res, ["GET", "POST", "DELETE"])) return;

  if (req.method === "POST") {
    const body = validateAuthSessionPayload(
      await readJson(req, { maxBytes: AUTH_SESSION_BODY_LIMIT }),
    );
    const user = await gateway.authenticate(body.accessToken, {
      signal: req.moduBrainSignal,
    });
    const expiresAt = writeAuthSessionCookies(req, res, body, {
      now: options.authNow || Date.now,
    });
    writeData(
      res,
      201,
      publicAuthSession(user, expiresAt),
      authSessionCacheHeaders(),
    );
    return;
  }

  if (req.method === "GET") {
    const session = await restoreCookieSession(req, res, options, gateway);
    writeData(
      res,
      200,
      publicAuthSession(session.user, session.expiresAt),
      authSessionCacheHeaders(),
    );
    return;
  }

  const cookies = readAuthSessionCookies(req);
  clearAuthSessionCookies(req, res);
  if (cookies.accessToken) {
    const logout = gateway
      .logout(cookies.accessToken, { signal: req.moduBrainSignal })
      .catch(() => undefined);
    await settleWithin(logout, options.authLogoutWaitMs);
  }
  setApiHeaders(res);
  setAuthSessionCacheHeaders(res);
  res.statusCode = 204;
  res.end();
}

async function handleAuthRefresh(req, res, options, gateway) {
  if (!allowOnly(req, res, ["POST"])) return;
  const session = await rotateCookieSession(req, res, options, gateway);
  writeData(
    res,
    200,
    publicAuthSession(session.user, session.expiresAt),
    authSessionCacheHeaders(),
  );
}

async function restoreCookieSession(req, res, options, gateway) {
  const cookies = readAuthSessionCookies(req);
  if (!cookies.accessToken && !cookies.refreshToken) {
    throw new ApiError(401, "AUTH_REQUIRED", "A login session is required.");
  }
  const now = (options.authNow || Date.now)();
  if (
    cookies.refreshToken &&
    (!cookies.accessToken || !cookies.expiresAt || cookies.expiresAt <= now + AUTH_REFRESH_LEAD_MS)
  ) {
    return rotateCookieSession(req, res, options, gateway, cookies);
  }

  try {
    const user = await gateway.authenticate(cookies.accessToken, {
      signal: req.moduBrainSignal,
    });
    return {
      user,
      accessToken: cookies.accessToken,
      expiresAt: cookies.expiresAt || deriveAccessExpiresAt(cookies.accessToken, 3600, now),
    };
  } catch (error) {
    if (error?.status === 401 && cookies.refreshToken) {
      return rotateCookieSession(req, res, options, gateway, cookies);
    }
    if (error?.status === 401) clearAuthSessionCookies(req, res);
    throw error;
  }
}

async function rotateCookieSession(req, res, options, gateway, existingCookies = undefined) {
  const cookies = existingCookies || readAuthSessionCookies(req);
  if (!cookies.refreshToken) {
    clearAuthSessionCookies(req, res);
    throw new ApiError(401, "AUTH_REQUIRED", "A refresh session is required.");
  }
  try {
    const rotated = await gateway.refreshSession(cookies.refreshToken, {
      signal: req.moduBrainSignal,
    });
    const user = await gateway.authenticate(rotated.accessToken, {
      signal: req.moduBrainSignal,
    });
    const expiresAt = writeAuthSessionCookies(req, res, rotated, {
      now: options.authNow || Date.now,
    });
    return { user, accessToken: rotated.accessToken, expiresAt };
  } catch (error) {
    if (error?.status === 401) clearAuthSessionCookies(req, res);
    throw error;
  }
}

async function handleSharedResolve(req, res, options, gateway) {
  if (!allowOnly(req, res, ["POST"])) return;
  const body = await readJson(req);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length < 32 || token.length > 128) {
    throw new ApiError(404, "SHARE_NOT_FOUND", "공유 링크를 찾을 수 없습니다.");
  }
  const repository = options.publicRepository
    ? options.publicRepository
    : createPublicShareRepository(gateway.asServiceRole());
  const tokenHash = sha256(token);
  const ipHash = rateLimitIdentifier(req, options.rateLimitIdentifierOptions);
  const [ipAllowed, tokenIpAllowed] = await Promise.all([
    repository.consumeRateLimit("share:ip:hour", ipHash, 600, 3600),
    repository.consumeRateLimit(
      "share:token-ip:hour",
      sha256(`${ipHash}:${tokenHash}`),
      60,
      3600,
    ),
  ]);
  if (!ipAllowed || !tokenIpAllowed) {
    throw new ApiError(429, "RATE_LIMITED", "요청 한도를 초과했습니다.", undefined, {
      "Retry-After": "3600",
    });
  }
  const shared = await repository.resolveShare(tokenHash);
  if (!shared) throw new ApiError(404, "SHARE_NOT_FOUND", "공유 링크를 찾을 수 없습니다.");
  writeData(res, 200, sharedAnalysisResource(shared));
}

async function handleAccountExport(req, res, options, user) {
  if (!allowOnly(req, res, ["GET"])) return;
  const exporter = options.accountDataOperations?.export;
  if (typeof exporter !== "function") {
    throw new ApiError(
      503,
      "ACCOUNT_EXPORT_NOT_ENABLED",
      "계정 데이터 내보내기는 아직 준비 중입니다. 데이터베이스 기능이 활성화된 뒤 사용할 수 있습니다.",
    );
  }
  writeData(res, 200, await exporter({ user, req }));
}

async function handleAccountDelete(req, res, options, user) {
  if (!allowOnly(req, res, ["DELETE"])) return;
  if (req.headers["x-confirm-account-delete"] !== "delete my account") {
    throw new ApiError(
      400,
      "ACCOUNT_DELETE_CONFIRMATION_REQUIRED",
      "계정 삭제에는 X-Confirm-Account-Delete: delete my account 헤더가 필요합니다.",
    );
  }
  const deleter = options.accountDataOperations?.delete;
  if (typeof deleter !== "function") {
    throw new ApiError(
      503,
      "ACCOUNT_DELETE_NOT_ENABLED",
      "계정 삭제는 아직 준비 중입니다. 데이터베이스 기능이 활성화된 뒤 사용할 수 있습니다.",
    );
  }
  await deleter({ user, req });
  clearAuthSessionCookies(req, res);
  writeData(res, 200, { deleted: true }, authSessionCacheHeaders());
}

function readCursorPage(req, kind) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestedLimit = url.searchParams.get("limit");
  const limit = requestedLimit === null ? DEFAULT_PAGE_LIMIT : Number(requestedLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ApiError(
      400,
      "INVALID_PAGE_LIMIT",
      `페이지 크기는 1~${MAX_PAGE_LIMIT} 사이의 정수여야 합니다.`,
    );
  }
  const cursor = url.searchParams.get("cursor");
  return { limit, cursor: cursor ? decodePageCursor(cursor, kind) : null };
}

function decodePageCursor(cursor, expectedKind) {
  try {
    if (cursor.length > 1_024) throw new Error("invalid cursor");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value?.version !== 1 || value.kind !== expectedKind || !validCursorKeys(value)) {
      throw new Error("invalid cursor");
    }
    return value;
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "페이지 커서가 올바르지 않습니다.");
  }
}

function encodePageCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function listRepositoryPage(repository, pageMethod, legacyMethod, args, page) {
  if (typeof repository[pageMethod] === "function") {
    return repository[pageMethod](...args, page);
  }
  const rows = await repository[legacyMethod](...args);
  const normalized = Array.isArray(rows) ? rows : [];
  const remaining = page.cursor
    ? normalized.filter((row) => rowIsAfterCursor(row, page.cursor))
    : normalized;
  return {
    rows: remaining.slice(0, page.limit),
    hasMore: remaining.length > page.limit,
  };
}

function writePageData(res, rows, page, hasMore, kind, lastRow) {
  const nextCursor = hasMore && lastRow
    ? encodePageCursor(cursorFromRow(kind, lastRow))
    : null;
  setApiHeaders(res);
  if (nextCursor) res.setHeader("X-Next-Cursor", nextCursor);
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      data: rows,
      page: {
        limit: page.limit,
        count: rows.length,
        hasMore,
        nextCursor,
      },
    }),
  );
}

function validCursorKeys(cursor) {
  if (typeof cursor.id !== "string" || !cursor.id) return false;
  if (cursor.kind === "segments") {
    return Number.isSafeInteger(cursor.ordinal) && cursor.ordinal >= 0;
  }
  if (!validIsoCursorDate(cursor.createdAt)) return false;
  if (cursor.kind === "sources") {
    return cursor.occurredAt === null || validIsoCursorDate(cursor.occurredAt);
  }
  return cursor.kind === "runs";
}

function validIsoCursorDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).valueOf());
}

function cursorFromRow(kind, row) {
  const common = { version: 1, kind, id: row.id };
  if (kind === "segments") return { ...common, ordinal: row.ordinal };
  if (kind === "sources") {
    return {
      ...common,
      occurredAt: row.occurred_at ?? null,
      createdAt: row.created_at,
    };
  }
  return { ...common, createdAt: row.created_at };
}

function rowIsAfterCursor(row, cursor) {
  if (cursor.kind === "segments") {
    return row.ordinal > cursor.ordinal ||
      (row.ordinal === cursor.ordinal && String(row.id) > cursor.id);
  }
  if (cursor.kind === "runs") {
    return row.created_at < cursor.createdAt ||
      (row.created_at === cursor.createdAt && String(row.id) < cursor.id);
  }
  const occurredAt = row.occurred_at ?? null;
  if (cursor.occurredAt === null) {
    return occurredAt === null && (
      row.created_at < cursor.createdAt ||
      (row.created_at === cursor.createdAt && String(row.id) < cursor.id)
    );
  }
  if (occurredAt === null) return true;
  if (occurredAt < cursor.occurredAt) return true;
  if (occurredAt > cursor.occurredAt) return false;
  return row.created_at < cursor.createdAt ||
    (row.created_at === cursor.createdAt && String(row.id) < cursor.id);
}

function sourceListResource(row) {
  const resource = sourceResource(row, { includeContent: false });
  delete resource.contentSha256;
  if (!resource.import) return resource;
  const safeImport = { ...resource.import };
  delete safeImport.participants;
  delete safeImport.metadata;
  return { ...resource, import: safeImport };
}

function analysisRunListResource(row) {
  const resource = analysisRunResource(row);
  delete resource.result;
  return resource;
}

function consumeTelemetryRateLimit(subjectHash) {
  const now = Date.now();
  const windowStart = now - 3_600_000;
  const recent = (telemetryRateBuckets.get(subjectHash) ?? []).filter(
    (timestamp) => timestamp > windowStart,
  );
  if (recent.length >= 120) return false;
  recent.push(now);
  telemetryRateBuckets.set(subjectHash, recent);
  if (telemetryRateBuckets.size > 10_000) {
    for (const [key, timestamps] of telemetryRateBuckets) {
      if (timestamps.every((timestamp) => timestamp <= windowStart)) {
        telemetryRateBuckets.delete(key);
      }
      if (telemetryRateBuckets.size <= 8_000) break;
    }
  }
  return true;
}

function validateProject(body, partial) {
  assertObject(body);
  const values = {};
  if (!partial || body.title !== undefined) {
    values.title = boundedString(body.title, "title", 2, 120);
  }
  if (!partial || body.description !== undefined) {
    values.description = boundedString(body.description || "", "description", 0, 2_000);
  }
  if (partial && Object.keys(values).length === 0) {
    throw new ApiError(400, "EMPTY_UPDATE", "변경할 값을 입력해 주세요.");
  }
  return values;
}

function validateTelemetryEvent(body) {
  assertObject(body);
  const topLevel = new Set(["name", "occurredAt", "path", "properties"]);
  if (Object.keys(body).some((key) => !topLevel.has(key))) {
    throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "허용되지 않은 이벤트 필드가 있습니다.");
  }
  if (typeof body.name !== "string" || !Object.hasOwn(TELEMETRY_PROPERTIES, body.name)) {
    throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "허용되지 않은 이벤트 이름입니다.");
  }
  if (typeof body.path !== "string" || !TELEMETRY_PATHS.has(body.path)) {
    throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "허용되지 않은 화면 경로입니다.");
  }
  const occurredAt = new Date(body.occurredAt);
  if (typeof body.occurredAt !== "string" || Number.isNaN(occurredAt.valueOf())) {
    throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "이벤트 시각이 올바르지 않습니다.");
  }
  assertObject(body.properties);
  const allowedProperties = TELEMETRY_PROPERTIES[body.name];
  if (Object.keys(body.properties).some((key) => !allowedProperties.has(key))) {
    throw new ApiError(
      400,
      "INVALID_TELEMETRY_EVENT",
      "원문, 이메일, 토큰, 식별자 또는 허용되지 않은 속성은 수집하지 않습니다.",
    );
  }
  const properties = Object.fromEntries(
    Object.entries(body.properties).map(([key, value]) => {
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "이벤트 속성 값이 올바르지 않습니다.");
      }
      if (typeof value === "string" && value.length > 120) {
        throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "이벤트 문자열이 너무 깁니다.");
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new ApiError(400, "INVALID_TELEMETRY_EVENT", "이벤트 숫자 값이 올바르지 않습니다.");
      }
      return [key, value];
    }),
  );
  return {
    name: body.name,
    occurredAt: occurredAt.toISOString(),
    path: body.path,
    properties,
  };
}

function validateSource(body, partial) {
  assertObject(body);
  const values = {};
  if (!partial || body.kind !== undefined) {
    if (!SOURCE_KINDS.has(body.kind)) {
      throw new ApiError(400, "INVALID_SOURCE_KIND", "기록 유형이 올바르지 않습니다.");
    }
    values.kind = body.kind;
  }
  if (!partial || body.title !== undefined) values.title = boundedString(body.title, "title", 1, 120);
  if (!partial || body.content !== undefined) {
    values.content = boundedString(body.content, "content", 1, INPUT_CHARACTER_LIMIT, false);
  }
  if (!partial || body.occurredAt !== undefined) {
    values.occurred_at = optionalIsoDate(body.occurredAt);
  }
  if (partial && Object.keys(values).length === 0) {
    throw new ApiError(400, "EMPTY_UPDATE", "변경할 값을 입력해 주세요.");
  }
  return values;
}

function validateAnalysisRequest(body) {
  assertObject(body);
  if (!Array.isArray(body.sourceIds) || body.sourceIds.length < 1 || body.sourceIds.length > 50) {
    throw new ApiError(400, "INVALID_SOURCE_SELECTION", "1~50개의 기록을 선택해 주세요.");
  }
  const sourceIds = [...new Set(body.sourceIds.map((id) => requireUuid(id, "sourceId")))];
  if (sourceIds.length !== body.sourceIds.length) {
    throw new ApiError(400, "INVALID_SOURCE_SELECTION", "중복되지 않은 기록을 선택해 주세요.");
  }
  const requestedMode = String(body.mode || body.provider || "local").toLowerCase();
  const mode = ["local", "local-heuristic", "mock"].includes(requestedMode)
    ? "local"
    : requestedMode;
  if (!new Set(["local", "openai"]).has(mode)) {
    throw new ApiError(400, "INVALID_ANALYSIS_MODE", "분석 모드는 local 또는 openai여야 합니다.");
  }
  return { sourceIds, mode };
}

function validateRunAnnotation(body) {
  assertObject(body);
  const allowedKeys = new Set(["annotationType", "targetType", "targetId", "body"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new ApiError(
      400,
      "INVALID_ANNOTATION",
      "Feedback accepts only annotationType, targetType, targetId, and body.",
    );
  }
  if (!ANNOTATION_TYPES.has(body.annotationType)) {
    throw new ApiError(400, "INVALID_ANNOTATION", "The annotation type is not supported.");
  }
  if (!ANNOTATION_TARGET_TYPES.has(body.targetType)) {
    throw new ApiError(400, "INVALID_ANNOTATION", "The annotation target is not supported.");
  }
  const targetId = boundedOptionalString(body.targetId, "targetId", 160);
  if (
    (body.targetType === "run" && targetId !== null) ||
    (body.targetType !== "run" && targetId === null)
  ) {
    throw new ApiError(400, "INVALID_ANNOTATION", "The annotation target is incomplete.");
  }
  return {
    annotationType: body.annotationType,
    targetType: body.targetType,
    targetId,
    body: boundedString(body.body, "body", 1, 2_000),
  };
}

function requireIdempotencyKey(req) {
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "An 8-128 character Idempotency-Key header is required.",
    );
  }
  return idempotencyKey;
}

function boundedString(value, field, min, max, trim = true) {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_FIELD", `${field} 값이 올바르지 않습니다.`);
  }
  const normalized = trim ? value.trim() : value;
  const length = unicodeLength(normalized);
  if (length < min || length > max) {
    throw new ApiError(400, "INVALID_FIELD", `${field} 길이가 올바르지 않습니다.`, {
      field,
      minLength: min,
      maxLength: max,
    });
  }
  return normalized;
}

function boundedOptionalString(value, field, max) {
  if (value === null || value === undefined || value === "") return null;
  return boundedString(value, field, 1, max);
}

function optionalIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new ApiError(400, "INVALID_FIELD", "occurredAt 값이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_JSON", "JSON 객체를 입력해 주세요.");
  }
}

async function authenticateApiRequest(req, res, options, gateway) {
  const hasAuthorization = typeof req.headers.authorization === "string";
  if (!hasAuthorization) {
    const cookies = readAuthSessionCookies(req);
    if (cookies.accessToken || cookies.refreshToken) {
      const session = await restoreCookieSession(req, res, options, gateway);
      return {
        ...session.user,
        accessToken: session.accessToken,
      };
    }
  }
  const accessToken = bearerToken(req);
  const user = options.authenticate
    ? await options.authenticate(req, accessToken)
    : await gateway.authenticate(accessToken, { signal: req.moduBrainSignal });
  return {
    ...user,
    accessToken: user?.accessToken || accessToken,
  };
}

function validateAuthSessionPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_AUTH_SESSION", "The login session is invalid.");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !["accessToken", "refreshToken", "expiresIn"].includes(key))) {
    throw new ApiError(400, "INVALID_AUTH_SESSION", "The login session contains unsupported fields.");
  }
  const accessToken = validateCookieToken(value.accessToken);
  const refreshToken = validateCookieToken(value.refreshToken);
  const expiresIn = Number(value.expiresIn);
  if (!accessToken || !refreshToken || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 86_400) {
    throw new ApiError(400, "INVALID_AUTH_SESSION", "The login session is invalid.");
  }
  return { accessToken, refreshToken, expiresIn };
}

function validateCookieToken(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > AUTH_COOKIE_VALUE_LIMIT) {
    return null;
  }
  if (/\s/.test(value) || value.includes(String.fromCharCode(127))) return null;
  try {
    return encodeURIComponent(value).length <= AUTH_COOKIE_VALUE_LIMIT ? value : null;
  } catch {
    return null;
  }
}

function publicAuthSession(user, expiresAt) {
  return {
    user: {
      id: String(user?.id || ""),
      email: typeof user?.email === "string" ? user.email : "",
    },
    expiresAt,
  };
}

async function settleWithin(promise, requestedTimeoutMs) {
  const timeoutMs = Math.min(2_000, Math.max(10, Number(requestedTimeoutMs) || 750));
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((resolvePromise) => {
        timer = setTimeout(resolvePromise, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
  return match[1];
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    const hasAuthorization = typeof req.headers.authorization === "string";
    const cookies = readAuthSessionCookies(req);
    if (!hasAuthorization && (cookies.accessToken || cookies.refreshToken)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "요청 출처가 허용되지 않습니다.");
    }
    return;
  }
  // Host is defined by the actual HTTP request target. A client-controlled
  // X-Forwarded-Host must never redefine the same-origin security boundary.
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
  let expected;
  let supplied;
  try {
    expected = new URL(`${protocol}://${host}`).origin;
    supplied = new URL(origin).origin;
  } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "요청 출처가 허용되지 않습니다.");
  }
  if (supplied !== expected) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "요청 출처가 허용되지 않습니다.");
  }
}

function safeAnalysisCode(error) {
  const code = String(error?.code || "ANALYSIS_FAILED");
  return /^[A-Z0-9_]{3,80}$/.test(code) ? code : "ANALYSIS_FAILED";
}

function countAnalysisItems(result) {
  return [
    result?.keyTerms,
    result?.decisions,
    result?.participants,
    result?.questions,
    result?.knowledgeMap?.nodes,
    result?.participantAgents?.views,
  ].reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
}

function countEvidenceReferences(value) {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countEvidenceReferences(item), 0);
  }
  if (!value || typeof value !== "object") return 0;
  if (
    typeof value.sourceRecordId === "string" &&
    typeof value.sourceTitle === "string" &&
    typeof value.quote === "string"
  ) {
    return 1;
  }
  return Object.values(value).reduce(
    (sum, item) => sum + countEvidenceReferences(item),
    0,
  );
}

function throwIfAborted(controller, req, res) {
  if (
    !controller.signal.aborted &&
    !req.aborted &&
    !req.socket?.destroyed &&
    !res.destroyed
  ) {
    return;
  }
  controller.abort();
  throw new ApiError(499, "REQUEST_CANCELLED", "요청이 취소되었습니다.");
}

function isMutation(method) {
  return !new Set(["GET", "HEAD", "OPTIONS"]).has(method);
}

function unicodeLength(value) {
  return Array.from(value).length;
}

function openAIEnabled(options) {
  if (typeof options.openAIEnabled === "boolean") return options.openAIEnabled;
  return (
    String(process.env.MODU_BRAIN_OPENAI_ENABLED || "").toLowerCase() === "true" &&
    Boolean(process.env.OPENAI_API_KEY) &&
    Boolean(process.env.MODU_BRAIN_OPENAI_MODEL)
  );
}

function resolveBuildCommit(options) {
  const candidates = [
    options.buildCommit,
    process.env.RENDER_GIT_COMMIT,
    process.env.SOURCE_VERSION,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim().toLowerCase();
    if (/^[0-9a-f]{7,40}$/.test(normalized)) return normalized;
  }
  return null;
}

function resolveServiceRepository(options, gateway, user, req) {
  return options.serviceRepositoryFactory
    ? options.serviceRepositoryFactory(user, req)
    : createModuBrainServiceRepository(gateway.asServiceRole());
}
