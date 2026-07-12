-- Contract phase. Apply only after every deployed runtime uses the app_* RPCs.

begin;

do $$
begin
  if pg_catalog.to_regprocedure(
       'public.app_import_source_context(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.app_create_analysis_run_annotation(uuid,uuid,text,text,text,text,text)'
     ) is null then
    raise exception 'APP_IMPORT_ANNOTATION_EXPAND_NOT_READY';
  end if;
end;
$$;

revoke execute on function public.import_source_context(
  uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke execute on function public.create_analysis_run_annotation(
  uuid, text, text, text, text, text
) from public, anon, authenticated;

commit;
