-- LOCAL/EMPTY DATABASE ONLY. Production rollback uses restore or forward-fix.
begin;

drop function if exists public.import_source_context(
  uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
);

drop table if exists public.context_edges;
drop table if exists public.context_entity_aliases;
drop table if exists public.context_entities;
drop table if exists public.source_segments;
drop table if exists public.source_imports;

drop index if exists public.analysis_run_sources_source_record_idx;
drop index if exists public.share_links_created_by_idx;

alter table public.source_records
  drop constraint if exists source_records_project_id_id_key;

commit;
