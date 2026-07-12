begin;

revoke all on function public.import_source_context(
  uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.import_source_context(
  uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) to authenticated;

revoke all on function public.create_analysis_run_annotation(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_analysis_run_annotation(
  uuid, text, text, text, text, text
) to authenticated;

commit;
