// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createModuBrainRepository,
  createModuBrainServiceRepository,
  createPublicShareRepository,
} from "./moduBrainRepository.mjs";

const ID = "22222222-2222-4222-8222-222222222222";

describe("Modu Brain PostgREST repository", () => {
  it("covers owner-scoped reads and the two authenticated compatibility RPCs", async () => {
    const project = { id: ID, title: "project" };
    const source = { id: ID, project_id: ID, content: "text" };
    const run = { id: ID, project_id: ID, analysis_run_sources: [{ source_record_id: ID }] };
    const snapshot = { source_record_id: ID, content_snapshot: "text" };
    const segment = { id: ID, source_record_id: ID, ordinal: 0, text: "text" };
    const stepEvent = { id: ID, analysis_run_id: ID, event_key: "source_snapshot:succeeded" };
    const annotation = { id: ID, analysis_run_id: ID, annotation_type: "note" };
    const share = { id: ID, analysis_run_id: ID };
    const request = vi.fn(async (path) => {
      if (path === "rpc/create_analysis_run_annotation") {
        return [{ outcome: "created", annotation }];
      }
      if (path === "rpc/import_source_context") {
        return { source, import_id: ID, provider: "paste", segment_count: 1 };
      }
      if (path.startsWith("projects")) return [project];
      if (path.startsWith("source_records")) return [source];
      if (path.startsWith("source_segments")) return [segment];
      if (path.startsWith("analysis_runs")) return [run];
      if (path.startsWith("analysis_run_sources")) return [snapshot];
      if (path.startsWith("analysis_run_step_events")) return [stepEvent];
      if (path.startsWith("analysis_run_annotations")) return [annotation];
      if (path.startsWith("share_links")) return [share];
      return [];
    });
    const repository = createModuBrainRepository({ request });

    await expect(repository.ready()).resolves.toBe(true);
    await expect(repository.listProjects()).resolves.toEqual([project]);
    await expect(repository.listProjects({ archived: true })).resolves.toEqual([project]);
    await expect(repository.getProject(ID)).resolves.toBe(project);

    await expect(repository.listSources(ID)).resolves.toEqual([source]);
    await expect(
      repository.importSourceContext(ID, {
        kind: "note",
        title: "import",
        content: "text",
        occurredAt: null,
        provider: "paste",
        externalId: "paste:source:1",
        participants: [],
        metadata: {},
        segments: [{ externalId: "segment-1", text: "text" }],
      }),
    ).resolves.toMatchObject({ import_id: ID, provider: "paste" });
    await expect(repository.getSource(ID)).resolves.toBe(source);
    await expect(repository.getSources(ID, [ID])).resolves.toEqual([source]);
    await expect(repository.getSources(ID, [])).resolves.toEqual([]);
    await expect(repository.listSourceSegments(ID)).resolves.toEqual([segment]);

    await expect(repository.listRuns(ID)).resolves.toEqual([run]);
    await expect(repository.getRun(ID)).resolves.toBe(run);
    await expect(repository.getRunSnapshots(ID)).resolves.toEqual([snapshot]);
    await expect(repository.listRunStepEvents(ID)).resolves.toEqual([stepEvent]);
    await expect(repository.listRunAnnotations(ID)).resolves.toEqual([annotation]);
    await expect(
      repository.createRunAnnotation(ID, {
        idempotencyKey: "annotation-key",
        annotationType: "note",
        targetType: "run",
        targetId: null,
        body: "feedback",
      }),
    ).resolves.toEqual({ reused: false, annotation });

    await expect(repository.listShareLinks(ID)).resolves.toEqual([share]);
    expect(request).toHaveBeenCalledWith(
      "rpc/import_source_context",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ p_project_id: ID, p_provider: "paste" }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "rpc/create_analysis_run_annotation",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ p_analysis_run_id: ID, p_target_type: "run" }),
      }),
    );
  });

  it("uses owner-checking service-role RPCs for completion and share mutations", async () => {
    const run = { id: ID, status: "succeeded" };
    const stepEvent = { id: ID, analysis_run_id: ID, event_key: "source_snapshot:succeeded" };
    const share = { id: ID, analysis_run_id: ID };
    const request = vi.fn(async (path) => {
      if (path === "rpc/consume_openai_rate_limit") return true;
      if (path === "rpc/app_append_analysis_run_step_event") return [stepEvent];
      if (path === "rpc/app_complete_analysis_run") return run;
      if (path === "rpc/app_create_share_link") return [share];
      if (path === "rpc/app_revoke_share_link") return [share];
      return [];
    });
    const repository = createModuBrainServiceRepository({ request });
    const completedAt = new Date().toISOString();

    await expect(
      repository.appendRunStepEvent(ID, "user-id", {
        sequence: 1,
        eventKey: "source_snapshot:succeeded",
        step: "source_snapshot",
        status: "succeeded",
        code: "SNAPSHOT_READY",
        durationMs: 3,
        sourceCount: 1,
        inputCharacters: 4,
      }),
    ).resolves.toBe(stepEvent);

    await expect(
      repository.completeRun(ID, "user-id", {
        status: "succeeded",
        result_jsonb: { ok: true },
        provider_request_id: "req-safe-id",
        reasoning_tokens: 12,
        latency_ms: 5,
        completed_at: completedAt,
      }),
    ).resolves.toBe(run);
    await expect(
      repository.completeRun(ID, "user-id", {
        status: "failed",
        error_code: "FAILED",
        error_message: "safe",
        latency_ms: 6,
        completed_at: completedAt,
      }),
    ).resolves.toBe(run);
    await expect(
      repository.createShareLink(ID, "user-id", "a".repeat(64), completedAt),
    ).resolves.toBe(share);
    await expect(repository.revokeShareLink(ID, "user-id")).resolves.toBe(share);
    await expect(
      repository.consumeOpenAIRateLimit("openai:global:day", "global"),
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      "rpc/app_complete_analysis_run",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          p_user_id: "user-id",
          p_run_id: ID,
          p_provider_request_id: "req-safe-id",
          p_reasoning_tokens: 12,
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "rpc/app_append_analysis_run_step_event",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          p_user_id: "user-id",
          p_run_id: ID,
          p_event_key: "source_snapshot:succeeded",
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "rpc/app_create_share_link",
      expect.objectContaining({ method: "POST" }),
    );
    expect(request).toHaveBeenCalledWith(
      "rpc/app_revoke_share_link",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("routes project, source, and run mutations through owner-checking app RPCs", async () => {
    const project = { id: ID, title: "project" };
    const source = { id: ID, project_id: ID };
    const run = { id: ID, project_id: ID };
    const request = vi.fn(async (path) => {
      if (path === "rpc/app_delete_project") return ID;
      if (path.includes("project")) return [project];
      if (path.includes("source_record")) return [source];
      if (path === "rpc/app_start_analysis_run") {
        return [{ outcome: "created", run, retry_after_seconds: null }];
      }
      if (path === "rpc/app_delete_analysis_run") return ID;
      return [];
    });
    const repository = createModuBrainServiceRepository({ request });

    await expect(repository.createProject("user-id", { title: "p", description: "d" })).resolves.toBe(project);
    await expect(repository.updateProject("user-id", ID, { title: "u" })).resolves.toBe(project);
    await expect(repository.archiveProject("user-id", ID)).resolves.toBe(project);
    await expect(repository.restoreProject("user-id", ID)).resolves.toBe(project);
    await expect(repository.deleteProject("user-id", ID, "delete")).resolves.toBe(ID);
    await expect(repository.createSource("user-id", ID, {
      kind: "note",
      title: "source",
      content: "text",
      content_sha256: "a".repeat(64),
      char_count: 4,
      occurred_at: null,
    })).resolves.toBe(source);
    await expect(repository.updateSource("user-id", ID, { title: "updated" })).resolves.toBe(source);
    await expect(repository.archiveSource("user-id", ID)).resolves.toBe(source);
    await expect(repository.restoreSource("user-id", ID)).resolves.toBe(source);
    await expect(repository.startRun("user-id", {
      projectId: ID,
      sourceIds: [ID],
      idempotencyKey: "abcdefgh",
      requestFingerprint: "b".repeat(64),
      providerMode: "local",
      providerModel: null,
    })).resolves.toMatchObject({ outcome: "created", reused: false, run });
    await expect(repository.deleteRun(ID, "user-id")).resolves.toBe(ID);

    expect(request).toHaveBeenCalledWith(
      "rpc/app_start_analysis_run",
      expect.objectContaining({ body: expect.objectContaining({ p_user_id: "user-id", p_project_id: ID }) }),
    );
  });

  it("requests one extra projected row for keyset cursor pages", async () => {
    const project = { id: ID };
    const rows = Array.from({ length: 3 }, (_, index) => ({ id: `${ID}-${index}` }));
    const request = vi.fn(async (path) => path.startsWith("projects") ? [project] : rows);
    const repository = createModuBrainRepository({ request });

    await expect(repository.listSourcesPage(ID, { cursor: null, limit: 2 })).resolves.toEqual({
      rows: rows.slice(0, 2),
      hasMore: true,
    });
    expect(request.mock.calls.at(-1)[0]).toContain("limit=3");
    expect(request.mock.calls.at(-1)[0]).not.toContain("content,");
    expect(request.mock.calls.at(-1)[0]).not.toContain("result_jsonb");
  });

  it("builds deterministic tie-break filters for run, segment, and source cursors", async () => {
    const request = vi.fn(async (path) => path.startsWith("projects") || path.startsWith("source_records?id=") ? [{ id: ID }] : []);
    const repository = createModuBrainRepository({ request });
    const createdAt = "2026-07-11T00:00:00.000Z";

    await repository.listRunsPage(ID, { limit: 50, cursor: { createdAt, id: ID } });
    expect(request.mock.calls.at(-1)[0]).toContain(
      `or=(created_at.lt.${encodeURIComponent(createdAt)},and(created_at.eq.${encodeURIComponent(createdAt)},id.lt.${ID}))`,
    );

    await repository.listSourceSegmentsPage(ID, { limit: 50, cursor: { ordinal: 7, id: ID } });
    expect(request.mock.calls.at(-1)[0]).toContain(
      `or=(ordinal.gt.7,and(ordinal.eq.7,id.gt.${ID}))`,
    );

    await repository.listSourcesPage(ID, { limit: 50, cursor: { occurredAt: null, createdAt, id: ID } });
    expect(request.mock.calls.at(-1)[0]).toContain("occurred_at=is.null");
    expect(request.mock.calls.at(-1)[0]).toContain(`id.lt.${ID}`);

    await repository.listSourcesPage(ID, { limit: 50, cursor: { occurredAt: createdAt, createdAt, id: ID } });
    expect(request.mock.calls.at(-1)[0]).toContain("occurred_at.is.null");
    expect(request.mock.calls.at(-1)[0]).toContain(`occurred_at.lt.${encodeURIComponent(createdAt)}`);
  });

  it("uses the id tie-breaker so a same-timestamp insert does not duplicate or skip older runs", async () => {
    const createdAt = "2026-07-11T00:00:00.000Z";
    const ids = [
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000002",
    ];
    const rows = ids.map((id) => ({ id, created_at: createdAt }));
    const request = vi.fn(async (path) => {
      if (path.startsWith("projects")) return [{ id: ID }];
      if (path.includes(`id.lt.${ids[1]}`)) return [rows[2]];
      return rows;
    });
    const repository = createModuBrainRepository({ request });

    const first = await repository.listRunsPage(ID, { limit: 2, cursor: null });
    const second = await repository.listRunsPage(ID, {
      limit: 2,
      cursor: { createdAt, id: first.rows.at(-1).id },
    });

    expect([...first.rows, ...second.rows].map((row) => row.id)).toEqual(ids);
    expect(request.mock.calls.at(-1)[0]).toContain(`created_at.eq.${encodeURIComponent(createdAt)}`);
    expect(request.mock.calls.at(-1)[0]).toContain(`id.lt.${ids[1]}`);
  });

  it("turns empty owner-scoped results into a non-enumerating 404", async () => {
    const repository = createModuBrainRepository({ request: vi.fn().mockResolvedValue([]) });
    await expect(repository.getProject(ID)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(repository.getRun(ID)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("uses service-only RPCs for public share resolution and IP limits", async () => {
    const request = vi.fn(async (path) => {
      if (path === "rpc/resolve_shared_analysis") return [{ project_title: "project" }];
      return [{ app_consume_public_rate_limit: true }];
    });
    const repository = createPublicShareRepository({ request });
    await expect(repository.resolveShare("hash")).resolves.toEqual({ project_title: "project" });
    await expect(repository.consumeRateLimit("share:ip:hour", "iphash", 600, 3600)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "rpc/app_consume_public_rate_limit",
      expect.objectContaining({ body: expect.objectContaining({ p_subject_hash: "iphash" }) }),
    );
  });
});
