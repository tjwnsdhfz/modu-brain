-- LOCAL/EMPTY DATABASE ONLY. Production rollback uses restore or forward-fix.
begin;

drop index if exists public.context_edges_project_segment_idx;
drop index if exists public.context_aliases_project_entity_idx;
drop index if exists public.source_imports_project_source_idx;

create index if not exists context_aliases_entity_idx
  on public.context_entity_aliases(entity_id);
create index if not exists context_edges_segment_idx
  on public.context_edges(source_segment_id)
  where source_segment_id is not null;

commit;
