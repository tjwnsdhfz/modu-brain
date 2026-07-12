-- Version 20260711191125. LOCAL/EMPTY DATABASE ONLY; production uses forward-fix.
begin;

grant insert, update, delete on table public.projects to authenticated;
grant insert, update, delete on table public.source_records to authenticated;
grant delete on table public.analysis_runs to authenticated;
grant insert, update, delete on table public.context_entities to authenticated;
grant insert, update, delete on table public.context_entity_aliases to authenticated;
grant insert, update, delete on table public.context_edges to authenticated;

grant execute on function public.start_analysis_run(
  uuid, uuid[], text, text, text, text
) to authenticated;
grant execute on function public.consume_rate_limit(
  text, text, integer, integer
) to authenticated;

commit;
