begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  current_setting('server_version_num')::integer >= 170000,
  'local database contract uses PostgreSQL 17 or newer'
);
select ok(to_regclass('public.projects_owner_all_idx') is not null, 'full owner FK index exists');
select ok(
  to_regclass('public.analysis_runs_created_by_all_idx') is not null,
  'full analysis creator FK index exists'
);
select ok(
  to_regclass('public.sources_project_occurred_created_cursor_idx') is not null,
  'source cursor index exists'
);
select ok(
  to_regclass('public.analysis_runs_running_started_idx') is not null,
  'stale-run cleanup index exists'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'app\_%' escape '\'
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'service role can execute every app RPC'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'app\_%' escape '\'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated role cannot execute app-server RPCs'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'app\_%' escape '\'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anonymous role cannot execute app-server RPCs'
);

select ok(
  not has_table_privilege('authenticated', 'public.projects', 'INSERT')
  and not has_table_privilege('authenticated', 'public.projects', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.projects', 'DELETE')
  and not has_table_privilege('authenticated', 'public.source_records', 'INSERT')
  and not has_table_privilege('authenticated', 'public.source_records', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.source_records', 'DELETE')
  and not has_table_privilege('authenticated', 'public.analysis_runs', 'DELETE')
  and not has_table_privilege('authenticated', 'public.context_entities', 'INSERT')
  and not has_table_privilege('authenticated', 'public.context_entities', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.context_entities', 'DELETE')
  and not has_table_privilege('authenticated', 'public.context_entity_aliases', 'INSERT')
  and not has_table_privilege('authenticated', 'public.context_entity_aliases', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.context_entity_aliases', 'DELETE')
  and not has_table_privilege('authenticated', 'public.context_edges', 'INSERT')
  and not has_table_privilege('authenticated', 'public.context_edges', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.context_edges', 'DELETE'),
  'authenticated clients cannot mutate persistence tables directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.start_analysis_run(uuid,uuid[],text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.consume_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute superseded mutation RPCs'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.import_source_context(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.create_analysis_run_annotation(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'ownership-checking compatibility RPCs remain available for one release'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  email, '', now(), '{}', '{}', now(), now()
from (values
  ('10101010-1010-4010-8010-101010101010'::uuid, 'rpc-owner@example.test'),
  ('20202020-2020-4020-8020-202020202020'::uuid, 'rate-owner@example.test'),
  ('30303030-3030-4030-8030-303030303030'::uuid, 'graph-owner@example.test'),
  ('40404040-4040-4040-8040-404040404040'::uuid, 'project-quota@example.test'),
  ('50505050-5050-4050-8050-505050505050'::uuid, 'source-row-quota@example.test'),
  ('60606060-6060-4060-8060-606060606060'::uuid, 'source-char-quota@example.test'),
  ('70707070-7070-4070-8070-707070707070'::uuid, 'run-quota@example.test'),
  ('80808080-8080-4080-8080-808080808080'::uuid, 'snapshot-quota@example.test'),
  ('90909090-9090-4090-8090-909090909090'::uuid, 'other-owner@example.test')
) users(id, email);

set local role authenticated;
set local "request.jwt.claim.sub" = '10101010-1010-4010-8010-101010101010';
set local "request.jwt.claim.role" = 'authenticated';
select throws_like(
  $$ select public.app_create_project(
    '10101010-1010-4010-8010-101010101010', 'forged', ''
  ) $$,
  '%permission denied%',
  'user tokens cannot call service-role mutation RPCs'
);

set local role service_role;
select is(
  (public.app_create_project(
    '10101010-1010-4010-8010-101010101010', 'RPC project', 'initial'
  )).title,
  'RPC project',
  'service RPC creates an owned project'
);

select throws_ok(
  $$ select public.app_update_project(
    '90909090-9090-4090-8090-909090909090',
    (select id from public.projects where title = 'RPC project'),
    '{"title":"stolen"}'::jsonb
  ) $$,
  '42501', 'insufficient_privilege',
  'project mutation RPC rechecks ownership'
);
select is(
  (public.app_update_project(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project'),
    '{"description":"updated"}'::jsonb
  )).description,
  'updated',
  'project patch RPC applies an allowlisted patch'
);

select is(
  (public.app_create_source_record(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project'),
    'meeting', 'RPC source', 'source one',
    encode(extensions.digest('source one', 'sha256'), 'hex'), 10, null
  )).title,
  'RPC source',
  'source mutation RPC creates an owned source'
);
select is(
  (public.app_update_source_record(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.source_records where title = 'RPC source'),
    '{"title":"Renamed source"}'::jsonb
  )).title,
  'Renamed source',
  'source patch RPC applies an allowlisted patch'
);

select is(
  (select outcome from public.app_start_analysis_run(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project'),
    array[(select id from public.source_records where title = 'Renamed source')],
    'rpc-start-01', repeat('a', 64), 'local'
  )),
  'created',
  'service start RPC creates a run and snapshots'
);
select is(
  (select outcome from public.app_start_analysis_run(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project'),
    array[(select id from public.source_records where title = 'Renamed source')],
    'rpc-start-01', repeat('a', 64), 'local'
  )),
  'reused',
  'service start RPC preserves idempotency'
);

select is(
  (public.app_append_analysis_run_step_event(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.analysis_runs where idempotency_key = 'rpc-start-01'),
    1::smallint, 'source_snapshot:started', 'source_snapshot', 'started'
  )).event_key,
  'source_snapshot:started',
  'step event RPC checks ownership and appends an event'
);
select is(
  (public.app_append_analysis_run_step_event(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.analysis_runs where idempotency_key = 'rpc-start-01'),
    1::smallint, 'source_snapshot:started', 'source_snapshot', 'started'
  )).id,
  (select id from public.analysis_run_step_events where event_key = 'source_snapshot:started'),
  'duplicate step event returns the immutable existing row'
);
select is(
  public.app_complete_analysis_run(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.analysis_runs where idempotency_key = 'rpc-start-01'),
    'succeeded', '{}'::jsonb, null, null, 10, 1, 1, now(),
    'resp_test-123', 2
  ) ->> 'status',
  'succeeded',
  'completion RPC persists a terminal run'
);
select is(
  (select provider_request_id from public.analysis_runs
   where idempotency_key = 'rpc-start-01'),
  'resp_test-123',
  'successful completion stores the provider request identifier'
);
select is(
  (select reasoning_tokens from public.analysis_runs
   where idempotency_key = 'rpc-start-01'),
  2,
  'successful completion stores non-negative reasoning token usage'
);
select throws_like(
  $$ update public.analysis_runs
    set provider_request_id = 'unsafe request id'
    where idempotency_key = 'rpc-start-01' $$,
  '%analysis_runs_provider_request_id_check%',
  'provider request identifiers reject unsafe characters'
);
select throws_like(
  $$ update public.analysis_runs
    set reasoning_tokens = -1
    where idempotency_key = 'rpc-start-01' $$,
  '%analysis_runs_reasoning_tokens_check%',
  'reasoning token usage rejects negative values'
);
select ok(
  (public.app_create_share_link(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.analysis_runs where idempotency_key = 'rpc-start-01'),
    repeat('d', 64), now() + interval '7 days'
  )).id is not null,
  'share mutation RPC creates a bounded share'
);
select ok(
  (
    select position('provider_request_id' in to_jsonb(shared)::text) = 0
       and position('reasoning_tokens' in to_jsonb(shared)::text) = 0
    from public.resolve_shared_analysis(repeat('d', 64)) shared
  ),
  'public share projection excludes private provider audit fields'
);
select ok(
  (public.app_revoke_share_link(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.share_links where token_hash = repeat('d', 64))
  )).revoked_at is not null,
  'share mutation RPC revokes an owned share'
);
select ok(
  public.app_delete_analysis_run(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.analysis_runs where idempotency_key = 'rpc-start-01')
  ) is not null,
  'analysis run delete RPC removes an owned run'
);
select ok(
  (public.app_archive_source_record(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.source_records where title = 'Renamed source')
  )).archived_at is not null,
  'source archive RPC performs a soft delete'
);
select ok(
  (public.app_restore_source_record(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.source_records where title = 'Renamed source')
  )).archived_at is null,
  'source restore RPC reverses an owned soft delete'
);
select ok(
  (public.app_archive_project(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project')
  )).archived_at is not null,
  'project archive RPC performs a soft delete'
);
select ok(
  (public.app_restore_project(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project')
  )).archived_at is null,
  'project restore RPC reverses an owned soft delete'
);
select throws_ok(
  $$ select public.app_restore_project(
    '90909090-9090-4090-8090-909090909090',
    (select id from public.projects where title = 'RPC project')
  ) $$,
  '42501', 'insufficient_privilege',
  'project restore RPC rechecks ownership'
);
select throws_ok(
  $$ select public.app_delete_project(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project'),
    'wrong-confirmation'
  ) $$,
  'P0001', 'DELETE_CONFIRMATION_REQUIRED',
  'project hard delete requires the exact confirmation phrase'
);
select ok(
  public.app_delete_project(
    '10101010-1010-4010-8010-101010101010',
    (select id from public.projects where title = 'RPC project'),
    'delete'
  ) is not null,
  'project hard delete cascades owned project data'
);

create temporary table public_limiter_results(
  sequence integer primary key,
  allowed boolean not null
) on commit drop;
insert into public_limiter_results(sequence, allowed)
select i, public.app_consume_public_rate_limit(
  'share:hour', repeat('c', 64), 60, 3600
)
from generate_series(1, 61) i;
select is(
  (select count(*) from public_limiter_results where allowed),
  60::bigint,
  'public limiter permits exactly the configured share-hour boundary'
);
select is(
  (select request_count from public.rate_limit_buckets
   where scope = 'share:hour' and subject_hash = repeat('c', 64)),
  61,
  'public limiter records denied attempts atomically'
);
select ok(
  public.app_consume_public_rate_limit(
    'share:ip:hour', repeat('1', 64), 600, 3600
  ),
  'public limiter accepts the NAT-tolerant per-IP share tuple'
);
select ok(
  public.app_consume_public_rate_limit(
    'share:token-ip:hour', repeat('2', 64), 60, 3600
  ),
  'public limiter accepts the narrower token-and-IP share tuple'
);
select throws_ok(
  $$ select public.app_consume_public_rate_limit(
    'share:ip:hour', repeat('1', 64), 60, 3600
  ) $$,
  'P0001', 'INVALID_RATE_LIMIT',
  'public limiter rejects a caller-weakened per-IP share tuple'
);
select throws_ok(
  $$ select public.app_consume_public_rate_limit(
    'public-analysis:hour', repeat('c', 64), 31, 3600
  ) $$,
  'P0001', 'INVALID_RATE_LIMIT',
  'public limiter rejects caller-selected limits'
);
select throws_ok(
  $$ select public.app_consume_public_rate_limit(
    'public-import:hour', 'raw-ip-address', 20, 3600
  ) $$,
  'P0001', 'INVALID_RATE_LIMIT_SUBJECT',
  'public limiter accepts only non-reversible SHA-256 subject hashes'
);

select ok(
  (public.app_create_project(
    '20202020-2020-4020-8020-202020202020', 'Rate project', ''
  )).id is not null,
  'rate-limit fixture project is created'
);
select ok(
  (public.app_create_source_record(
    '20202020-2020-4020-8020-202020202020',
    (select id from public.projects where title = 'Rate project'),
    'note', 'Rate source', 'rate',
    encode(extensions.digest('rate', 'sha256'), 'hex'), 4, null
  )).id is not null,
  'rate-limit fixture source is created'
);
create temporary table analysis_limiter_results(
  sequence integer primary key,
  outcome text not null,
  retry_after_seconds integer not null
) on commit drop;
do $rate_test$
declare
  v_i integer;
  v_outcome text;
  v_run jsonb;
  v_retry integer;
begin
  for v_i in 1..12 loop
    select response.outcome, response.run, response.retry_after_seconds
    into v_outcome, v_run, v_retry
    from public.app_start_analysis_run(
      '20202020-2020-4020-8020-202020202020',
      (select id from public.projects where title = 'Rate project'),
      array[(select id from public.source_records where title = 'Rate source')],
      'rate-run-' || lpad(v_i::text, 3, '0'), repeat('b', 64), 'local'
    ) response;
    insert into analysis_limiter_results(sequence, outcome, retry_after_seconds)
    values (v_i, v_outcome, v_retry);
    if v_outcome = 'created' then
      perform public.app_complete_analysis_run(
        '20202020-2020-4020-8020-202020202020',
        (v_run ->> 'id')::uuid,
        'succeeded', '{}'::jsonb, null, null, 1, 0, 0, now()
      );
    end if;
  end loop;
end;
$rate_test$;
select is(
  (select count(*) from analysis_limiter_results where outcome = 'created'),
  10::bigint,
  'analysis limiter permits ten hourly runs'
);
select is(
  (select count(*) from analysis_limiter_results where outcome = 'rate_limited'),
  2::bigint,
  'analysis limiter denies attempts above the hourly boundary'
);
select ok(
  (select bool_and(retry_after_seconds > 0)
   from analysis_limiter_results where outcome = 'rate_limited'),
  'analysis limiter returns a positive Retry-After value'
);
select is(
  (select request_count from public.rate_limit_buckets
   where scope = 'analysis:hour'
     and subject_hash = encode(extensions.digest(
       '20202020-2020-4020-8020-202020202020', 'sha256'
     ), 'hex')),
  12,
  'analysis limiter commits denied attempts instead of rolling them back'
);

insert into public.source_imports(
  project_id, source_record_id, provider, external_id, import_hash,
  participants, segment_count, metadata
)
select p.id, s.id, 'paste', 'rate-export',
       encode(extensions.digest('rate-export-import', 'sha256'), 'hex'),
       '["Rate owner"]'::jsonb, 1, '{"origin":"manual"}'::jsonb
from public.projects p
join public.source_records s on s.project_id = p.id
where p.title = 'Rate project' and s.title = 'Rate source';
insert into public.source_segments(
  project_id, source_record_id, ordinal, speaker, text, external_id
)
select p.id, s.id, 0, 'Rate owner', 'rate', 'rate-segment-1'
from public.projects p
join public.source_records s on s.project_id = p.id
where p.title = 'Rate project' and s.title = 'Rate source';
insert into public.context_entities(project_id, type, label, normalized_label)
select id, 'concept', 'Rate concept A', 'rate concept a'
from public.projects where title = 'Rate project';
insert into public.context_entities(project_id, type, label, normalized_label)
select id, 'concept', 'Rate concept B', 'rate concept b'
from public.projects where title = 'Rate project';
insert into public.context_entity_aliases(
  project_id, entity_id, alias, normalized_alias
)
select p.id, e.id, 'Rate alias', 'rate alias'
from public.projects p
join public.context_entities e
  on e.project_id = p.id and e.normalized_label = 'rate concept a'
where p.title = 'Rate project';
insert into public.context_edges(
  project_id, from_entity_id, to_entity_id, relation,
  source_segment_id, evidence, metadata
)
select p.id, a.id, b.id, 'supports', sg.id,
       '{"quote":"rate"}'::jsonb, '{"confidence":"fixture"}'::jsonb
from public.projects p
join public.context_entities a
  on a.project_id = p.id and a.normalized_label = 'rate concept a'
join public.context_entities b
  on b.project_id = p.id and b.normalized_label = 'rate concept b'
join public.source_segments sg on sg.project_id = p.id and sg.ordinal = 0
where p.title = 'Rate project';
select ok(
  (public.app_append_analysis_run_step_event(
    '20202020-2020-4020-8020-202020202020',
    (select id from public.analysis_runs where idempotency_key = 'rate-run-001'),
    1::smallint, 'export_fixture:started', 'source_snapshot', 'started'
  )).id is not null,
  'account export fixture includes an owned step event'
);
insert into public.analysis_run_annotations(
  analysis_run_id, created_by, idempotency_key, request_fingerprint,
  annotation_type, target_type, body
)
select r.id, r.created_by, 'export-annotation-001', repeat('4', 64),
       'note', 'run', 'Export this note.'
from public.analysis_runs r
where r.idempotency_key = 'rate-run-001';
select ok(
  (public.app_create_share_link(
    '20202020-2020-4020-8020-202020202020',
    (select id from public.analysis_runs where idempotency_key = 'rate-run-001'),
    repeat('9', 64), now() + interval '7 days'
  )).id is not null,
  'account export fixture includes share metadata'
);
insert into public.projects(owner_id, title)
values ('90909090-9090-4090-8090-909090909090', 'Foreign export project');

create temporary table account_export_fixture(payload jsonb not null) on commit drop;
insert into account_export_fixture(payload)
select public.app_export_account('20202020-2020-4020-8020-202020202020');
select is(
  (
    select array_agg(export_key order by export_key collate "C")
    from account_export_fixture e
    cross join lateral jsonb_object_keys(e.payload) keys(export_key)
  ),
  array[
    'analysis_run_sources', 'analysis_runs', 'annotations', 'context_aliases',
    'context_edges', 'context_entities', 'context_segments', 'context_sources',
    'exported_at', 'projects', 'schema_version', 'share_links',
    'source_records', 'step_events', 'user_id'
  ]::text[],
  'account export exposes only the versioned top-level allowlist'
);
select is(
  (select payload ->> 'user_id' from account_export_fixture),
  '20202020-2020-4020-8020-202020202020',
  'account export identifies the verified account scope'
);
select is(
  (select payload ->> 'schema_version' from account_export_fixture),
  '1.0',
  'account export publishes a stable schema version'
);
select ok(
  (select (payload -> 'analysis_runs' -> 0) ?&
      array['provider_request_id', 'reasoning_tokens']
   from account_export_fixture),
  'account export includes private provider audit fields in owned run history'
);
select ok(
  not exists (
    select 1
    from account_export_fixture e
    cross join lateral jsonb_each(e.payload) item(key, value)
    where item.key in (
      'projects', 'source_records', 'analysis_runs', 'analysis_run_sources',
      'step_events', 'annotations', 'share_links', 'context_sources',
      'context_segments', 'context_entities', 'context_aliases', 'context_edges'
    ) and jsonb_typeof(item.value) <> 'array'
  ),
  'every account export collection is an array, including empty collections'
);
select is(
  (select jsonb_array_length(payload -> 'projects') from account_export_fixture),
  1,
  'account export excludes projects belonging to another user'
);
select ok(
  (select position('Foreign export project' in payload::text) = 0
   from account_export_fixture),
  'account export contains no other-user project data'
);
select ok(
  (select position('"token_hash"' in payload::text) = 0
       and position(repeat('9', 64) in payload::text) = 0
   from account_export_fixture),
  'account export never exposes share token hashes or values'
);
select ok(
  (select position('"email"' in payload::text) = 0
       and position('"idempotency_key"' in payload::text) = 0
       and position('"request_fingerprint"' in payload::text) = 0
   from account_export_fixture),
  'account export leaves verified email and internal request keys to the server envelope'
);
select is(
  (
    select array_agg(link_key order by link_key collate "C")
    from account_export_fixture e
    cross join lateral jsonb_array_elements(e.payload -> 'share_links') link(value)
    cross join lateral jsonb_object_keys(link.value) keys(link_key)
  ),
  array['analysis_run_id', 'created_at', 'expires_at', 'id', 'revoked_at']::text[],
  'share export contains metadata only'
);
select ok(
  (select jsonb_array_length(payload -> 'context_sources') = 1
       and jsonb_array_length(payload -> 'context_segments') = 1
       and jsonb_array_length(payload -> 'context_entities') = 2
       and jsonb_array_length(payload -> 'context_aliases') = 1
       and jsonb_array_length(payload -> 'context_edges') = 1
   from account_export_fixture),
  'account export includes every owned context-graph collection'
);

insert into public.rate_limit_buckets(
  scope, subject_hash, bucket_start, window_seconds, request_count, updated_at
)
select
  'cleanup:test', repeat('e', 64),
  now() - interval '4 days' - i * interval '1 hour',
  3600, 1, now() - interval '4 days'
from generate_series(1, 3) i;
select is(
  public.app_cleanup_rate_limit_buckets(86400, 2),
  2,
  'rate-limit cleanup is bounded by its batch size'
);
select is(
  (select count(*) from public.rate_limit_buckets where scope = 'cleanup:test'),
  1::bigint,
  'bounded rate-limit cleanup leaves the next batch intact'
);

insert into public.projects(owner_id, title)
values ('90909090-9090-4090-8090-909090909090', 'Stale project');
insert into public.analysis_runs(
  project_id, created_by, idempotency_key, request_fingerprint,
  status, provider_mode, started_at
)
select
  p.id, p.owner_id, 'stale-run-001', repeat('f', 64),
  'running', 'local', now() - interval '10 minutes'
from public.projects p where p.title = 'Stale project';
select is(
  public.app_cleanup_stale_analysis_runs(300, 1000),
  1,
  'stale-run cleanup cancels expired leases'
);
select is(
  (select status from public.analysis_runs where idempotency_key = 'stale-run-001'),
  'cancelled',
  'stale-run cleanup persists the cancelled terminal state'
);
insert into public.analysis_run_annotations(
  analysis_run_id, created_by, idempotency_key, request_fingerprint,
  annotation_type, target_type, body
)
select r.id, r.created_by, 'quota-annotation-' || lpad(i::text, 3, '0'),
       encode(extensions.digest('quota-annotation-' || i, 'sha256'), 'hex'),
       'note', 'run', 'Bounded annotation ' || i
from public.analysis_runs r cross join generate_series(1, 200) i
where r.idempotency_key = 'stale-run-001';
select is(
  (select count(*) from public.analysis_run_annotations a
   join public.analysis_runs r on r.id = a.analysis_run_id
   where r.idempotency_key = 'stale-run-001'),
  200::bigint,
  'storage quota accepts two hundred annotations per run'
);
select throws_ok(
  $$ insert into public.analysis_run_annotations(
    analysis_run_id, created_by, idempotency_key, request_fingerprint,
    annotation_type, target_type, body
  ) select r.id, r.created_by, 'quota-annotation-overflow', repeat('a', 64),
      'note', 'run', 'Annotation overflow'
    from public.analysis_runs r
    where r.idempotency_key = 'stale-run-001' $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects the two-hundred-and-first annotation'
);
insert into public.share_links(
  analysis_run_id, created_by, token_hash, expires_at
)
select r.id, r.created_by,
       encode(extensions.digest('stale-share-' || i, 'sha256'), 'hex'),
       now() + interval '7 days'
from public.analysis_runs r cross join generate_series(1, 50) i
where r.idempotency_key = 'stale-run-001';
update public.share_links s
set revoked_at = now()
from public.analysis_runs r
where r.id = s.analysis_run_id and r.idempotency_key = 'stale-run-001';
select is(
  (select count(*) from public.share_links s
   join public.analysis_runs r on r.id = s.analysis_run_id
   where r.idempotency_key = 'stale-run-001' and s.revoked_at is not null),
  50::bigint,
  'storage quota retains fifty revoked share links in the audit boundary'
);
select throws_ok(
  $$ insert into public.share_links(
    analysis_run_id, created_by, token_hash, expires_at
  ) select r.id, r.created_by, repeat('6', 64), now() + interval '7 days'
    from public.analysis_runs r
    where r.idempotency_key = 'stale-run-001' $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects a fifty-first share even when prior links are revoked'
);

insert into public.projects(owner_id, title)
values ('30303030-3030-4030-8030-303030303030', 'Graph quota project');
insert into public.context_entities(project_id, type, label, normalized_label)
select p.id, 'concept', 'Graph A', 'graph a'
from public.projects p where p.title = 'Graph quota project';
insert into public.context_entities(project_id, type, label, normalized_label)
select p.id, 'concept', 'Graph B', 'graph b'
from public.projects p where p.title = 'Graph quota project';
select throws_like(
  $$ insert into public.context_entities(
    project_id, type, label, normalized_label, metadata
  ) select id, 'concept', 'Oversized metadata', 'oversized metadata',
      jsonb_build_object('payload', repeat('x', 17000))
    from public.projects where title = 'Graph quota project' $$,
  '%context_entities_metadata_size_check%',
  'entity metadata has a defensive JSON byte limit'
);
select throws_like(
  $$ insert into public.context_edges(
    project_id, from_entity_id, to_entity_id, relation, evidence
  ) select p.id, a.id, b.id, 'oversized_evidence',
      jsonb_build_object('payload', repeat('x', 33000))
    from public.projects p
    join public.context_entities a on a.project_id = p.id and a.normalized_label = 'graph a'
    join public.context_entities b on b.project_id = p.id and b.normalized_label = 'graph b'
    where p.title = 'Graph quota project' $$,
  '%context_edges_evidence_size_check%',
  'edge evidence has a defensive JSON byte limit'
);
select throws_like(
  $$ insert into public.context_edges(
    project_id, from_entity_id, to_entity_id, relation, metadata
  ) select p.id, a.id, b.id, 'oversized_metadata',
      jsonb_build_object('payload', repeat('x', 17000))
    from public.projects p
    join public.context_entities a on a.project_id = p.id and a.normalized_label = 'graph a'
    join public.context_entities b on b.project_id = p.id and b.normalized_label = 'graph b'
    where p.title = 'Graph quota project' $$,
  '%context_edges_metadata_size_check%',
  'edge metadata has a defensive JSON byte limit'
);
insert into public.context_entities(project_id, type, label, normalized_label)
select p.id, 'concept', 'Entity ' || i, 'entity ' || i
from public.projects p cross join generate_series(3, 500) i
where p.title = 'Graph quota project';
select is(
  (select count(*) from public.context_entities e
   join public.projects p on p.id = e.project_id
   where p.title = 'Graph quota project'),
  500::bigint,
  'graph accepts five hundred entities per project'
);
select throws_ok(
  $$ insert into public.context_entities(project_id, type, label, normalized_label)
    select id, 'concept', 'Entity overflow', 'entity overflow'
    from public.projects where title = 'Graph quota project' $$,
  'P0001', 'CONTEXT_GRAPH_QUOTA_EXCEEDED',
  'graph rejects the five-hundred-and-first entity'
);
insert into public.context_entity_aliases(
  project_id, entity_id, alias, normalized_alias
)
select p.id, e.id, 'Alias ' || i, 'alias ' || i
from public.projects p
join public.context_entities e
  on e.project_id = p.id and e.normalized_label = 'graph a'
cross join generate_series(1, 1000) i
where p.title = 'Graph quota project';
select throws_ok(
  $$ insert into public.context_entity_aliases(
    project_id, entity_id, alias, normalized_alias
  ) select p.id, e.id, 'Alias overflow', 'alias overflow'
    from public.projects p
    join public.context_entities e
      on e.project_id = p.id and e.normalized_label = 'graph a'
    where p.title = 'Graph quota project' $$,
  'P0001', 'CONTEXT_GRAPH_QUOTA_EXCEEDED',
  'graph rejects the one-thousand-and-first alias'
);
insert into public.context_edges(
  project_id, from_entity_id, to_entity_id, relation
)
select p.id, a.id, b.id, 'rel_' || lpad(i::text, 4, '0')
from public.projects p
join public.context_entities a
  on a.project_id = p.id and a.normalized_label = 'graph a'
join public.context_entities b
  on b.project_id = p.id and b.normalized_label = 'graph b'
cross join generate_series(1, 2000) i
where p.title = 'Graph quota project';
select throws_ok(
  $$ insert into public.context_edges(
    project_id, from_entity_id, to_entity_id, relation
  ) select p.id, a.id, b.id, 'rel_overflow'
    from public.projects p
    join public.context_entities a
      on a.project_id = p.id and a.normalized_label = 'graph a'
    join public.context_entities b
      on b.project_id = p.id and b.normalized_label = 'graph b'
    where p.title = 'Graph quota project' $$,
  'P0001', 'CONTEXT_GRAPH_QUOTA_EXCEEDED',
  'graph rejects the two-thousand-and-first edge'
);

insert into public.projects(owner_id, title)
select '40404040-4040-4040-8040-404040404040', 'Project quota ' || i
from generate_series(1, 25) i;
select is(
  (select count(*) from public.projects
   where owner_id = '40404040-4040-4040-8040-404040404040'),
  25::bigint,
  'storage quota accepts twenty-five projects per user'
);
select throws_ok(
  $$ insert into public.projects(owner_id, title)
    values ('40404040-4040-4040-8040-404040404040', 'Project quota overflow') $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects the twenty-sixth project'
);

insert into public.projects(owner_id, title)
values ('50505050-5050-4050-8050-505050505050', 'Source row quota');
insert into public.source_records(
  project_id, kind, title, content, content_sha256, char_count
)
select p.id, 'note', 'Source ' || i, 'x',
       encode(extensions.digest('x', 'sha256'), 'hex'), 1
from public.projects p cross join generate_series(1, 500) i
where p.title = 'Source row quota';
select throws_ok(
  $$ insert into public.source_records(
    project_id, kind, title, content, content_sha256, char_count
  ) select id, 'note', 'Source overflow', 'x',
      encode(extensions.digest('x', 'sha256'), 'hex'), 1
    from public.projects where title = 'Source row quota' $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects the five-hundred-and-first source in a project'
);

insert into public.projects(owner_id, title)
values ('60606060-6060-4060-8060-606060606060', 'Source character quota');
insert into public.source_records(
  project_id, kind, title, content, content_sha256, char_count
)
select p.id, 'note', 'Large source ' || i, repeat('x', 100000),
       encode(extensions.digest(repeat('x', 100000), 'sha256'), 'hex'), 100000
from public.projects p cross join generate_series(1, 20) i
where p.title = 'Source character quota';
select is(
  (select sum(s.char_count) from public.source_records s
   join public.projects p on p.id = s.project_id
   where p.owner_id = '60606060-6060-4060-8060-606060606060'),
  2000000::bigint,
  'storage quota accepts two million source characters per user'
);
select throws_ok(
  $$ insert into public.source_records(
    project_id, kind, title, content, content_sha256, char_count
  ) select id, 'note', 'Character overflow', 'x',
      encode(extensions.digest('x', 'sha256'), 'hex'), 1
    from public.projects where title = 'Source character quota' $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects source text above two million characters per user'
);

insert into public.projects(owner_id, title)
values ('70707070-7070-4070-8070-707070707070', 'Run quota project');
insert into public.analysis_runs(
  project_id, created_by, idempotency_key, request_fingerprint,
  status, provider_mode, error_code, completed_at
)
select p.id, p.owner_id, 'quota-run-' || lpad(i::text, 3, '0'), repeat('7', 64),
       'failed', 'local', 'FIXTURE_FAILURE', now()
from public.projects p cross join generate_series(1, 100) i
where p.title = 'Run quota project';
select throws_ok(
  $$ insert into public.analysis_runs(
    project_id, created_by, idempotency_key, request_fingerprint,
    status, provider_mode, error_code, completed_at
  ) select id, owner_id, 'quota-run-overflow', repeat('7', 64),
      'failed', 'local', 'FIXTURE_FAILURE', now()
    from public.projects where title = 'Run quota project' $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects the one-hundred-and-first run in a project'
);

insert into public.projects(owner_id, title)
values ('80808080-8080-4080-8080-808080808080', 'Snapshot quota project');
insert into public.analysis_runs(
  project_id, created_by, idempotency_key, request_fingerprint,
  status, provider_mode, error_code, completed_at
)
select p.id, p.owner_id, 'snapshot-run-' || lpad(i::text, 3, '0'), repeat('8', 64),
       'failed', 'local', 'FIXTURE_FAILURE', now()
from public.projects p cross join generate_series(1, 21) i
where p.title = 'Snapshot quota project';
insert into public.analysis_run_sources(
  analysis_run_id, source_title, source_kind,
  content_snapshot, content_sha256, char_count
)
select r.id, 'Snapshot ' || row_number() over (order by r.id), 'note',
       repeat('x', 100000),
       encode(extensions.digest(repeat('x', 100000), 'sha256'), 'hex'), 100000
from public.analysis_runs r
join public.projects p on p.id = r.project_id
where p.title = 'Snapshot quota project'
order by r.id
limit 20;
select is(
  (select sum(rs.char_count) from public.analysis_run_sources rs
   join public.analysis_runs r on r.id = rs.analysis_run_id
   where r.created_by = '80808080-8080-4080-8080-808080808080'),
  2000000::bigint,
  'storage quota accepts two million snapshot characters per user'
);
select throws_ok(
  $$ insert into public.analysis_run_sources(
    analysis_run_id, source_title, source_kind,
    content_snapshot, content_sha256, char_count
  ) select r.id, 'Snapshot overflow', 'note', 'x',
      encode(extensions.digest('x', 'sha256'), 'hex'), 1
    from public.analysis_runs r
    join public.projects p on p.id = r.project_id
    where p.title = 'Snapshot quota project'
      and not exists (
        select 1 from public.analysis_run_sources rs
        where rs.analysis_run_id = r.id
      )
    limit 1 $$,
  'P0001', 'STORAGE_QUOTA_EXCEEDED',
  'storage quota rejects snapshots above two million characters per user'
);

select * from finish();
rollback;
