import { ApiError } from "./apiErrors.mjs";

const projectSelect = "id,owner_id,title,description,archived_at,created_at,updated_at";
const sourceSelect =
  "id,project_id,kind,title,content,content_sha256,char_count,occurred_at,archived_at,created_at,updated_at,source_imports(id,provider,participants,segment_count,imported_at,metadata)";
const sourceListSelect =
  "id,project_id,kind,title,char_count,occurred_at,archived_at,created_at,updated_at,source_imports(id,provider,segment_count,imported_at)";
const runSelect =
  "id,project_id,created_by,idempotency_key,status,provider_mode,provider_model,schema_version,result_jsonb,error_code,error_message,latency_ms,input_tokens,output_tokens,created_at,started_at,completed_at,analysis_run_sources(source_record_id)";
const runListSelect =
  "id,project_id,status,provider_mode,provider_model,schema_version,error_code,error_message,created_at,started_at,completed_at,analysis_run_sources(source_record_id)";
const sourceSegmentSelect =
  "id,source_record_id,ordinal,speaker,text,occurred_at,external_id,source_url";
const runStepEventSelect =
  "id,analysis_run_id,sequence,event_key,step_name,status,validation_outcome,code,duration_ms,source_count,input_characters,output_item_count,evidence_reference_count,created_at";
const runAnnotationSelect =
  "id,analysis_run_id,annotation_type,target_type,target_id,body,created_at";
const shareSelect = "id,analysis_run_id,expires_at,revoked_at,created_at";

export function createModuBrainRepository(client) {
  return {
    async ready() {
      await client.request("projects?select=id&limit=1", { headers: { Range: "0-0" } });
      return true;
    },

    async listProjects({ archived = false } = {}) {
      return client.request(
        `projects?select=${projectSelect}&archived_at=${archived ? "not.is.null" : "is.null"}&order=updated_at.desc`,
      );
    },
    async getProject(projectId) {
      return requireSingle(
        await client.request(`projects?id=eq.${encode(projectId)}&select=${projectSelect}`),
      );
    },

    async listSources(projectId) {
      await this.getProject(projectId);
      return client.request(
        `source_records?project_id=eq.${encode(projectId)}&archived_at=is.null&select=${sourceSelect}&order=occurred_at.desc.nullslast,created_at.desc`,
      );
    },
    async listSourcesPage(projectId, page) {
      await this.getProject(projectId);
      return requestPage(
        client,
        `source_records?project_id=eq.${encode(projectId)}&archived_at=is.null&select=${sourceListSelect}&order=occurred_at.desc.nullslast,created_at.desc,id.desc`,
        page,
        sourceCursorFilter(page.cursor),
      );
    },
    async importSourceContext(projectId, values) {
      const result = single(
        await client.request("rpc/import_source_context", {
          method: "POST",
          body: {
            p_project_id: projectId,
            p_kind: values.kind,
            p_title: values.title,
            p_content: values.content,
            p_provider: values.provider,
            p_external_id: values.externalId || null,
            p_occurred_at: values.occurredAt,
            p_participants: values.participants || [],
            p_metadata: values.metadata || {},
            p_segments: values.segments || [],
          },
        }),
      );
      if (!result?.source) {
        throw new ApiError(503, "DATABASE_UNAVAILABLE", "가져오기 결과를 저장하지 못했습니다.");
      }
      return result;
    },
    async getSource(sourceId) {
      return requireSingle(
        await client.request(`source_records?id=eq.${encode(sourceId)}&select=${sourceSelect}`),
      );
    },
    async getSources(projectId, sourceIds) {
      if (!sourceIds.length) return [];
      const values = sourceIds.map(encode).join(",");
      return client.request(
        `source_records?project_id=eq.${encode(projectId)}&id=in.(${values})&archived_at=is.null&select=${sourceSelect}&order=created_at.asc`,
      );
    },
    async listSourceSegments(sourceId) {
      await this.getSource(sourceId);
      return client.request(
        `source_segments?source_record_id=eq.${encode(sourceId)}&select=${sourceSegmentSelect}&order=ordinal.asc,id.asc`,
      );
    },
    async listSourceSegmentsPage(sourceId, page) {
      await this.getSource(sourceId);
      return requestPage(
        client,
        `source_segments?source_record_id=eq.${encode(sourceId)}&select=${sourceSegmentSelect}&order=ordinal.asc,id.asc`,
        page,
        segmentCursorFilter(page.cursor),
      );
    },
    async getSourceSegment(segmentId) {
      return requireSingle(
        await client.request(
          `source_segments?id=eq.${encode(segmentId)}&select=${sourceSegmentSelect}`,
        ),
      );
    },

    async listRuns(projectId) {
      await this.getProject(projectId);
      return client.request(
        `analysis_runs?project_id=eq.${encode(projectId)}&select=${runSelect}&order=created_at.desc`,
      );
    },
    async listRunsPage(projectId, page) {
      await this.getProject(projectId);
      return requestPage(
        client,
        `analysis_runs?project_id=eq.${encode(projectId)}&select=${runListSelect}&order=created_at.desc,id.desc`,
        page,
        runCursorFilter(page.cursor),
      );
    },
    async getRun(runId) {
      return requireSingle(
        await client.request(`analysis_runs?id=eq.${encode(runId)}&select=${runSelect}`),
      );
    },
    async getRunSnapshots(runId) {
      await this.getRun(runId);
      return client.request(
        `analysis_run_sources?analysis_run_id=eq.${encode(runId)}&select=source_record_id,source_title,source_kind,content_snapshot,content_sha256,char_count&order=created_at.asc`,
      );
    },
    async listRunStepEvents(runId) {
      await this.getRun(runId);
      return client.request(
        `analysis_run_step_events?analysis_run_id=eq.${encode(runId)}&select=${runStepEventSelect}&order=sequence.asc`,
      );
    },
    async listRunAnnotations(runId) {
      await this.getRun(runId);
      return client.request(
        `analysis_run_annotations?analysis_run_id=eq.${encode(runId)}&select=${runAnnotationSelect}&order=created_at.desc`,
      );
    },
    async createRunAnnotation(runId, values) {
      const result = single(
        await client.request("rpc/create_analysis_run_annotation", {
          method: "POST",
          body: {
            p_analysis_run_id: runId,
            p_idempotency_key: values.idempotencyKey,
            p_annotation_type: values.annotationType,
            p_target_type: values.targetType,
            p_target_id: values.targetId,
            p_body: values.body,
          },
        }),
      );
      if (!result?.annotation) {
        throw new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "The annotation could not be persisted.",
        );
      }
      return {
        reused: result.outcome === "reused",
        annotation: result.annotation,
      };
    },

    async listShareLinks(runId) {
      await this.getRun(runId);
      return client.request(
        `share_links?analysis_run_id=eq.${encode(runId)}&select=${shareSelect}&order=created_at.desc`,
      );
    },
  };
}

export function createModuBrainServiceRepository(client) {
  return {
    async createProject(userId, values) {
      return requireSingle(
        await client.request("rpc/app_create_project", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_title: values.title,
            p_description: values.description || "",
          },
        }),
      );
    },
    async updateProject(userId, projectId, values) {
      return requireSingle(
        await client.request("rpc/app_update_project", {
          method: "POST",
          body: { p_user_id: userId, p_project_id: projectId, p_patch: values },
        }),
      );
    },
    async archiveProject(userId, projectId) {
      return requireSingle(
        await client.request("rpc/app_archive_project", {
          method: "POST",
          body: { p_user_id: userId, p_project_id: projectId },
        }),
      );
    },
    async restoreProject(userId, projectId) {
      return requireSingle(
        await client.request("rpc/app_restore_project", {
          method: "POST",
          body: { p_user_id: userId, p_project_id: projectId },
        }),
      );
    },
    async deleteProject(userId, projectId, confirmation) {
      return requireSingle(
        await client.request("rpc/app_delete_project", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_project_id: projectId,
            p_confirmation: confirmation,
          },
        }),
      );
    },
    async createSource(userId, projectId, values) {
      return requireSingle(
        await client.request("rpc/app_create_source_record", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_project_id: projectId,
            p_kind: values.kind,
            p_title: values.title,
            p_content: values.content,
            p_content_sha256: values.content_sha256,
            p_char_count: values.char_count,
            p_occurred_at: values.occurred_at ?? null,
          },
        }),
      );
    },
    async updateSource(userId, sourceId, values) {
      return requireSingle(
        await client.request("rpc/app_update_source_record", {
          method: "POST",
          body: { p_user_id: userId, p_source_id: sourceId, p_patch: values },
        }),
      );
    },
    async archiveSource(userId, sourceId) {
      return requireSingle(
        await client.request("rpc/app_archive_source_record", {
          method: "POST",
          body: { p_user_id: userId, p_source_id: sourceId },
        }),
      );
    },
    async restoreSource(userId, sourceId) {
      return requireSingle(
        await client.request("rpc/app_restore_source_record", {
          method: "POST",
          body: { p_user_id: userId, p_source_id: sourceId },
        }),
      );
    },
    async startRun(userId, values) {
      const response = requireSingle(
        await client.request("rpc/app_start_analysis_run", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_project_id: values.projectId,
            p_source_ids: values.sourceIds,
            p_idempotency_key: values.idempotencyKey,
            p_request_fingerprint: values.requestFingerprint,
            p_provider_mode: values.providerMode,
            p_provider_model: values.providerModel,
          },
        }),
      );
      return {
        outcome: response.outcome,
        reused: response.outcome === "reused",
        run: response.run,
        retryAfterSeconds: response.retry_after_seconds ?? null,
      };
    },
    async appendRunStepEvent(runId, userId, values) {
      return requireSingle(
        await client.request("rpc/app_append_analysis_run_step_event", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_run_id: runId,
            p_sequence: values.sequence,
            p_event_key: values.eventKey,
            p_step_name: values.step,
            p_status: values.status,
            p_validation_outcome: values.validationOutcome ?? null,
            p_code: values.code ?? null,
            p_duration_ms: values.durationMs ?? null,
            p_source_count: values.sourceCount ?? null,
            p_input_characters: values.inputCharacters ?? null,
            p_output_item_count: values.outputItemCount ?? null,
            p_evidence_reference_count: values.evidenceReferenceCount ?? null,
          },
        }),
      );
    },
    async completeRun(runId, userId, values) {
      return requireSingle(
        await client.request("rpc/app_complete_analysis_run", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_run_id: runId,
            p_status: values.status,
            p_result_jsonb: values.result_jsonb ?? null,
            p_error_code: values.error_code ?? null,
            p_error_message: values.error_message ?? null,
            p_latency_ms: values.latency_ms ?? null,
            p_input_tokens: values.input_tokens ?? null,
            p_output_tokens: values.output_tokens ?? null,
            p_provider_request_id: values.provider_request_id ?? null,
            p_reasoning_tokens: values.reasoning_tokens ?? null,
            p_completed_at: values.completed_at ?? new Date().toISOString(),
          },
        }),
      );
    },
    async deleteRun(runId, userId) {
      return requireSingle(
        await client.request("rpc/app_delete_analysis_run", {
          method: "POST",
          body: { p_user_id: userId, p_run_id: runId },
        }),
      );
    },
    async createShareLink(runId, userId, tokenHash, expiresAt) {
      return requireSingle(
        await client.request("rpc/app_create_share_link", {
          method: "POST",
          body: {
            p_user_id: userId,
            p_run_id: runId,
            p_token_hash: tokenHash,
            p_expires_at: expiresAt,
          },
        }),
      );
    },
    async revokeShareLink(shareLinkId, userId) {
      return requireSingle(
        await client.request("rpc/app_revoke_share_link", {
          method: "POST",
          body: { p_user_id: userId, p_share_link_id: shareLinkId },
        }),
      );
    },
    async consumeOpenAIRateLimit(scope, subject) {
      const rows = await client.request("rpc/consume_openai_rate_limit", {
        method: "POST",
        body: { p_scope: scope, p_subject: subject },
      });
      return rows === true || rows?.[0]?.consume_openai_rate_limit === true;
    },
  };
}

export function createPublicShareRepository(client) {
  return {
    async resolveShare(tokenHash) {
      const rows = await client.request("rpc/resolve_shared_analysis", {
        method: "POST",
        body: { p_token_hash: tokenHash },
      });
      return single(rows) || null;
    },
    async consumeRateLimit(scope, subject, limit, windowSeconds) {
      const rows = await client.request("rpc/app_consume_public_rate_limit", {
        method: "POST",
        body: {
          p_scope: scope,
          p_subject_hash: subject,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        },
      });
      return rows === true || rows?.[0]?.app_consume_public_rate_limit === true;
    },
  };
}

function encode(value) {
  return encodeURIComponent(String(value));
}

async function requestPage(client, path, page = {}, cursorFilter = "") {
  const limit = Number.isInteger(page.limit) && page.limit > 0 ? page.limit : 50;
  const rows = await client.request(
    `${path}${cursorFilter ? `&${cursorFilter}` : ""}&limit=${limit + 1}`,
  );
  const normalized = Array.isArray(rows) ? rows : [];
  return {
    rows: normalized.slice(0, limit),
    hasMore: normalized.length > limit,
  };
}

function runCursorFilter(cursor) {
  if (!cursor) return "";
  return `or=(created_at.lt.${encode(cursor.createdAt)},and(created_at.eq.${encode(cursor.createdAt)},id.lt.${encode(cursor.id)}))`;
}

function segmentCursorFilter(cursor) {
  if (!cursor) return "";
  return `or=(ordinal.gt.${cursor.ordinal},and(ordinal.eq.${cursor.ordinal},id.gt.${encode(cursor.id)}))`;
}

function sourceCursorFilter(cursor) {
  if (!cursor) return "";
  const createdTie = `or(created_at.lt.${encode(cursor.createdAt)},and(created_at.eq.${encode(cursor.createdAt)},id.lt.${encode(cursor.id)}))`;
  if (cursor.occurredAt === null) {
    return `occurred_at=is.null&or=${createdTie.slice(2)}`;
  }
  return `or=(occurred_at.lt.${encode(cursor.occurredAt)},occurred_at.is.null,and(occurred_at.eq.${encode(cursor.occurredAt)},${createdTie}))`;
}

function single(rows) {
  return Array.isArray(rows) ? rows[0] || null : rows;
}

function requireSingle(rows) {
  const row = single(rows);
  if (!row) throw new ApiError(404, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
  return row;
}
