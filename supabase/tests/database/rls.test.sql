begin;
create extension if not exists pgtap with schema extensions;
select plan(92);

select has_table('public', 'projects', 'projects table exists');
select table_privs_are(
  'public', 'analysis_runs', 'authenticated', array['SELECT'],
  'authenticated analysis-run access is read-only after the mutation-boundary contract'
);
select has_table('public', 'source_imports', 'source imports table exists');
select has_table('public', 'source_segments', 'source segments table exists');
select has_table('public', 'context_entities', 'context entities table exists');
select has_table('public', 'context_entity_aliases', 'context entity aliases table exists');
select has_table('public', 'context_edges', 'context edges table exists');
select has_table('public', 'analysis_run_step_events', 'analysis step events table exists');
select has_table('public', 'analysis_run_annotations', 'analysis annotations table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'projects RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.source_records'::regclass), 'sources RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.source_imports'::regclass), 'source imports RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.source_segments'::regclass), 'source segments RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.context_entities'::regclass), 'context entities RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.context_entity_aliases'::regclass), 'context aliases RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.context_edges'::regclass), 'context edges RLS enabled');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.analysis_run_step_events'::regclass),
  'analysis step events RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.analysis_run_annotations'::regclass),
  'analysis annotations RLS enabled'
);
select function_privs_are(
  'public', 'resolve_shared_analysis', array['text'], 'anon', array[]::text[],
  'anonymous users cannot resolve token hashes directly'
);
select function_privs_are(
  'public', 'start_analysis_run', array['uuid','uuid[]','text','text','text','text'],
  'authenticated', array[]::text[], 'authenticated users cannot execute the legacy analysis RPC'
);
select function_privs_are(
  'public', 'import_source_context',
  array['uuid','text','text','text','text','text','timestamptz','jsonb','jsonb','jsonb'],
  'authenticated', array['EXECUTE'], 'authenticated users can atomically import owned context'
);
select function_privs_are(
  'public', 'import_source_context',
  array['uuid','text','text','text','text','text','timestamptz','jsonb','jsonb','jsonb'],
  'anon', array[]::text[], 'anonymous users cannot import source context'
);
select function_privs_are(
  'public', 'consume_rate_limit', array['text','text','integer','integer'],
  'authenticated', array[]::text[], 'authenticated users cannot execute the legacy rate-limit RPC'
);
select function_privs_are(
  'public', 'create_analysis_run_annotation',
  array['uuid','text','text','text','text','text'],
  'authenticated', array['EXECUTE'], 'authenticated owners can create immutable feedback'
);
select function_privs_are(
  'public', 'create_analysis_run_annotation',
  array['uuid','text','text','text','text','text'],
  'anon', array[]::text[], 'anonymous users cannot create analysis feedback'
);
select function_privs_are(
  'public', 'prevent_analysis_artifact_update', array[]::text[],
  'authenticated', array[]::text[], 'analysis immutability trigger is not client executable'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999',
   'authenticated', 'authenticated', 'other@example.test', '', now(), '{}', '{}', now(), now());

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

select table_privs_are(
  'public', 'projects', 'authenticated', array['SELECT'],
  'authenticated project access is read-only after the mutation-boundary contract'
);

set local role service_role;
insert into public.projects(id, owner_id, title)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Owner project'
);
insert into public.source_records(
  id, project_id, kind, title, content, content_sha256, char_count
) values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'meeting', 'Owner source', 'source one',
  encode(extensions.digest('source one', 'sha256'), 'hex'), 10
);
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

select is(
  (select count(*) from public.projects where id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'owner can read own project'
);
select table_privs_are(
  'public', 'source_records', 'authenticated', array['SELECT'],
  'authenticated source access is read-only after the mutation-boundary contract'
);
set local role service_role;
insert into public.source_records(
  id, project_id, kind, title, content, content_sha256, char_count
) values (
  '88888888-8888-4888-8888-888888888888',
  '22222222-2222-4222-8222-222222222222',
  'note', 'Emoji source', '😀', encode(extensions.digest('😀', 'sha256'), 'hex'), 1
);
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
select is(
  (select char_count from public.source_records where id = '88888888-8888-4888-8888-888888888888'),
  1,
  'stored emoji char_count matches the API code-point metric'
);

select is(
  (select duplicate from public.import_source_context(
    '22222222-2222-4222-8222-222222222222',
    'meeting',
    'Imported meeting',
    'Alice decided launch. Bob owns follow-up.',
    'kakaotalk',
    'chat-room-1',
    '2026-07-11T09:00:00Z',
    '["Alice","Bob"]'::jsonb,
    '{"source":"manual-export"}'::jsonb,
    '[
      {"speaker":"Alice","text":"Alice decided launch.","occurredAt":"2026-07-11T09:00:00Z","externalId":"m1","sourceUrl":"https://example.test/messages/1"},
      {"speaker":"Bob","text":"Bob owns follow-up.","occurredAt":"2026-07-11T09:01:00Z","externalId":"m2","sourceUrl":"https://example.test/messages/2"}
    ]'::jsonb
  )),
  false,
  'first context import atomically creates source, provenance, and segments'
);
select is(
  (
    select array_agg(response_key order by response_key collate "C")
    from public.import_source_context(
      '22222222-2222-4222-8222-222222222222',
      'meeting', 'Imported meeting',
      'Alice decided launch. Bob owns follow-up.', 'kakaotalk', 'chat-room-1'
    ) response
    cross join lateral jsonb_object_keys(to_jsonb(response)) response_keys(response_key)
  ),
  array[
    'duplicate', 'import_id', 'imported_at', 'metadata', 'participants',
    'provider', 'segment_count', 'source'
  ]::text[],
  'import RPC response exposes the stable repository contract'
);
select is(
  (select segment_count from public.source_imports where provider = 'kakaotalk'),
  2,
  'provenance records the normalized segment count'
);
select is(
  (
    select string_agg(s.text, '|' order by s.ordinal)
    from public.source_segments s
    join public.source_imports i on i.source_record_id = s.source_record_id
    where i.provider = 'kakaotalk'
  ),
  'Alice decided launch.|Bob owns follow-up.',
  'segments preserve their source order'
);
select is(
  (select duplicate from public.import_source_context(
    '22222222-2222-4222-8222-222222222222',
    'meeting', 'A renamed duplicate',
    'Alice decided launch. Bob owns follow-up.', 'kakaotalk', 'chat-room-1'
  )),
  true,
  'same project, provider, external source, and content reuses the existing import'
);
select is(
  (select count(*) from public.source_imports where provider = 'kakaotalk'),
  1::bigint,
  'idempotent context import does not duplicate provenance rows'
);
select ok(
  (
    select
      i.import_hash = encode(extensions.digest(
        convert_to(btrim(i.external_id), 'UTF8')
          || decode('00', 'hex')
          || convert_to(s.content, 'UTF8'),
        'sha256'
      ), 'hex')
      and s.content_sha256 = encode(extensions.digest(s.content, 'sha256'), 'hex')
    from public.source_imports i
    join public.source_records s on s.id = i.source_record_id
    where i.provider = 'kakaotalk' and i.external_id = 'chat-room-1'
  ),
  'database separates external import identity from the canonical content hash'
);
set local role service_role;
select throws_ok($$
  update public.source_records
  set content = 'tampered',
      content_sha256 = encode(extensions.digest('tampered', 'sha256'), 'hex'),
      char_count = 8
  where id = (
    select source_record_id from public.source_imports
    where provider = 'kakaotalk' and external_id = 'chat-room-1'
  )
$$, '23514', 'IMPORTED_SOURCE_IMMUTABLE', 'imported source content is immutable');
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
select throws_like($$
  insert into public.source_segments(project_id, source_record_id, ordinal, text)
  select project_id, id, 99, 'forged segment'
  from public.source_records where title = 'Imported meeting'
$$, '%permission denied%', 'authenticated users cannot forge immutable source segments directly');
select throws_ok($$
  select * from public.import_source_context(
    p_project_id => '22222222-2222-4222-8222-222222222222',
    p_kind => 'note',
    p_title => 'Credential leak',
    p_content => 'must not persist',
    p_provider => 'paste',
    p_metadata => '{"access_token":"secret"}'::jsonb
  )
$$, 'P0001', 'INVALID_IMPORT_METADATA', 'import metadata rejects OAuth credentials');
select throws_ok($$
  select * from public.import_source_context(
    p_project_id => '22222222-2222-4222-8222-222222222222',
    p_kind => 'note',
    p_title => 'Invalid participants',
    p_content => 'participant objects are rejected',
    p_provider => 'paste',
    p_participants => '[{"displayName":"Alice"}]'::jsonb
  )
$$, 'P0001', 'INVALID_PARTICIPANTS', 'participant values must be non-empty display-name strings');

select is(
  (select duplicate from public.import_source_context(
    '22222222-2222-4222-8222-222222222222',
    'meeting', 'Same text in another chat',
    'Alice decided launch. Bob owns follow-up.', 'kakaotalk', 'chat-room-2'
  )),
  false,
  'identical text from another external source creates a distinct import'
);
select is(
  (select count(*) from public.source_imports where provider = 'kakaotalk'),
  2::bigint,
  'external identifiers prevent cross-chat content conflation'
);

set local role service_role;
update public.source_records
set archived_at = now()
where id = (
  select source_record_id from public.source_imports
  where provider = 'kakaotalk' and external_id = 'chat-room-1'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
select ok(
  (select
    duplicate
    and source ->> 'archived_at' is null
    and source ->> 'title' = 'Restored imported meeting'
  from public.import_source_context(
    '22222222-2222-4222-8222-222222222222',
    'meeting', 'Restored imported meeting',
    'Alice decided launch. Bob owns follow-up.', 'kakaotalk', 'chat-room-1'
  )),
  'reimport atomically restores an archived duplicate and refreshes its title'
);

select table_privs_are(
  'public', 'context_entities', 'authenticated', array['SELECT'],
  'authenticated context-entity access is read-only after the mutation-boundary contract'
);
set local role service_role;
insert into public.context_entities(id, project_id, type, label, normalized_label)
values
  ('44444444-4444-4444-8444-444444444441', '22222222-2222-4222-8222-222222222222', 'person', 'Alice', 'alice'),
  ('44444444-4444-4444-8444-444444444442', '22222222-2222-4222-8222-222222222222', 'decision', 'Launch', 'launch');
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

select table_privs_are(
  'public', 'context_entity_aliases', 'authenticated', array['SELECT'],
  'authenticated context-alias access is read-only after the mutation-boundary contract'
);
set local role service_role;
insert into public.context_entity_aliases(
  id, project_id, entity_id, alias, normalized_alias
) values (
  '44444444-4444-4444-8444-444444444443',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444441',
  'A. Kim', 'a. kim'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

select table_privs_are(
  'public', 'context_edges', 'authenticated', array['SELECT'],
  'authenticated context-edge access is read-only after the mutation-boundary contract'
);
set local role service_role;
insert into public.context_edges(
  id, project_id, from_entity_id, to_entity_id, relation,
  source_segment_id, evidence
)
select
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444441',
  '44444444-4444-4444-8444-444444444442',
  'decided', s.id, jsonb_build_object('quote', s.text)
from public.source_segments s
join public.source_imports i on i.source_record_id = s.source_record_id
where i.provider = 'kakaotalk' and i.external_id = 'chat-room-1' and s.ordinal = 0;
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
select is(
  (select count(*) from public.context_edges where project_id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'owner can read the project context graph'
);

set local "request.jwt.claim.sub" = '99999999-9999-4999-8999-999999999999';
select is(
  (select count(*) from public.projects where id = '22222222-2222-4222-8222-222222222222'),
  0::bigint,
  'another user cannot read project'
);
select is(
  (select count(*) from public.source_records where id = '33333333-3333-4333-8333-333333333333'),
  0::bigint,
  'another user cannot read source'
);
select is((select count(*) from public.source_imports), 0::bigint, 'another user cannot read import provenance');
select is((select count(*) from public.source_segments), 0::bigint, 'another user cannot read source segments');
select is((select count(*) from public.context_entities), 0::bigint, 'another user cannot read context entities');
select is((select count(*) from public.context_entity_aliases), 0::bigint, 'another user cannot read entity aliases');
select is((select count(*) from public.context_edges), 0::bigint, 'another user cannot read context edges');
select throws_ok($$
  select * from public.import_source_context(
    '22222222-2222-4222-8222-222222222222',
    'note', 'Stolen import', 'must not persist', 'paste'
  )
$$, '42501', 'insufficient_privilege', 'another user cannot import context into the owner project');
set local role service_role;
select throws_ok($$
  select public.app_update_project(
    '99999999-9999-4999-8999-999999999999',
    '22222222-2222-4222-8222-222222222222',
    '{"title":"stolen"}'::jsonb
  )
$$, '42501', 'insufficient_privilege', 'service-role mutation RPC enforces the supplied user ownership boundary');
set local role authenticated;
set local "request.jwt.claim.sub" = '99999999-9999-4999-8999-999999999999';
set local "request.jwt.claim.role" = 'authenticated';

set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role service_role;
select is(
  (select outcome from public.app_start_analysis_run(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    array['33333333-3333-4333-8333-333333333333'::uuid],
    'idempotency-key', repeat('b', 64), 'local', null
  )),
  'created',
  'first request atomically creates run and snapshots'
);
select is(
  (select outcome from public.app_start_analysis_run(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    array['33333333-3333-4333-8333-333333333333'::uuid],
    'idempotency-key', repeat('b', 64), 'local', null
  )),
  'reused',
  'same key and fingerprint reuses the run'
);
select throws_ok($$
  select * from public.app_start_analysis_run(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    array['33333333-3333-4333-8333-333333333333'::uuid],
    'idempotency-key', repeat('c', 64), 'local', null
  )
$$, 'P0001', 'IDEMPOTENCY_CONFLICT', 'same key with different semantic input is rejected');
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
select is((select count(*) from public.analysis_run_sources), 1::bigint, 'reuse does not duplicate snapshots');

select throws_like($$
  insert into public.analysis_runs(
    project_id, created_by, idempotency_key, request_fingerprint, status, provider_mode
  ) values (
    '22222222-2222-4222-8222-222222222222', auth.uid(), 'direct-run', repeat('a',64), 'running', 'local'
  )
$$, '%permission denied%', 'authenticated users cannot insert analysis runs directly');
select throws_like($$
  update public.analysis_runs set result_jsonb = '{"forged":true}'::jsonb
$$, '%permission denied%', 'authenticated users cannot update analysis results directly');
select throws_like($$
  insert into public.analysis_run_sources(
    analysis_run_id, source_record_id, source_title, source_kind, content_snapshot, content_sha256, char_count
  ) select id, '33333333-3333-4333-8333-333333333333', 'forged', 'meeting', 'x',
      encode(extensions.digest('x','sha256'),'hex'), 1 from public.analysis_runs limit 1
$$, '%permission denied%', 'authenticated users cannot insert immutable snapshots directly');
select throws_like($$
  insert into public.share_links(analysis_run_id, created_by, token_hash, expires_at)
  select id, auth.uid(), repeat('a',64), now() + interval '7 days' from public.analysis_runs limit 1
$$, '%permission denied%', 'authenticated users cannot insert share links directly');

set local role service_role;
select lives_ok($$
  update public.analysis_runs
  set status = 'succeeded',
      result_jsonb = '{"provider":{"model":"private"},"decisions":[{"id":"decision_public","evidence":[{"sourceRecordId":"33333333-3333-4333-8333-333333333333","sourceTitle":"Owner source","quote":"source one"}]}]}'::jsonb,
      completed_at = now()
  where project_id = '22222222-2222-4222-8222-222222222222'
$$, 'service role can complete an owned running analysis');

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
select is(
  (select outcome from public.create_analysis_run_annotation(
    (select id from public.analysis_runs where idempotency_key = 'idempotency-key'),
    'annotation-key-1', 'correction', 'decision', 'decision_public',
    'Confirm the source evidence for this decision.'
  )),
  'created',
  'owner can create immutable feedback for a succeeded result item'
);
select is(
  (select outcome from public.create_analysis_run_annotation(
    (select id from public.analysis_runs where idempotency_key = 'idempotency-key'),
    'annotation-key-1', 'correction', 'decision', 'decision_public',
    'Confirm the source evidence for this decision.'
  )),
  'reused',
  'same annotation idempotency key and payload reuses the immutable record'
);
select throws_ok($$
  select * from public.create_analysis_run_annotation(
    (select id from public.analysis_runs where idempotency_key = 'idempotency-key'),
    'annotation-key-1', 'correction', 'decision', 'decision_public',
    'A different body under the same key.'
  )
$$, 'P0001', 'IDEMPOTENCY_CONFLICT', 'annotation idempotency conflicts are rejected');
select is(
  (select count(*) from public.analysis_run_annotations),
  1::bigint,
  'idempotent annotation creation stores exactly one row'
);
select throws_ok($$
  select * from public.create_analysis_run_annotation(
    (select id from public.analysis_runs where idempotency_key = 'idempotency-key'),
    'annotation-key-2', 'note', 'decision', 'decision_missing', 'Missing target.'
  )
$$, 'P0001', 'ANNOTATION_TARGET_NOT_FOUND', 'annotation targets must exist in the run result');
select throws_like($$
  insert into public.analysis_run_annotations(
    analysis_run_id, created_by, idempotency_key, request_fingerprint,
    annotation_type, target_type, body
  ) select id, auth.uid(), 'direct-annotation', repeat('a', 64), 'note', 'run', 'forged'
    from public.analysis_runs where idempotency_key = 'idempotency-key'
$$, '%permission denied%', 'authenticated users cannot bypass the annotation RPC');
select throws_like($$
  insert into public.analysis_run_step_events(
    analysis_run_id, sequence, event_key, step_name, status, code
  ) select id, 1, 'source_snapshot:succeeded', 'source_snapshot', 'succeeded', 'FORGED'
    from public.analysis_runs where idempotency_key = 'idempotency-key'
$$, '%permission denied%', 'authenticated users cannot forge workflow events');

set local role service_role;
select lives_ok($$
  insert into public.analysis_run_step_events(
    analysis_run_id, sequence, event_key, step_name, status
  ) select id, 1, 'source_snapshot:started', 'source_snapshot', 'started'
    from public.analysis_runs where idempotency_key = 'idempotency-key'
$$, 'service role can append a bounded workflow start event');
select lives_ok($$
  insert into public.analysis_run_step_events(
    analysis_run_id, sequence, event_key, step_name, status, code,
    duration_ms, source_count, input_characters
  ) select id, 2, 'source_snapshot:succeeded', 'source_snapshot', 'succeeded',
      'SNAPSHOT_READY', 5, 1, 10
    from public.analysis_runs where idempotency_key = 'idempotency-key'
$$, 'service role can append safe step metrics without source content');
select throws_ok($$
  update public.analysis_run_step_events set duration_ms = 999
$$, '23514', 'ANALYSIS_ARTIFACT_IMMUTABLE', 'workflow events cannot be edited');
select throws_ok($$
  update public.analysis_run_annotations set body = 'rewritten'
$$, '23514', 'ANALYSIS_ARTIFACT_IMMUTABLE', 'feedback annotations cannot be edited');

insert into public.projects(id, owner_id, title)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999', 'Other project');
insert into public.analysis_runs(
  id, project_id, created_by, idempotency_key, request_fingerprint, status,
  provider_mode, result_jsonb, completed_at
) values (
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '99999999-9999-4999-8999-999999999999',
  'other-success', repeat('9',64), 'succeeded', 'local', '{"ok":true}'::jsonb, now()
);

insert into public.share_links(
  id, analysis_run_id, created_by, token_hash, created_at, expires_at, revoked_at
)
select '55555555-5555-4555-8555-555555555555', id,
  '11111111-1111-4111-8111-111111111111', repeat('d', 64), now(), now() + interval '7 days', null
from public.analysis_runs where idempotency_key = 'idempotency-key';
insert into public.share_links(
  id, analysis_run_id, created_by, token_hash, created_at, expires_at, revoked_at
)
select '66666666-6666-4666-8666-666666666666', id,
  '11111111-1111-4111-8111-111111111111', repeat('e', 64), now(), now() + interval '7 days', now()
from public.analysis_runs where idempotency_key = 'idempotency-key';
insert into public.share_links(
  id, analysis_run_id, created_by, token_hash, created_at, expires_at, revoked_at
)
select '77777777-7777-4777-8777-777777777777', id,
  '11111111-1111-4111-8111-111111111111', repeat('f', 64), now() - interval '2 days', now() - interval '1 day', null
from public.analysis_runs where idempotency_key = 'idempotency-key';

select is((select count(*) from public.resolve_shared_analysis(repeat('d', 64))), 1::bigint, 'active share resolves');
select is((select count(*) from public.resolve_shared_analysis(repeat('e', 64))), 0::bigint, 'revoked share does not resolve');
select is((select count(*) from public.resolve_shared_analysis(repeat('f', 64))), 0::bigint, 'expired share does not resolve');
select ok(
  (select not (result_jsonb ? 'provider')
      and position('sourceRecordId' in result_jsonb::text) = 0
      and position('33333333-3333-4333-8333-333333333333' in result_jsonb::text) = 0
   from public.resolve_shared_analysis(repeat('d', 64))),
  'shared projection strips provider and source identifiers recursively'
);

insert into public.analysis_runs(
  id, project_id, created_by, idempotency_key, request_fingerprint, status,
  provider_mode, started_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'stale-running', repeat('8',64), 'running', 'local', now() - interval '6 minutes'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
select is(
  (select count(*) from public.analysis_run_step_events),
  2::bigint,
  'owner can read safe workflow events for an owned run'
);
select is(
  (select count(*) from public.analysis_run_annotations),
  1::bigint,
  'owner can read immutable feedback for an owned run'
);
select throws_like($$
  update public.share_links
  set analysis_run_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  where id = '55555555-5555-4555-8555-555555555555'
$$, '%permission denied%', 'owner cannot retarget a share to another user run');
select throws_like($$
  update public.share_links set revoked_at = now()
  where id = '55555555-5555-4555-8555-555555555555'
$$, '%permission denied%', 'authenticated users cannot revoke shares directly');
set local role service_role;
select is(
  (select outcome from public.app_start_analysis_run(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    array['33333333-3333-4333-8333-333333333333'::uuid],
    'fresh-after-stale', repeat('7',64), 'local', null
  )),
  'created',
  'a stale running lease no longer blocks a new analysis'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';
select is(
  (select status from public.analysis_runs where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'cancelled',
  'stale running lease is terminally cancelled'
);

set local "request.jwt.claim.sub" = '99999999-9999-4999-8999-999999999999';
select is((select count(*) from public.analysis_runs where created_by <> auth.uid()), 0::bigint, 'another user cannot read owner runs');
select is((select count(*) from public.share_links), 0::bigint, 'another user cannot read owner share links');
select is(
  (select count(*) from public.analysis_run_step_events),
  0::bigint,
  'another user cannot read owner workflow events'
);
select is(
  (select count(*) from public.analysis_run_annotations),
  0::bigint,
  'another user cannot read owner annotations'
);
select throws_ok($$
  select * from public.create_analysis_run_annotation(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cross-user-annotation', 'note', 'run', null, 'forbidden'
  )
$$, '42501', 'insufficient_privilege', 'another user cannot annotate an owner run');

select * from finish(true);
rollback;
