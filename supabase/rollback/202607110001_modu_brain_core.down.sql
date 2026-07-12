-- LOCAL/EMPTY DATABASE ONLY. Production rollback uses restore or forward-fix.
begin;

drop function if exists public.resolve_shared_analysis(text);
drop function if exists public.sanitize_shared_result(jsonb);
drop function if exists public.start_analysis_run(uuid, uuid[], text, text, text, text);
drop function if exists public.consume_openai_rate_limit(text, text);
drop function if exists public.consume_public_rate_limit(text, text, integer, integer);
drop function if exists public.consume_rate_limit(text, text, integer, integer);

drop table if exists public.share_links;
drop table if exists public.analysis_run_sources;
drop table if exists public.analysis_runs;
drop table if exists public.source_records;
drop table if exists public.projects;
drop table if exists public.rate_limit_buckets;

drop function if exists public.set_updated_at();

commit;
