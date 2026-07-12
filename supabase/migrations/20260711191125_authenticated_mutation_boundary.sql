-- Contract phase applied after Sites and Render were verified on the app_*
-- service-role RPCs introduced by 20260711185902_operations_hardening_expand.
-- Authenticated reads and the two ownership-checking compatibility RPCs remain.

begin;

do $$
begin
  if to_regprocedure('public.app_create_project(uuid,text,text)') is null
     or to_regprocedure('public.app_update_project(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.app_archive_project(uuid,uuid)') is null
     or to_regprocedure('public.app_delete_project(uuid,uuid,text)') is null
     or to_regprocedure(
       'public.app_create_source_record(uuid,uuid,text,text,text,text,integer,timestamptz)'
     ) is null
     or to_regprocedure('public.app_update_source_record(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.app_archive_source_record(uuid,uuid)') is null
     or to_regprocedure(
       'public.app_start_analysis_run(uuid,uuid,uuid[],text,text,text,text)'
     ) is null
     or to_regprocedure('public.app_delete_analysis_run(uuid,uuid)') is null then
    raise exception 'APP_MUTATION_EXPAND_NOT_READY';
  end if;
end;
$$;

revoke insert, update, delete on table public.projects from authenticated;
revoke insert, update, delete on table public.source_records from authenticated;
revoke delete on table public.analysis_runs from authenticated;
revoke insert, update, delete on table public.context_entities from authenticated;
revoke insert, update, delete on table public.context_entity_aliases from authenticated;
revoke insert, update, delete on table public.context_edges from authenticated;

revoke execute on function public.start_analysis_run(
  uuid, uuid[], text, text, text, text
) from authenticated;
revoke execute on function public.consume_rate_limit(
  text, text, integer, integer
) from authenticated;

-- import_source_context and create_analysis_run_annotation remain authenticated
-- compatibility RPCs. Both validate auth.uid(), ownership, shape, size and
-- idempotency inside the database, and all inserted rows are quota-triggered.

commit;
