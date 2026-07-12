create extension if not exists pgcrypto with schema extensions;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title varchar(120) not null check (char_length(btrim(title)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('meeting', 'research', 'feedback', 'note')),
  title varchar(120) not null check (char_length(btrim(title)) between 1 and 120),
  content text not null check (char_length(content) between 1 and 100000),
  content_sha256 varchar(64) not null check (
    content_sha256 ~ '^[0-9a-f]{64}$'
    and content_sha256 = encode(extensions.digest(content, 'sha256'), 'hex')
  ),
  char_count integer not null check (char_count = char_length(content)),
  occurred_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  idempotency_key varchar(128) not null check (char_length(idempotency_key) between 8 and 128),
  request_fingerprint varchar(64) not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  provider_mode text not null check (provider_mode in ('local', 'openai')),
  provider_model text,
  schema_version text not null default '2.0' check (schema_version = '2.0'),
  result_jsonb jsonb,
  error_code varchar(80),
  error_message varchar(240),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint analysis_run_terminal_shape check (
    (status = 'running' and completed_at is null and result_jsonb is null)
    or (status = 'succeeded' and completed_at is not null and result_jsonb is not null and error_code is null)
    or (status in ('failed', 'cancelled') and completed_at is not null and result_jsonb is null and error_code is not null)
  )
);

create table public.analysis_run_sources (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  source_record_id uuid references public.source_records(id) on delete set null,
  source_title varchar(120) not null,
  source_kind text not null check (source_kind in ('meeting', 'research', 'feedback', 'note')),
  content_snapshot text not null check (char_length(content_snapshot) between 1 and 100000),
  content_sha256 varchar(64) not null check (
    content_sha256 ~ '^[0-9a-f]{64}$'
    and content_sha256 = encode(extensions.digest(content_snapshot, 'sha256'), 'hex')
  ),
  char_count integer not null check (char_count = char_length(content_snapshot)),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, source_record_id)
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash varchar(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  ),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.rate_limit_buckets (
  scope varchar(40) not null,
  subject_hash varchar(128) not null,
  bucket_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  request_count integer not null check (request_count >= 1),
  updated_at timestamptz not null default now(),
  primary key (scope, subject_hash, bucket_start)
);

create unique index analysis_runs_project_idempotency_idx
  on public.analysis_runs(project_id, idempotency_key);
create unique index analysis_runs_one_running_per_user_idx
  on public.analysis_runs(created_by) where status = 'running';
create index projects_owner_updated_idx on public.projects(owner_id, updated_at desc)
  where archived_at is null;
create index sources_project_created_idx on public.source_records(project_id, created_at desc)
  where archived_at is null;
create index analysis_runs_project_created_idx on public.analysis_runs(project_id, created_at desc);
create index share_links_run_created_idx on public.share_links(analysis_run_id, created_at desc);
create index rate_limit_cleanup_idx on public.rate_limit_buckets(updated_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before update on public.source_records
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.source_records enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.analysis_run_sources enable row level security;
alter table public.share_links enable row level security;
alter table public.rate_limit_buckets enable row level security;

create policy projects_owner_select on public.projects for select to authenticated
using (owner_id = (select auth.uid()));
create policy projects_owner_insert on public.projects for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy projects_owner_update on public.projects for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy projects_owner_delete on public.projects for delete to authenticated
using (owner_id = (select auth.uid()));

create policy sources_owner_select on public.source_records for select to authenticated
using (exists (
  select 1 from public.projects p where p.id = source_records.project_id and p.owner_id = (select auth.uid())
));
create policy sources_owner_insert on public.source_records for insert to authenticated
with check (exists (
  select 1 from public.projects p where p.id = source_records.project_id and p.owner_id = (select auth.uid())
));
create policy sources_owner_update on public.source_records for update to authenticated
using (exists (
  select 1 from public.projects p where p.id = source_records.project_id and p.owner_id = (select auth.uid())
)) with check (exists (
  select 1 from public.projects p where p.id = source_records.project_id and p.owner_id = (select auth.uid())
));
create policy sources_owner_delete on public.source_records for delete to authenticated
using (exists (
  select 1 from public.projects p where p.id = source_records.project_id and p.owner_id = (select auth.uid())
));

create policy runs_owner_select on public.analysis_runs for select to authenticated
using (created_by = (select auth.uid()) and exists (
  select 1 from public.projects p where p.id = analysis_runs.project_id and p.owner_id = (select auth.uid())
));
create policy runs_owner_delete on public.analysis_runs for delete to authenticated
using (created_by = (select auth.uid()));

create policy snapshots_owner_select on public.analysis_run_sources for select to authenticated
using (exists (
  select 1 from public.analysis_runs r where r.id = analysis_run_sources.analysis_run_id and r.created_by = (select auth.uid())
));
create policy shares_owner_select on public.share_links for select to authenticated
using (created_by = (select auth.uid()) and exists (
  select 1 from public.analysis_runs r
  where r.id = share_links.analysis_run_id
    and r.created_by = (select auth.uid())
    and r.status = 'succeeded'
));
create policy shares_owner_insert on public.share_links for insert to authenticated
with check (created_by = (select auth.uid()) and exists (
  select 1 from public.analysis_runs r
  where r.id = share_links.analysis_run_id and r.created_by = (select auth.uid()) and r.status = 'succeeded'
));
create policy shares_owner_update on public.share_links for update to authenticated
using (created_by = (select auth.uid()) and exists (
  select 1 from public.analysis_runs r
  where r.id = share_links.analysis_run_id
    and r.created_by = (select auth.uid())
    and r.status = 'succeeded'
)) with check (created_by = (select auth.uid()) and exists (
  select 1 from public.analysis_runs r
  where r.id = share_links.analysis_run_id
    and r.created_by = (select auth.uid())
    and r.status = 'succeeded'
));

create function public.consume_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if auth.uid() is null or p_subject <> auth.uid()::text then
    raise insufficient_privilege;
  end if;
  if p_scope not in ('analysis:hour', 'analysis:day')
     or p_limit < 1 or p_limit > 1000
     or p_window_seconds not in (3600, 86400) then
    raise exception 'INVALID_RATE_LIMIT';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets(scope, subject_hash, bucket_start, window_seconds, request_count)
  values (p_scope, encode(extensions.digest(p_subject, 'sha256'), 'hex'), v_bucket, p_window_seconds, 1)
  on conflict (scope, subject_hash, bucket_start) do update
    set request_count = public.rate_limit_buckets.request_count + 1, updated_at = now()
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

create function public.consume_public_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_scope <> 'share:hour' or p_limit <> 60 or p_window_seconds <> 3600 then
    raise exception 'INVALID_RATE_LIMIT';
  end if;
  v_bucket := date_trunc('hour', now());
  insert into public.rate_limit_buckets(scope, subject_hash, bucket_start, window_seconds, request_count)
  values (p_scope, p_subject, v_bucket, p_window_seconds, 1)
  on conflict (scope, subject_hash, bucket_start) do update
    set request_count = public.rate_limit_buckets.request_count + 1, updated_at = now()
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

create function public.consume_openai_rate_limit(p_scope text, p_subject text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz;
  v_count integer;
  v_limit integer;
  v_window integer;
begin
  if p_scope = 'openai:global:day' and p_subject = 'global' then
    v_limit := 100;
    v_window := 86400;
  elsif p_scope = 'openai:ip:hour' and p_subject ~ '^[0-9a-f]{64}$' then
    v_limit := 10;
    v_window := 3600;
  else
    raise exception 'INVALID_RATE_LIMIT';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);
  insert into public.rate_limit_buckets(scope, subject_hash, bucket_start, window_seconds, request_count)
  values (p_scope, p_subject, v_bucket, v_window, 1)
  on conflict (scope, subject_hash, bucket_start) do update
    set request_count = public.rate_limit_buckets.request_count + 1, updated_at = now()
  returning request_count into v_count;
  return v_count <= v_limit;
end;
$$;

create function public.start_analysis_run(
  p_project_id uuid,
  p_source_ids uuid[],
  p_idempotency_key text,
  p_request_fingerprint text,
  p_provider_mode text,
  p_provider_model text default null
)
returns table(outcome text, run jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_run public.analysis_runs;
  v_source_count integer;
  v_total_chars bigint;
begin
  if v_user_id is null then raise insufficient_privilege; end if;

  update public.analysis_runs
  set status = 'cancelled',
      error_code = 'LEASE_EXPIRED',
      error_message = '이전 분석 실행의 처리 시간이 만료되었습니다.',
      latency_ms = least(
        floor(extract(epoch from (now() - started_at)) * 1000)::bigint,
        2147483647
      )::integer,
      completed_at = now()
  where created_by = v_user_id
    and status = 'running'
    and started_at < now() - interval '5 minutes';

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = v_user_id and p.archived_at is null
  ) then raise insufficient_privilege; end if;

  select * into v_run from public.analysis_runs r
  where r.project_id = p_project_id
    and r.created_by = v_user_id
    and r.idempotency_key = p_idempotency_key;
  if found then
    if v_run.request_fingerprint <> p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select 'reused'::text, to_jsonb(v_run) || jsonb_build_object(
      'source_ids', coalesce((
        select jsonb_agg(rs.source_record_id order by rs.created_at)
        from public.analysis_run_sources rs where rs.analysis_run_id = v_run.id
      ), '[]'::jsonb)
    );
    return;
  end if;

  if coalesce(array_length(p_source_ids, 1), 0) < 1
     or coalesce(array_length(p_source_ids, 1), 0) > 50
     or (select count(distinct source_id) from unnest(p_source_ids) as selected(source_id)) <> array_length(p_source_ids, 1) then
    raise exception 'INVALID_SOURCE_SELECTION';
  end if;
  select count(*), coalesce(sum(char_count), 0) into v_source_count, v_total_chars
  from public.source_records s
  where s.project_id = p_project_id and s.id = any(p_source_ids) and s.archived_at is null;
  if v_source_count <> array_length(p_source_ids, 1) then
    raise exception 'INVALID_SOURCE_SELECTION';
  end if;
  if v_total_chars > 100000 then raise exception 'ANALYSIS_INPUT_TOO_LARGE'; end if;
  if p_provider_mode not in ('local', 'openai') then raise exception 'INVALID_PROVIDER_MODE'; end if;

  if not public.consume_rate_limit('analysis:hour', v_user_id::text, 10, 3600)
     or not public.consume_rate_limit('analysis:day', v_user_id::text, 30, 86400) then
    raise exception 'RATE_LIMITED';
  end if;

  begin
    insert into public.analysis_runs(
      project_id, created_by, idempotency_key, request_fingerprint, status,
      provider_mode, provider_model
    ) values (
      p_project_id, v_user_id, p_idempotency_key, p_request_fingerprint, 'running',
      p_provider_mode, p_provider_model
    ) returning * into v_run;
  exception when unique_violation then
    select * into v_run from public.analysis_runs r
    where r.project_id = p_project_id
      and r.created_by = v_user_id
      and r.idempotency_key = p_idempotency_key;
    if found then
      if v_run.request_fingerprint <> p_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return query select 'reused'::text, to_jsonb(v_run) || jsonb_build_object(
          'source_ids', coalesce((
            select jsonb_agg(rs.source_record_id order by rs.created_at)
            from public.analysis_run_sources rs where rs.analysis_run_id = v_run.id
          ), '[]'::jsonb)
        );
        return;
    end if;
    raise exception 'ANALYSIS_ALREADY_RUNNING';
  end;

  insert into public.analysis_run_sources(
    analysis_run_id, source_record_id, source_title, source_kind,
    content_snapshot, content_sha256, char_count
  )
  select v_run.id, s.id, s.title, s.kind, s.content, s.content_sha256, s.char_count
  from public.source_records s
  where s.project_id = p_project_id and s.id = any(p_source_ids) and s.archived_at is null;

  return query select 'created'::text, to_jsonb(v_run) || jsonb_build_object(
    'source_ids', to_jsonb(p_source_ids)
  );
end;
$$;

create function public.sanitize_shared_result(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    select coalesce(jsonb_object_agg(entry.key, public.sanitize_shared_result(entry.value)), '{}'::jsonb)
    into v_result
    from jsonb_each(p_value) entry
    where entry.key not in (
      'analysisRunId', 'inputTokens', 'latencyMs', 'model', 'outputTokens',
      'projectId', 'provider', 'providerModel', 'runId', 'sourceIds', 'sourceRecordId'
    );
    return v_result;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.sanitize_shared_result(item.value)), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) item;
    return v_result;
  end if;
  return p_value;
end;
$$;

create function public.resolve_shared_analysis(p_token_hash text)
returns table(
  project_title text,
  result_jsonb jsonb,
  completed_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select p.title, public.sanitize_shared_result(r.result_jsonb), r.completed_at, s.expires_at
  from public.share_links s
  join public.analysis_runs r on r.id = s.analysis_run_id
  join public.projects p on p.id = r.project_id
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and r.status = 'succeeded'
    and p.archived_at is null
  limit 1;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to authenticated;
revoke all on function public.consume_public_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, text, integer, integer) to service_role;
revoke all on function public.consume_openai_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_openai_rate_limit(text, text) to service_role;
revoke all on function public.start_analysis_run(uuid, uuid[], text, text, text, text) from public, anon;
grant execute on function public.start_analysis_run(uuid, uuid[], text, text, text, text) to authenticated;
revoke all on function public.sanitize_shared_result(jsonb) from public, anon, authenticated;
grant execute on function public.sanitize_shared_result(jsonb) to service_role;
revoke all on function public.resolve_shared_analysis(text) from public, anon, authenticated;
grant execute on function public.resolve_shared_analysis(text) to service_role;

revoke all on table public.projects, public.source_records, public.analysis_runs,
  public.analysis_run_sources, public.share_links, public.rate_limit_buckets from anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on table public.projects, public.source_records to authenticated;
grant select, delete on table public.analysis_runs to authenticated;
grant select on table public.analysis_run_sources, public.share_links to authenticated;
grant all on table public.projects, public.source_records, public.analysis_runs,
  public.analysis_run_sources, public.share_links, public.rate_limit_buckets to service_role;
