-- Read-only production check. It never repairs migration history.
-- Compare this output with the filenames under supabase/migrations before any
-- future db push. Repair requires a reviewed backup and explicit approval.

select current_database() as database_name,
       current_setting('server_version') as server_version,
       current_setting('server_version_num') as server_version_num;

select version, name
from supabase_migrations.schema_migrations
order by version;

with expected(version, name) as (
  values
    ('202607110001', 'modu_brain_core'),
    ('202607110002', 'external_context_graph'),
    ('202607110003', 'external_context_fk_indexes'),
    ('202607110004', 'external_context_import_hardening'),
    ('20260711113201', 'analysis_workflow_events_and_annotations'),
    ('20260711185902', 'operations_hardening_expand'),
    ('20260711191125', 'authenticated_mutation_boundary')
)
select e.version,
       e.name as expected_name,
       m.name as recorded_name,
       (m.version is not null) as recorded
from expected e
left join supabase_migrations.schema_migrations m using (version)
order by e.version;

with expected(version) as (
  values
    ('202607110001'),
    ('202607110002'),
    ('202607110003'),
    ('202607110004'),
    ('20260711113201'),
    ('20260711185902'),
    ('20260711191125')
)
select m.version as unexpected_version, m.name as unexpected_name
from supabase_migrations.schema_migrations m
where not exists (select 1 from expected e where e.version = m.version)
order by m.version;

select p.oid::regprocedure::text as service_rpc,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app\_%' escape '\'
order by service_rpc;

with forbidden(table_name, privilege_name) as (
  values
    ('projects', 'INSERT'), ('projects', 'UPDATE'), ('projects', 'DELETE'),
    ('source_records', 'INSERT'), ('source_records', 'UPDATE'),
    ('source_records', 'DELETE'), ('analysis_runs', 'DELETE'),
    ('context_entities', 'INSERT'), ('context_entities', 'UPDATE'),
    ('context_entities', 'DELETE'), ('context_entity_aliases', 'INSERT'),
    ('context_entity_aliases', 'UPDATE'), ('context_entity_aliases', 'DELETE'),
    ('context_edges', 'INSERT'), ('context_edges', 'UPDATE'),
    ('context_edges', 'DELETE')
)
select table_name, privilege_name
from forbidden
where has_table_privilege(
  'authenticated', format('public.%I', table_name), privilege_name
)
order by table_name, privilege_name;

select
  has_function_privilege(
    'authenticated',
    'public.start_analysis_run(uuid,uuid[],text,text,text,text)',
    'EXECUTE'
  ) as legacy_start_analysis_executable,
  has_function_privilege(
    'authenticated',
    'public.consume_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ) as legacy_rate_limit_executable,
  has_function_privilege(
    'authenticated',
    'public.import_source_context(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) as compatibility_import_executable,
  has_function_privilege(
    'authenticated',
    'public.create_analysis_run_annotation(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) as compatibility_annotation_executable;
