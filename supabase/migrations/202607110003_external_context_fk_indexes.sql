drop index if exists public.context_aliases_entity_idx;
drop index if exists public.context_edges_segment_idx;

create index if not exists source_imports_project_source_idx
  on public.source_imports(project_id, source_record_id);
create index if not exists context_aliases_project_entity_idx
  on public.context_entity_aliases(project_id, entity_id);
create index if not exists context_edges_project_segment_idx
  on public.context_edges(project_id, source_segment_id)
  where source_segment_id is not null;
