-- Version 20260711185902. LOCAL/EMPTY DATABASE ONLY; production uses forward-fix.
begin;

drop trigger if exists context_edges_enforce_quota on public.context_edges;
drop trigger if exists context_aliases_enforce_quota on public.context_entity_aliases;
drop trigger if exists context_entities_enforce_quota on public.context_entities;
drop trigger if exists snapshots_enforce_storage_quota on public.analysis_run_sources;
drop trigger if exists annotations_enforce_storage_quota on public.analysis_run_annotations;
drop trigger if exists share_links_enforce_storage_quota on public.share_links;
drop trigger if exists analysis_runs_enforce_storage_quota on public.analysis_runs;
drop trigger if exists sources_enforce_storage_quota on public.source_records;
drop trigger if exists projects_enforce_storage_quota on public.projects;

drop function if exists public.app_cleanup_stale_analysis_runs(integer, integer);
drop function if exists public.app_cleanup_rate_limit_buckets(integer, integer);
drop function if exists public.app_export_account(uuid);
drop function if exists public.app_revoke_share_link(uuid, uuid);
drop function if exists public.app_create_share_link(uuid, uuid, text, timestamptz);
drop function if exists public.app_append_analysis_run_step_event(
  uuid, uuid, smallint, text, text, text, text, text, integer, smallint,
  integer, integer, integer
);
drop function if exists public.app_delete_analysis_run(uuid, uuid);
drop function if exists public.app_complete_analysis_run(
  uuid, uuid, text, jsonb, text, text, integer, integer, integer, timestamptz,
  text, integer
);
drop function if exists public.app_start_analysis_run(
  uuid, uuid, uuid[], text, text, text, text
);
drop function if exists public.app_restore_source_record(uuid, uuid);
drop function if exists public.app_archive_source_record(uuid, uuid);
drop function if exists public.app_update_source_record(uuid, uuid, jsonb);
drop function if exists public.app_create_source_record(
  uuid, uuid, text, text, text, text, integer, timestamptz
);
drop function if exists public.app_delete_project(uuid, uuid, text);
drop function if exists public.app_restore_project(uuid, uuid);
drop function if exists public.app_archive_project(uuid, uuid);
drop function if exists public.app_update_project(uuid, uuid, jsonb);
drop function if exists public.app_create_project(uuid, text, text);
drop function if exists public.app_consume_public_rate_limit(text, text, integer, integer);
drop function if exists public.enforce_storage_quota();
drop function if exists public.enforce_context_graph_quota();

alter table public.analysis_runs
  drop constraint if exists analysis_runs_reasoning_tokens_check,
  drop constraint if exists analysis_runs_provider_request_id_check,
  drop column if exists reasoning_tokens,
  drop column if exists provider_request_id;

alter table public.context_edges
  drop constraint if exists context_edges_metadata_size_check;
alter table public.context_edges
  drop constraint if exists context_edges_evidence_size_check;
alter table public.context_entities
  drop constraint if exists context_entities_metadata_size_check;

drop index if exists public.analysis_runs_running_started_idx;
drop index if exists public.sources_project_occurred_created_cursor_idx;
drop index if exists public.analysis_runs_created_by_all_idx;
drop index if exists public.projects_owner_all_idx;

commit;
