-- Remote ledger version: 20260711185902. This expand migration is additive:
-- application traffic can move to the service-role RPCs before the pending
-- contract SQL revokes the legacy authenticated table mutations.

create index if not exists projects_owner_all_idx
  on public.projects(owner_id);
create index if not exists analysis_runs_created_by_all_idx
  on public.analysis_runs(created_by);
create index if not exists sources_project_occurred_created_cursor_idx
  on public.source_records(
    project_id,
    occurred_at desc nulls last,
    created_at desc,
    id desc
  ) where archived_at is null;
create index if not exists analysis_runs_running_started_idx
  on public.analysis_runs(started_at)
  where status = 'running';

alter table public.analysis_runs
  add column provider_request_id text,
  add column reasoning_tokens integer,
  add constraint analysis_runs_provider_request_id_check check (
    provider_request_id is null
    or (
      char_length(provider_request_id) between 1 and 128
      and provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    )
  ),
  add constraint analysis_runs_reasoning_tokens_check check (
    reasoning_tokens is null or reasoning_tokens >= 0
  );

alter table public.context_entities
  add constraint context_entities_metadata_size_check
  check (octet_length(metadata::text) <= 16384) not valid;
alter table public.context_edges
  add constraint context_edges_evidence_size_check
  check (octet_length(evidence::text) <= 32768) not valid;
alter table public.context_edges
  add constraint context_edges_metadata_size_check
  check (octet_length(metadata::text) <= 16384) not valid;

alter table public.context_entities
  validate constraint context_entities_metadata_size_check;
alter table public.context_edges
  validate constraint context_edges_evidence_size_check;
alter table public.context_edges
  validate constraint context_edges_metadata_size_check;

create function public.enforce_context_graph_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
  v_limit integer;
begin
  -- Serialize quota checks for a project and graph resource. A count-only
  -- trigger without this lock can be exceeded by concurrent inserts.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'modu-brain:graph-quota:' || new.project_id::text || ':' || tg_table_name,
      0
    )
  );

  if tg_table_name = 'context_entities' then
    v_limit := 500;
    select count(*) into v_count
    from public.context_entities e
    where e.project_id = new.project_id;
  elsif tg_table_name = 'context_entity_aliases' then
    v_limit := 1000;
    select count(*) into v_count
    from public.context_entity_aliases a
    where a.project_id = new.project_id;
  elsif tg_table_name = 'context_edges' then
    v_limit := 2000;
    select count(*) into v_count
    from public.context_edges e
    where e.project_id = new.project_id;
  else
    raise exception 'CONTEXT_GRAPH_QUOTA_CONFIGURATION_ERROR';
  end if;

  if v_count >= v_limit then
    raise exception 'CONTEXT_GRAPH_QUOTA_EXCEEDED'
      using detail = format('%s is limited to %s rows per project', tg_table_name, v_limit);
  end if;
  return new;
end;
$$;

create trigger context_entities_enforce_quota
before insert on public.context_entities
for each row execute function public.enforce_context_graph_quota();
create trigger context_aliases_enforce_quota
before insert on public.context_entity_aliases
for each row execute function public.enforce_context_graph_quota();
create trigger context_edges_enforce_quota
before insert on public.context_edges
for each row execute function public.enforce_context_graph_quota();

create function public.enforce_storage_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_project_id uuid;
  v_count bigint;
  v_char_count bigint;
begin
  if tg_table_name = 'projects' then
    v_user_id := new.owner_id;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('modu-brain:storage:user:' || v_user_id::text, 0)
    );
    select count(*) into v_count
    from public.projects p
    where p.owner_id = v_user_id;
    if v_count >= 25 then
      raise exception 'STORAGE_QUOTA_EXCEEDED'
        using detail = 'projects are limited to 25 rows per user';
    end if;
    return new;
  end if;

  if tg_table_name = 'source_records' then
    v_project_id := new.project_id;
    select p.owner_id into v_user_id
    from public.projects p
    where p.id = v_project_id;
    if v_user_id is null then raise insufficient_privilege; end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('modu-brain:storage:user:' || v_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('modu-brain:storage:project:' || v_project_id::text, 0)
    );

    if tg_op = 'INSERT' then
      select count(*) into v_count
      from public.source_records s
      where s.project_id = v_project_id;
    else
      select count(*) into v_count
      from public.source_records s
      where s.project_id = v_project_id and s.id <> old.id;
    end if;
    if v_count >= 500 then
      raise exception 'STORAGE_QUOTA_EXCEEDED'
        using detail = 'source_records are limited to 500 rows per project';
    end if;

    if tg_op = 'INSERT' then
      select coalesce(sum(s.char_count), 0) into v_char_count
      from public.source_records s
      join public.projects p on p.id = s.project_id
      where p.owner_id = v_user_id;
    else
      select coalesce(sum(s.char_count), 0) into v_char_count
      from public.source_records s
      join public.projects p on p.id = s.project_id
      where p.owner_id = v_user_id and s.id <> old.id;
    end if;
    if v_char_count + new.char_count > 2000000 then
      raise exception 'STORAGE_QUOTA_EXCEEDED'
        using detail = 'source text is limited to 2000000 characters per user';
    end if;
    return new;
  end if;

  if tg_table_name = 'analysis_runs' then
    v_user_id := new.created_by;
    v_project_id := new.project_id;
    if not exists (
      select 1 from public.projects p
      where p.id = v_project_id and p.owner_id = v_user_id
    ) then
      raise insufficient_privilege;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('modu-brain:storage:user:' || v_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('modu-brain:storage:project:' || v_project_id::text, 0)
    );
    select count(*) into v_count
    from public.analysis_runs r
    where r.project_id = v_project_id;
    if v_count >= 100 then
      raise exception 'STORAGE_QUOTA_EXCEEDED'
        using detail = 'analysis_runs are limited to 100 rows per project';
    end if;
    return new;
  end if;

  if tg_table_name = 'analysis_run_sources' then
    select r.created_by, r.project_id into v_user_id, v_project_id
    from public.analysis_runs r
    where r.id = new.analysis_run_id;
    if v_user_id is null then raise insufficient_privilege; end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('modu-brain:storage:user:' || v_user_id::text, 0)
    );
    select coalesce(sum(rs.char_count), 0) into v_char_count
    from public.analysis_run_sources rs
    join public.analysis_runs r on r.id = rs.analysis_run_id
    where r.created_by = v_user_id;
    if v_char_count + new.char_count > 2000000 then
      raise exception 'STORAGE_QUOTA_EXCEEDED'
        using detail = 'analysis snapshots are limited to 2000000 characters per user';
    end if;
    return new;
  end if;

  if tg_table_name in ('analysis_run_annotations', 'share_links') then
    select r.created_by, r.project_id into v_user_id, v_project_id
    from public.analysis_runs r
    join public.projects p on p.id = r.project_id
    where r.id = new.analysis_run_id
      and r.created_by = p.owner_id;
    if v_user_id is null or new.created_by <> v_user_id then
      raise insufficient_privilege;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'modu-brain:storage:run:' || new.analysis_run_id::text || ':' || tg_table_name,
        0
      )
    );

    if tg_table_name = 'analysis_run_annotations' then
      select count(*) into v_count
      from public.analysis_run_annotations a
      where a.analysis_run_id = new.analysis_run_id;
      if v_count >= 200 then
        raise exception 'STORAGE_QUOTA_EXCEEDED'
          using detail = 'annotations are limited to 200 rows per analysis run';
      end if;
    else
      -- Revoked links remain in the count so repeatedly rotating tokens cannot
      -- create an unbounded account export or audit history.
      select count(*) into v_count
      from public.share_links s
      where s.analysis_run_id = new.analysis_run_id;
      if v_count >= 50 then
        raise exception 'STORAGE_QUOTA_EXCEEDED'
          using detail = 'share_links are limited to 50 rows per analysis run';
      end if;
    end if;
    return new;
  end if;

  raise exception 'STORAGE_QUOTA_CONFIGURATION_ERROR';
end;
$$;

create trigger projects_enforce_storage_quota
before insert on public.projects
for each row execute function public.enforce_storage_quota();
create trigger sources_enforce_storage_quota
before insert or update of project_id, char_count on public.source_records
for each row execute function public.enforce_storage_quota();
create trigger analysis_runs_enforce_storage_quota
before insert on public.analysis_runs
for each row execute function public.enforce_storage_quota();
create trigger snapshots_enforce_storage_quota
before insert on public.analysis_run_sources
for each row execute function public.enforce_storage_quota();
create trigger annotations_enforce_storage_quota
before insert on public.analysis_run_annotations
for each row execute function public.enforce_storage_quota();
create trigger share_links_enforce_storage_quota
before insert on public.share_links
for each row execute function public.enforce_storage_quota();

create function public.app_consume_public_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_RATE_LIMIT_SUBJECT';
  end if;
  if not (
    (p_scope = 'share:hour' and p_limit = 60 and p_window_seconds = 3600)
    or (p_scope = 'share:ip:hour' and p_limit = 600 and p_window_seconds = 3600)
    or (p_scope = 'share:token-ip:hour' and p_limit = 60 and p_window_seconds = 3600)
    or (p_scope = 'public-analysis:hour' and p_limit = 30 and p_window_seconds = 3600)
    or (p_scope = 'public-import:hour' and p_limit = 20 and p_window_seconds = 3600)
  ) then
    raise exception 'INVALID_RATE_LIMIT';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from pg_catalog.clock_timestamp()) / p_window_seconds)
      * p_window_seconds
  );
  insert into public.rate_limit_buckets(
    scope, subject_hash, bucket_start, window_seconds, request_count
  ) values (
    p_scope, p_subject_hash, v_bucket, p_window_seconds, 1
  )
  on conflict (scope, subject_hash, bucket_start) do update
    set request_count = least(
          public.rate_limit_buckets.request_count + 1,
          2147483647
        ),
        updated_at = now()
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

create function public.app_create_project(
  p_user_id uuid,
  p_title text,
  p_description text default ''
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  insert into public.projects(owner_id, title, description)
  values (p_user_id, p_title, coalesce(p_description, ''))
  returning * into v_project;
  return v_project;
end;
$$;

create function public.app_update_project(
  p_user_id uuid,
  p_project_id uuid,
  p_patch jsonb
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.projects;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  if jsonb_typeof(v_patch) <> 'object'
     or v_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(v_patch) as item(key)
       where item.key not in ('title', 'description')
     ) then
    raise exception 'INVALID_PROJECT_PATCH';
  end if;

  update public.projects p
  set title = case when v_patch ? 'title' then v_patch ->> 'title' else p.title end,
      description = case
        when v_patch ? 'description' then coalesce(v_patch ->> 'description', '')
        else p.description
      end
  where p.id = p_project_id and p.owner_id = p_user_id
  returning p.* into v_project;
  if not found then raise insufficient_privilege; end if;
  return v_project;
end;
$$;

create function public.app_archive_project(
  p_user_id uuid,
  p_project_id uuid
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  update public.projects p
  set archived_at = coalesce(p.archived_at, now())
  where p.id = p_project_id and p.owner_id = p_user_id
  returning p.* into v_project;
  if not found then raise insufficient_privilege; end if;
  return v_project;
end;
$$;

create function public.app_restore_project(
  p_user_id uuid,
  p_project_id uuid
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.projects;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  update public.projects p
  set archived_at = null
  where p.id = p_project_id and p.owner_id = p_user_id
  returning p.* into v_project;
  if not found then raise insufficient_privilege; end if;
  return v_project;
end;
$$;

create function public.app_delete_project(
  p_user_id uuid,
  p_project_id uuid,
  p_confirmation text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  if p_confirmation <> 'delete' then
    raise exception 'DELETE_CONFIRMATION_REQUIRED';
  end if;
  delete from public.projects p
  where p.id = p_project_id and p.owner_id = p_user_id
  returning p.id into v_id;
  if not found then raise insufficient_privilege; end if;
  return v_id;
end;
$$;

create function public.app_create_source_record(
  p_user_id uuid,
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_content text,
  p_content_sha256 text,
  p_char_count integer,
  p_occurred_at timestamptz default null
)
returns public.source_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.source_records;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.owner_id = p_user_id
      and p.archived_at is null
  ) then
    raise insufficient_privilege;
  end if;
  insert into public.source_records(
    project_id, kind, title, content, content_sha256, char_count, occurred_at
  ) values (
    p_project_id, p_kind, p_title, p_content, p_content_sha256,
    p_char_count, p_occurred_at
  ) returning * into v_source;
  return v_source;
end;
$$;

create function public.app_update_source_record(
  p_user_id uuid,
  p_source_id uuid,
  p_patch jsonb
)
returns public.source_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.source_records;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_content_patch boolean;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  if jsonb_typeof(v_patch) <> 'object'
     or v_patch = '{}'::jsonb
     or octet_length(v_patch::text) > 262144
     or exists (
       select 1 from jsonb_object_keys(v_patch) as item(key)
       where item.key not in (
         'kind', 'title', 'content', 'content_sha256', 'char_count', 'occurred_at'
       )
     ) then
    raise exception 'INVALID_SOURCE_PATCH';
  end if;
  v_content_patch := v_patch ? 'content'
    or v_patch ? 'content_sha256'
    or v_patch ? 'char_count';
  if v_content_patch and not (
    v_patch ? 'content' and v_patch ? 'content_sha256' and v_patch ? 'char_count'
  ) then
    raise exception 'INVALID_SOURCE_CONTENT_SHAPE';
  end if;

  update public.source_records s
  set kind = case when v_patch ? 'kind' then v_patch ->> 'kind' else s.kind end,
      title = case when v_patch ? 'title' then v_patch ->> 'title' else s.title end,
      content = case when v_patch ? 'content' then v_patch ->> 'content' else s.content end,
      content_sha256 = case
        when v_patch ? 'content_sha256' then v_patch ->> 'content_sha256'
        else s.content_sha256
      end,
      char_count = case
        when v_patch ? 'char_count' then (v_patch ->> 'char_count')::integer
        else s.char_count
      end,
      occurred_at = case
        when v_patch ? 'occurred_at' then (v_patch ->> 'occurred_at')::timestamptz
        else s.occurred_at
      end
  from public.projects p
  where s.id = p_source_id
    and p.id = s.project_id
    and p.owner_id = p_user_id
  returning s.* into v_source;
  if not found then raise insufficient_privilege; end if;
  return v_source;
end;
$$;

create function public.app_archive_source_record(
  p_user_id uuid,
  p_source_id uuid
)
returns public.source_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.source_records;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  update public.source_records s
  set archived_at = coalesce(s.archived_at, now())
  from public.projects p
  where s.id = p_source_id
    and p.id = s.project_id
    and p.owner_id = p_user_id
  returning s.* into v_source;
  if not found then raise insufficient_privilege; end if;
  return v_source;
end;
$$;

create function public.app_restore_source_record(
  p_user_id uuid,
  p_source_id uuid
)
returns public.source_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.source_records;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  update public.source_records s
  set archived_at = null
  from public.projects p
  where s.id = p_source_id
    and p.id = s.project_id
    and p.owner_id = p_user_id
    and p.archived_at is null
  returning s.* into v_source;
  if not found then raise insufficient_privilege; end if;
  return v_source;
end;
$$;

create function public.app_start_analysis_run(
  p_user_id uuid,
  p_project_id uuid,
  p_source_ids uuid[],
  p_idempotency_key text,
  p_request_fingerprint text,
  p_provider_mode text,
  p_provider_model text default null
)
returns table(outcome text, run jsonb, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.analysis_runs;
  v_source_count integer;
  v_total_chars bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_subject_hash text;
  v_hour_bucket timestamptz;
  v_day_bucket timestamptz;
  v_hour_count integer;
  v_day_count integer;
  v_retry integer;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 128
     or coalesce(p_request_fingerprint, '') !~ '^[0-9a-f]{64}$'
     or p_provider_mode not in ('local', 'openai')
     or (p_provider_mode = 'local' and p_provider_model is not null)
     or (p_provider_model is not null and char_length(p_provider_model) > 120) then
    raise exception 'INVALID_ANALYSIS_REQUEST';
  end if;

  update public.analysis_runs r
  set status = 'cancelled',
      error_code = 'LEASE_EXPIRED',
      error_message = 'The analysis lease expired before completion.',
      latency_ms = least(
        floor(extract(epoch from (v_now - r.started_at)) * 1000)::bigint,
        2147483647
      )::integer,
      completed_at = v_now
  where r.created_by = p_user_id
    and r.status = 'running'
    and r.started_at < v_now - interval '5 minutes';

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.owner_id = p_user_id
      and p.archived_at is null
  ) then
    raise insufficient_privilege;
  end if;

  select r.* into v_run
  from public.analysis_runs r
  where r.project_id = p_project_id
    and r.created_by = p_user_id
    and r.idempotency_key = p_idempotency_key;
  if found then
    if v_run.request_fingerprint <> p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select
      'reused'::text,
      to_jsonb(v_run) || jsonb_build_object(
        'source_ids', coalesce((
          select jsonb_agg(rs.source_record_id order by rs.created_at)
          from public.analysis_run_sources rs
          where rs.analysis_run_id = v_run.id
        ), '[]'::jsonb)
      ),
      0;
    return;
  end if;

  if coalesce(array_length(p_source_ids, 1), 0) < 1
     or coalesce(array_length(p_source_ids, 1), 0) > 50
     or (
       select count(distinct selected.source_id)
       from unnest(p_source_ids) as selected(source_id)
     ) <> array_length(p_source_ids, 1) then
    raise exception 'INVALID_SOURCE_SELECTION';
  end if;
  select count(*), coalesce(sum(s.char_count), 0)
  into v_source_count, v_total_chars
  from public.source_records s
  where s.project_id = p_project_id
    and s.id = any(p_source_ids)
    and s.archived_at is null;
  if v_source_count <> array_length(p_source_ids, 1) then
    raise exception 'INVALID_SOURCE_SELECTION';
  end if;
  if v_total_chars > 100000 then
    raise exception 'ANALYSIS_INPUT_TOO_LARGE';
  end if;

  select r.* into v_run
  from public.analysis_runs r
  where r.created_by = p_user_id and r.status = 'running'
  order by r.started_at desc
  limit 1;
  if found then
    return query select
      'already_running'::text,
      to_jsonb(v_run) || jsonb_build_object(
        'source_ids', coalesce((
          select jsonb_agg(rs.source_record_id order by rs.created_at)
          from public.analysis_run_sources rs
          where rs.analysis_run_id = v_run.id
        ), '[]'::jsonb)
      ),
      1;
    return;
  end if;

  v_subject_hash := encode(
    extensions.digest(p_user_id::text, 'sha256'),
    'hex'
  );
  v_hour_bucket := to_timestamp(
    floor(extract(epoch from v_now) / 3600) * 3600
  );
  v_day_bucket := to_timestamp(
    floor(extract(epoch from v_now) / 86400) * 86400
  );

  insert into public.rate_limit_buckets(
    scope, subject_hash, bucket_start, window_seconds, request_count
  ) values (
    'analysis:hour', v_subject_hash, v_hour_bucket, 3600, 1
  )
  on conflict (scope, subject_hash, bucket_start) do update
    set request_count = least(
          public.rate_limit_buckets.request_count + 1,
          2147483647
        ),
        updated_at = now()
  returning request_count into v_hour_count;

  insert into public.rate_limit_buckets(
    scope, subject_hash, bucket_start, window_seconds, request_count
  ) values (
    'analysis:day', v_subject_hash, v_day_bucket, 86400, 1
  )
  on conflict (scope, subject_hash, bucket_start) do update
    set request_count = least(
          public.rate_limit_buckets.request_count + 1,
          2147483647
        ),
        updated_at = now()
  returning request_count into v_day_count;

  if v_hour_count > 10 or v_day_count > 30 then
    v_retry := greatest(
      case when v_hour_count > 10 then
        greatest(1, ceil(extract(epoch from (v_hour_bucket + interval '1 hour' - v_now)))::integer)
      else 0 end,
      case when v_day_count > 30 then
        greatest(1, ceil(extract(epoch from (v_day_bucket + interval '1 day' - v_now)))::integer)
      else 0 end
    );
    return query select 'rate_limited'::text, null::jsonb, v_retry;
    return;
  end if;

  begin
    insert into public.analysis_runs(
      project_id, created_by, idempotency_key, request_fingerprint, status,
      provider_mode, provider_model
    ) values (
      p_project_id, p_user_id, p_idempotency_key, p_request_fingerprint,
      'running', p_provider_mode, p_provider_model
    ) returning * into v_run;
  exception when unique_violation then
    select r.* into v_run
    from public.analysis_runs r
    where r.project_id = p_project_id
      and r.created_by = p_user_id
      and r.idempotency_key = p_idempotency_key;
    if found then
      if v_run.request_fingerprint <> p_request_fingerprint then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return query select
        'reused'::text,
        to_jsonb(v_run) || jsonb_build_object(
          'source_ids', coalesce((
            select jsonb_agg(rs.source_record_id order by rs.created_at)
            from public.analysis_run_sources rs
            where rs.analysis_run_id = v_run.id
          ), '[]'::jsonb)
        ),
        0;
      return;
    end if;

    select r.* into v_run
    from public.analysis_runs r
    where r.created_by = p_user_id and r.status = 'running'
    order by r.started_at desc
    limit 1;
    if found then
      return query select
        'already_running'::text,
        to_jsonb(v_run) || jsonb_build_object(
          'source_ids', coalesce((
            select jsonb_agg(rs.source_record_id order by rs.created_at)
            from public.analysis_run_sources rs
            where rs.analysis_run_id = v_run.id
          ), '[]'::jsonb)
        ),
        1;
      return;
    end if;
    raise;
  end;

  insert into public.analysis_run_sources(
    analysis_run_id, source_record_id, source_title, source_kind,
    content_snapshot, content_sha256, char_count
  )
  select v_run.id, s.id, s.title, s.kind, s.content, s.content_sha256, s.char_count
  from public.source_records s
  where s.project_id = p_project_id
    and s.id = any(p_source_ids)
    and s.archived_at is null;

  return query select
    'created'::text,
    to_jsonb(v_run) || jsonb_build_object('source_ids', to_jsonb(p_source_ids)),
    0;
end;
$$;

create function public.app_complete_analysis_run(
  p_user_id uuid,
  p_run_id uuid,
  p_status text,
  p_result_jsonb jsonb default null,
  p_error_code text default null,
  p_error_message text default null,
  p_latency_ms integer default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_completed_at timestamptz default now(),
  p_provider_request_id text default null,
  p_reasoning_tokens integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.analysis_runs;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'INVALID_ANALYSIS_COMPLETION';
  end if;
  if p_status = 'succeeded' and p_result_jsonb is null then
    raise exception 'INVALID_ANALYSIS_COMPLETION';
  end if;
  if p_provider_request_id is not null and (
       char_length(p_provider_request_id) not between 1 and 128
       or p_provider_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     ) then
    raise exception 'INVALID_ANALYSIS_COMPLETION';
  end if;
  if p_reasoning_tokens is not null and p_reasoning_tokens < 0 then
    raise exception 'INVALID_ANALYSIS_COMPLETION';
  end if;

  update public.analysis_runs r
  set status = p_status,
      result_jsonb = case when p_status = 'succeeded' then p_result_jsonb else null end,
      error_code = case
        when p_status = 'succeeded' then null
        else coalesce(nullif(btrim(p_error_code), ''), 'ANALYSIS_FAILED')
      end,
      error_message = case
        when p_status = 'succeeded' then null
        else coalesce(nullif(btrim(p_error_message), ''), 'The analysis did not complete.')
      end,
      latency_ms = p_latency_ms,
      input_tokens = case when p_status = 'succeeded' then p_input_tokens else null end,
      output_tokens = case when p_status = 'succeeded' then p_output_tokens else null end,
      provider_request_id = case
        when p_status = 'succeeded' then p_provider_request_id
        else null
      end,
      reasoning_tokens = case
        when p_status = 'succeeded' then p_reasoning_tokens
        else null
      end,
      completed_at = coalesce(p_completed_at, now())
  where r.id = p_run_id
    and r.created_by = p_user_id
    and r.status = 'running'
    and exists (
      select 1 from public.projects p
      where p.id = r.project_id and p.owner_id = p_user_id
    )
  returning r.* into v_run;
  if not found then raise insufficient_privilege; end if;

  return to_jsonb(v_run) || jsonb_build_object(
    'source_ids', coalesce((
      select jsonb_agg(rs.source_record_id order by rs.created_at)
      from public.analysis_run_sources rs
      where rs.analysis_run_id = v_run.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.app_delete_analysis_run(
  p_user_id uuid,
  p_run_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  delete from public.analysis_runs r
  where r.id = p_run_id
    and r.created_by = p_user_id
    and exists (
      select 1 from public.projects p
      where p.id = r.project_id and p.owner_id = p_user_id
    )
  returning r.id into v_id;
  if not found then raise insufficient_privilege; end if;
  return v_id;
end;
$$;

create function public.app_append_analysis_run_step_event(
  p_user_id uuid,
  p_run_id uuid,
  p_sequence smallint,
  p_event_key text,
  p_step_name text,
  p_status text,
  p_validation_outcome text default null,
  p_code text default null,
  p_duration_ms integer default null,
  p_source_count smallint default null,
  p_input_characters integer default null,
  p_output_item_count integer default null,
  p_evidence_reference_count integer default null
)
returns public.analysis_run_step_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.analysis_run_step_events;
begin
  if p_user_id is null or not exists (
    select 1
    from public.analysis_runs r
    join public.projects p on p.id = r.project_id
    where r.id = p_run_id
      and r.created_by = p_user_id
      and p.owner_id = p_user_id
  ) then
    raise insufficient_privilege;
  end if;

  insert into public.analysis_run_step_events(
    analysis_run_id, sequence, event_key, step_name, status,
    validation_outcome, code, duration_ms, source_count, input_characters,
    output_item_count, evidence_reference_count
  ) values (
    p_run_id, p_sequence, p_event_key, p_step_name, p_status,
    p_validation_outcome, p_code, p_duration_ms, p_source_count,
    p_input_characters, p_output_item_count, p_evidence_reference_count
  )
  on conflict (analysis_run_id, event_key) do nothing
  returning * into v_event;

  if not found then
    select e.* into v_event
    from public.analysis_run_step_events e
    where e.analysis_run_id = p_run_id and e.event_key = p_event_key;
  end if;
  return v_event;
end;
$$;

create function public.app_create_share_link(
  p_user_id uuid,
  p_run_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.share_links
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_share public.share_links;
begin
  if p_user_id is null or not exists (
    select 1
    from public.analysis_runs r
    join public.projects p on p.id = r.project_id
    where r.id = p_run_id
      and r.created_by = p_user_id
      and r.status = 'succeeded'
      and p.owner_id = p_user_id
      and p.archived_at is null
  ) then
    raise insufficient_privilege;
  end if;
  insert into public.share_links(analysis_run_id, created_by, token_hash, expires_at)
  values (p_run_id, p_user_id, p_token_hash, p_expires_at)
  returning * into v_share;
  return v_share;
end;
$$;

create function public.app_revoke_share_link(
  p_user_id uuid,
  p_share_link_id uuid
)
returns public.share_links
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_share public.share_links;
begin
  if p_user_id is null then raise insufficient_privilege; end if;
  update public.share_links s
  set revoked_at = coalesce(s.revoked_at, now())
  where s.id = p_share_link_id
    and s.created_by = p_user_id
    and exists (
      select 1
      from public.analysis_runs r
      join public.projects p on p.id = r.project_id
      where r.id = s.analysis_run_id
        and r.created_by = p_user_id
        and p.owner_id = p_user_id
    )
  returning s.* into v_share;
  if not found then raise insufficient_privilege; end if;
  return v_share;
end;
$$;

create function public.app_export_account(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_export jsonb;
begin
  if p_user_id is null then raise insufficient_privilege; end if;

  select jsonb_build_object(
    'exported_at', pg_catalog.clock_timestamp(),
    'schema_version', '1.0',
    'user_id', p_user_id,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'description', p.description,
        'archived_at', p.archived_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      ) order by p.created_at, p.id)
      from public.projects p
      where p.owner_id = p_user_id
    ), '[]'::jsonb),
    'source_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_id', s.project_id,
        'kind', s.kind,
        'title', s.title,
        'content', s.content,
        'content_sha256', s.content_sha256,
        'char_count', s.char_count,
        'occurred_at', s.occurred_at,
        'archived_at', s.archived_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      ) order by s.created_at, s.id)
      from public.source_records s
      join public.projects p on p.id = s.project_id
      where p.owner_id = p_user_id
    ), '[]'::jsonb),
    'analysis_runs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'project_id', r.project_id,
        'status', r.status,
        'provider_mode', r.provider_mode,
        'provider_model', r.provider_model,
        'schema_version', r.schema_version,
        'result_jsonb', r.result_jsonb,
        'error_code', r.error_code,
        'error_message', r.error_message,
        'latency_ms', r.latency_ms,
        'input_tokens', r.input_tokens,
        'output_tokens', r.output_tokens,
        'provider_request_id', r.provider_request_id,
        'reasoning_tokens', r.reasoning_tokens,
        'created_at', r.created_at,
        'started_at', r.started_at,
        'completed_at', r.completed_at
      ) order by r.created_at, r.id)
      from public.analysis_runs r
      join public.projects p on p.id = r.project_id
      where r.created_by = p_user_id and p.owner_id = p_user_id
    ), '[]'::jsonb),
    'analysis_run_sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rs.id,
        'analysis_run_id', rs.analysis_run_id,
        'source_record_id', rs.source_record_id,
        'source_title', rs.source_title,
        'source_kind', rs.source_kind,
        'content_snapshot', rs.content_snapshot,
        'content_sha256', rs.content_sha256,
        'char_count', rs.char_count,
        'created_at', rs.created_at
      ) order by rs.created_at, rs.id)
      from public.analysis_run_sources rs
      join public.analysis_runs r on r.id = rs.analysis_run_id
      join public.projects p on p.id = r.project_id
      where r.created_by = p_user_id and p.owner_id = p_user_id
    ), '[]'::jsonb),
    'step_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'analysis_run_id', e.analysis_run_id,
        'sequence', e.sequence,
        'event_key', e.event_key,
        'step_name', e.step_name,
        'status', e.status,
        'validation_outcome', e.validation_outcome,
        'code', e.code,
        'duration_ms', e.duration_ms,
        'source_count', e.source_count,
        'input_characters', e.input_characters,
        'output_item_count', e.output_item_count,
        'evidence_reference_count', e.evidence_reference_count,
        'created_at', e.created_at
      ) order by e.created_at, e.id)
      from public.analysis_run_step_events e
      join public.analysis_runs r on r.id = e.analysis_run_id
      join public.projects p on p.id = r.project_id
      where r.created_by = p_user_id and p.owner_id = p_user_id
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'analysis_run_id', a.analysis_run_id,
        'annotation_type', a.annotation_type,
        'target_type', a.target_type,
        'target_id', a.target_id,
        'body', a.body,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.analysis_run_annotations a
      join public.analysis_runs r on r.id = a.analysis_run_id
      join public.projects p on p.id = r.project_id
      where a.created_by = p_user_id
        and r.created_by = p_user_id
        and p.owner_id = p_user_id
    ), '[]'::jsonb),
    'share_links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'analysis_run_id', s.analysis_run_id,
        'expires_at', s.expires_at,
        'revoked_at', s.revoked_at,
        'created_at', s.created_at
      ) order by s.created_at, s.id)
      from public.share_links s
      join public.analysis_runs r on r.id = s.analysis_run_id
      join public.projects p on p.id = r.project_id
      where s.created_by = p_user_id
        and r.created_by = p_user_id
        and p.owner_id = p_user_id
    ), '[]'::jsonb),
    'context_sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'project_id', i.project_id,
        'source_record_id', i.source_record_id,
        'provider', i.provider,
        'external_id', i.external_id,
        'import_hash', i.import_hash,
        'status', i.status,
        'participants', i.participants,
        'segment_count', i.segment_count,
        'metadata', i.metadata,
        'error_code', i.error_code,
        'imported_at', i.imported_at,
        'created_at', i.created_at,
        'updated_at', i.updated_at
      ) order by i.created_at, i.id)
      from public.source_imports i
      join public.projects p on p.id = i.project_id
      where p.owner_id = p_user_id
    ), '[]'::jsonb),
    'context_segments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'project_id', s.project_id,
        'source_record_id', s.source_record_id,
        'ordinal', s.ordinal,
        'speaker', s.speaker,
        'text', s.text,
        'occurred_at', s.occurred_at,
        'external_id', s.external_id,
        'source_url', s.source_url,
        'created_at', s.created_at
      ) order by s.project_id, s.source_record_id, s.ordinal, s.id)
      from public.source_segments s
      join public.projects p on p.id = s.project_id
      where p.owner_id = p_user_id
    ), '[]'::jsonb),
    'context_entities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'project_id', e.project_id,
        'type', e.type,
        'label', e.label,
        'normalized_label', e.normalized_label,
        'metadata', e.metadata,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      ) order by e.created_at, e.id)
      from public.context_entities e
      join public.projects p on p.id = e.project_id
      where p.owner_id = p_user_id
    ), '[]'::jsonb),
    'context_aliases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'project_id', a.project_id,
        'entity_id', a.entity_id,
        'alias', a.alias,
        'normalized_alias', a.normalized_alias,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.context_entity_aliases a
      join public.projects p on p.id = a.project_id
      where p.owner_id = p_user_id
    ), '[]'::jsonb),
    'context_edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'project_id', e.project_id,
        'from_entity_id', e.from_entity_id,
        'to_entity_id', e.to_entity_id,
        'relation', e.relation,
        'source_segment_id', e.source_segment_id,
        'evidence', e.evidence,
        'metadata', e.metadata,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      ) order by e.created_at, e.id)
      from public.context_edges e
      join public.projects p on p.id = e.project_id
      where p.owner_id = p_user_id
    ), '[]'::jsonb)
  ) into v_export;
  return v_export;
end;
$$;

create function public.app_cleanup_rate_limit_buckets(
  p_retention_seconds integer default 172800,
  p_batch_size integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_retention_seconds not between 86400 and 604800
     or p_batch_size not between 1 and 10000 then
    raise exception 'INVALID_CLEANUP_WINDOW';
  end if;
  with expired as (
    select r.scope, r.subject_hash, r.bucket_start
    from public.rate_limit_buckets r
    where r.updated_at < now() - make_interval(secs => p_retention_seconds)
    order by r.updated_at
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from public.rate_limit_buckets r
    using expired e
    where r.scope = e.scope
      and r.subject_hash = e.subject_hash
      and r.bucket_start = e.bucket_start
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;
  return v_deleted;
end;
$$;

create function public.app_cleanup_stale_analysis_runs(
  p_lease_seconds integer default 300,
  p_batch_size integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_lease_seconds not between 60 and 3600
     or p_batch_size not between 1 and 5000 then
    raise exception 'INVALID_CLEANUP_WINDOW';
  end if;
  with stale as (
    select r.id
    from public.analysis_runs r
    where r.status = 'running'
      and r.started_at < now() - make_interval(secs => p_lease_seconds)
    order by r.started_at
    limit p_batch_size
    for update skip locked
  ), updated as (
    update public.analysis_runs r
    set status = 'cancelled',
        error_code = 'LEASE_EXPIRED',
        error_message = 'The analysis lease expired before completion.',
        latency_ms = least(
          floor(extract(epoch from (now() - r.started_at)) * 1000)::bigint,
          2147483647
        )::integer,
        completed_at = now()
    from stale s
    where r.id = s.id and r.status = 'running'
    returning 1
  )
  select count(*)::integer into v_updated from updated;
  return v_updated;
end;
$$;

revoke all on function public.enforce_context_graph_quota()
  from PUBLIC, anon, authenticated;
revoke all on function public.enforce_storage_quota()
  from PUBLIC, anon, authenticated;
revoke all on function public.app_consume_public_rate_limit(text, text, integer, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_create_project(uuid, text, text)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_update_project(uuid, uuid, jsonb)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_archive_project(uuid, uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_restore_project(uuid, uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_delete_project(uuid, uuid, text)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_create_source_record(
  uuid, uuid, text, text, text, text, integer, timestamptz
) from PUBLIC, anon, authenticated;
revoke all on function public.app_update_source_record(uuid, uuid, jsonb)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_archive_source_record(uuid, uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_restore_source_record(uuid, uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_start_analysis_run(
  uuid, uuid, uuid[], text, text, text, text
) from PUBLIC, anon, authenticated;
revoke all on function public.app_complete_analysis_run(
  uuid, uuid, text, jsonb, text, text, integer, integer, integer, timestamptz,
  text, integer
) from PUBLIC, anon, authenticated;
revoke all on function public.app_delete_analysis_run(uuid, uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_append_analysis_run_step_event(
  uuid, uuid, smallint, text, text, text, text, text, integer, smallint,
  integer, integer, integer
) from PUBLIC, anon, authenticated;
revoke all on function public.app_create_share_link(uuid, uuid, text, timestamptz)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_revoke_share_link(uuid, uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_export_account(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_cleanup_rate_limit_buckets(integer, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.app_cleanup_stale_analysis_runs(integer, integer)
  from PUBLIC, anon, authenticated;

grant execute on function public.app_consume_public_rate_limit(text, text, integer, integer)
  to service_role;
grant execute on function public.app_create_project(uuid, text, text)
  to service_role;
grant execute on function public.app_update_project(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.app_archive_project(uuid, uuid)
  to service_role;
grant execute on function public.app_restore_project(uuid, uuid)
  to service_role;
grant execute on function public.app_delete_project(uuid, uuid, text)
  to service_role;
grant execute on function public.app_create_source_record(
  uuid, uuid, text, text, text, text, integer, timestamptz
) to service_role;
grant execute on function public.app_update_source_record(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.app_archive_source_record(uuid, uuid)
  to service_role;
grant execute on function public.app_restore_source_record(uuid, uuid)
  to service_role;
grant execute on function public.app_start_analysis_run(
  uuid, uuid, uuid[], text, text, text, text
) to service_role;
grant execute on function public.app_complete_analysis_run(
  uuid, uuid, text, jsonb, text, text, integer, integer, integer, timestamptz,
  text, integer
) to service_role;
grant execute on function public.app_delete_analysis_run(uuid, uuid)
  to service_role;
grant execute on function public.app_append_analysis_run_step_event(
  uuid, uuid, smallint, text, text, text, text, text, integer, smallint,
  integer, integer, integer
) to service_role;
grant execute on function public.app_create_share_link(uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.app_revoke_share_link(uuid, uuid)
  to service_role;
grant execute on function public.app_export_account(uuid)
  to service_role;
grant execute on function public.app_cleanup_rate_limit_buckets(integer, integer)
  to service_role;
grant execute on function public.app_cleanup_stale_analysis_runs(integer, integer)
  to service_role;
