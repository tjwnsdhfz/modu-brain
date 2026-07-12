alter table public.source_records
  add constraint source_records_project_id_id_key unique (project_id, id);

create table public.source_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  source_record_id uuid not null unique,
  provider varchar(40) not null check (
    provider = lower(btrim(provider))
    and provider ~ '^[a-z][a-z0-9_-]{1,39}$'
  ),
  external_id varchar(500) check (
    external_id is null or char_length(btrim(external_id)) between 1 and 500
  ),
  import_hash varchar(64) not null check (import_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'succeeded' check (
    status in ('pending', 'processing', 'succeeded', 'failed')
  ),
  participants jsonb not null default '[]'::jsonb check (
    case jsonb_typeof(participants)
      when 'array' then jsonb_array_length(participants) <= 200
      else false
    end
  ),
  segment_count integer not null default 0 check (segment_count between 0 and 2000),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and not (metadata ?| array[
      'access_token', 'refresh_token', 'oauth_token', 'authorization', 'client_secret'
    ])
  ),
  error_code varchar(80),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_imports_source_project_fk
    foreign key (project_id, source_record_id)
    references public.source_records(project_id, id)
    on delete cascade,
  constraint source_imports_status_shape check (
    (status = 'failed' and error_code is not null)
    or (status <> 'failed' and error_code is null)
  ),
  unique (project_id, provider, import_hash)
);

comment on table public.source_imports is
  'Provenance for user-supplied exports and pasted context; no account connection is required.';
comment on column public.source_imports.metadata is
  'Non-secret import metadata. OAuth credentials and access tokens are prohibited.';

create table public.source_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  source_record_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 1999),
  speaker varchar(120) check (
    speaker is null or char_length(btrim(speaker)) between 1 and 120
  ),
  text text not null check (char_length(btrim(text)) between 1 and 100000),
  occurred_at timestamptz,
  external_id varchar(500) check (
    external_id is null or char_length(btrim(external_id)) between 1 and 500
  ),
  source_url text check (
    source_url is null
    or (char_length(source_url) <= 2048 and source_url ~ '^https://')
  ),
  created_at timestamptz not null default now(),
  constraint source_segments_source_project_fk
    foreign key (project_id, source_record_id)
    references public.source_records(project_id, id)
    on delete cascade,
  unique (source_record_id, ordinal),
  unique (project_id, id)
);

create table public.context_entities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type varchar(40) not null check (
    type = lower(btrim(type))
    and type ~ '^[a-z][a-z0-9_]{1,39}$'
  ),
  label varchar(200) not null check (char_length(btrim(label)) between 1 and 200),
  normalized_label varchar(200) not null check (
    normalized_label = lower(btrim(normalized_label))
    and char_length(normalized_label) between 1 and 200
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, type, normalized_label),
  unique (project_id, id)
);

create table public.context_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  entity_id uuid not null,
  alias varchar(200) not null check (char_length(btrim(alias)) between 1 and 200),
  normalized_alias varchar(200) not null check (
    normalized_alias = lower(btrim(normalized_alias))
    and char_length(normalized_alias) between 1 and 200
  ),
  created_at timestamptz not null default now(),
  constraint context_entity_aliases_entity_project_fk
    foreign key (project_id, entity_id)
    references public.context_entities(project_id, id)
    on delete cascade,
  unique (project_id, normalized_alias)
);

create table public.context_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  from_entity_id uuid not null,
  to_entity_id uuid not null,
  relation varchar(50) not null check (
    relation = lower(btrim(relation))
    and relation ~ '^[a-z][a-z0-9_]{1,49}$'
  ),
  source_segment_id uuid,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint context_edges_distinct_entities check (from_entity_id <> to_entity_id),
  constraint context_edges_from_entity_project_fk
    foreign key (project_id, from_entity_id)
    references public.context_entities(project_id, id)
    on delete cascade,
  constraint context_edges_to_entity_project_fk
    foreign key (project_id, to_entity_id)
    references public.context_entities(project_id, id)
    on delete cascade,
  constraint context_edges_segment_project_fk
    foreign key (project_id, source_segment_id)
    references public.source_segments(project_id, id)
    on delete cascade
);

create index analysis_run_sources_source_record_idx
  on public.analysis_run_sources(source_record_id)
  where source_record_id is not null;
create index share_links_created_by_idx on public.share_links(created_by);
create index source_imports_project_imported_idx
  on public.source_imports(project_id, imported_at desc);
create index source_imports_external_id_idx
  on public.source_imports(project_id, provider, external_id)
  where external_id is not null;
create index source_segments_project_source_idx
  on public.source_segments(project_id, source_record_id, ordinal);
create index context_entities_project_updated_idx
  on public.context_entities(project_id, updated_at desc);
create index context_aliases_entity_idx
  on public.context_entity_aliases(entity_id);
create unique index context_edges_identity_idx
  on public.context_edges(
    project_id, from_entity_id, to_entity_id, relation, source_segment_id
  ) nulls not distinct;
create index context_edges_project_to_idx
  on public.context_edges(project_id, to_entity_id);
create index context_edges_segment_idx
  on public.context_edges(source_segment_id)
  where source_segment_id is not null;

create trigger source_imports_set_updated_at
before update on public.source_imports
for each row execute function public.set_updated_at();
create trigger context_entities_set_updated_at
before update on public.context_entities
for each row execute function public.set_updated_at();
create trigger context_edges_set_updated_at
before update on public.context_edges
for each row execute function public.set_updated_at();

alter table public.source_imports enable row level security;
alter table public.source_segments enable row level security;
alter table public.context_entities enable row level security;
alter table public.context_entity_aliases enable row level security;
alter table public.context_edges enable row level security;

create policy source_imports_owner_select
on public.source_imports for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = source_imports.project_id and p.owner_id = (select auth.uid())
));

create policy source_segments_owner_select
on public.source_segments for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = source_segments.project_id and p.owner_id = (select auth.uid())
));

create policy context_entities_owner_select
on public.context_entities for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_entities.project_id and p.owner_id = (select auth.uid())
));
create policy context_entities_owner_insert
on public.context_entities for insert to authenticated
with check (exists (
  select 1 from public.projects p
  where p.id = context_entities.project_id and p.owner_id = (select auth.uid())
));
create policy context_entities_owner_update
on public.context_entities for update to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_entities.project_id and p.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.projects p
  where p.id = context_entities.project_id and p.owner_id = (select auth.uid())
));
create policy context_entities_owner_delete
on public.context_entities for delete to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_entities.project_id and p.owner_id = (select auth.uid())
));

create policy context_aliases_owner_select
on public.context_entity_aliases for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_entity_aliases.project_id and p.owner_id = (select auth.uid())
));
create policy context_aliases_owner_insert
on public.context_entity_aliases for insert to authenticated
with check (exists (
  select 1 from public.projects p
  where p.id = context_entity_aliases.project_id and p.owner_id = (select auth.uid())
));
create policy context_aliases_owner_update
on public.context_entity_aliases for update to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_entity_aliases.project_id and p.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.projects p
  where p.id = context_entity_aliases.project_id and p.owner_id = (select auth.uid())
));
create policy context_aliases_owner_delete
on public.context_entity_aliases for delete to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_entity_aliases.project_id and p.owner_id = (select auth.uid())
));

create policy context_edges_owner_select
on public.context_edges for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_edges.project_id and p.owner_id = (select auth.uid())
));
create policy context_edges_owner_insert
on public.context_edges for insert to authenticated
with check (exists (
  select 1 from public.projects p
  where p.id = context_edges.project_id and p.owner_id = (select auth.uid())
));
create policy context_edges_owner_update
on public.context_edges for update to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_edges.project_id and p.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.projects p
  where p.id = context_edges.project_id and p.owner_id = (select auth.uid())
));
create policy context_edges_owner_delete
on public.context_edges for delete to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = context_edges.project_id and p.owner_id = (select auth.uid())
));

create function public.import_source_context(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_content text,
  p_provider text,
  p_external_id text default null,
  p_occurred_at timestamptz default null,
  p_participants jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_segments jsonb default '[]'::jsonb
)
returns table(
  source jsonb,
  import_id uuid,
  provider text,
  participants jsonb,
  segment_count integer,
  imported_at timestamptz,
  metadata jsonb,
  duplicate boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_kind text := lower(btrim(p_kind));
  v_title text := btrim(p_title);
  v_provider text := lower(btrim(p_provider));
  v_external_id text := nullif(btrim(p_external_id), '');
  v_import_hash varchar(64);
  v_participants jsonb := coalesce(p_participants, '[]'::jsonb);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_segments jsonb := coalesce(p_segments, '[]'::jsonb);
  v_source public.source_records;
  v_import public.source_imports;
  v_segment jsonb;
  v_segment_text text;
  v_segment_speaker text;
  v_segment_occurred_at text;
  v_segment_external_id text;
  v_segment_source_url text;
  v_segment_count integer;
  v_total_segment_chars integer := 0;
begin
  if v_user_id is null then
    raise insufficient_privilege;
  end if;

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.owner_id = v_user_id
      and p.archived_at is null
  ) then
    raise insufficient_privilege;
  end if;

  if v_kind is null or v_kind not in ('meeting', 'research', 'feedback', 'note') then
    raise exception 'INVALID_SOURCE_KIND';
  end if;
  if v_title is null or char_length(v_title) not between 1 and 120 then
    raise exception 'INVALID_SOURCE_TITLE';
  end if;
  if p_content is null or char_length(p_content) not between 1 and 100000 then
    raise exception 'INVALID_SOURCE_CONTENT';
  end if;
  if v_provider is null or v_provider !~ '^[a-z][a-z0-9_-]{1,39}$' then
    raise exception 'INVALID_IMPORT_PROVIDER';
  end if;
  if p_external_id is not null and v_external_id is null then
    raise exception 'INVALID_EXTERNAL_ID';
  end if;
  if v_external_id is not null and char_length(v_external_id) > 500 then
    raise exception 'INVALID_EXTERNAL_ID';
  end if;
  if jsonb_typeof(v_participants) <> 'array' then
    raise exception 'INVALID_PARTICIPANTS';
  end if;
  if jsonb_array_length(v_participants) > 200
     or octet_length(v_participants::text) > 32768 then
    raise exception 'INVALID_PARTICIPANTS';
  end if;
  if jsonb_typeof(v_metadata) <> 'object'
     or octet_length(v_metadata::text) > 65536
     or v_metadata ?| array[
       'access_token', 'refresh_token', 'oauth_token', 'authorization', 'client_secret'
     ] then
    raise exception 'INVALID_IMPORT_METADATA';
  end if;
  if jsonb_typeof(v_segments) <> 'array' then
    raise exception 'INVALID_SOURCE_SEGMENTS';
  end if;
  if jsonb_array_length(v_segments) > 2000 then
    raise exception 'INVALID_SOURCE_SEGMENTS';
  end if;

  for v_segment in
    select item.value from jsonb_array_elements(v_segments) as item(value)
  loop
    if jsonb_typeof(v_segment) <> 'object' then
      raise exception 'INVALID_SOURCE_SEGMENT';
    end if;

    v_segment_text := v_segment ->> 'text';
    v_segment_speaker := v_segment ->> 'speaker';
    v_segment_occurred_at := coalesce(
      v_segment ->> 'occurredAt', v_segment ->> 'occurred_at'
    );
    v_segment_external_id := coalesce(
      v_segment ->> 'externalId', v_segment ->> 'external_id'
    );
    v_segment_source_url := coalesce(
      v_segment ->> 'sourceUrl', v_segment ->> 'source_url'
    );

    if v_segment_text is null
       or char_length(btrim(v_segment_text)) not between 1 and 100000
       or strpos(p_content, v_segment_text) = 0 then
      raise exception 'INVALID_SOURCE_SEGMENT_TEXT';
    end if;
    v_total_segment_chars := v_total_segment_chars + char_length(v_segment_text);
    if v_total_segment_chars > 100000 then
      raise exception 'SOURCE_SEGMENTS_TOO_LARGE';
    end if;
    if v_segment_speaker is not null
       and char_length(btrim(v_segment_speaker)) not between 1 and 120 then
      raise exception 'INVALID_SEGMENT_SPEAKER';
    end if;
    if v_segment_external_id is not null
       and char_length(btrim(v_segment_external_id)) not between 1 and 500 then
      raise exception 'INVALID_SEGMENT_EXTERNAL_ID';
    end if;
    if v_segment_source_url is not null
       and (char_length(v_segment_source_url) > 2048 or v_segment_source_url !~ '^https://') then
      raise exception 'INVALID_SEGMENT_SOURCE_URL';
    end if;
    if v_segment_occurred_at is not null then
      begin
        perform v_segment_occurred_at::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'INVALID_SEGMENT_OCCURRED_AT';
      end;
    end if;
  end loop;

  v_import_hash := encode(extensions.digest(p_content, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_project_id::text || ':' || v_provider || ':' || v_import_hash,
      0
    )
  );

  select s.* into v_source
  from public.source_imports i
  join public.source_records s on s.id = i.source_record_id
  where i.project_id = p_project_id
    and i.provider = v_provider
    and i.import_hash = v_import_hash;

  if found then
    select * into v_import
    from public.source_imports i
    where i.project_id = p_project_id
      and i.provider = v_provider
      and i.import_hash = v_import_hash;

    return query select
      to_jsonb(v_source), v_import.id, v_import.provider::text, v_import.participants,
      v_import.segment_count, v_import.imported_at, v_import.metadata, true;
    return;
  end if;

  insert into public.source_records(
    project_id, kind, title, content, content_sha256, char_count, occurred_at
  ) values (
    p_project_id, v_kind, v_title, p_content, v_import_hash,
    char_length(p_content), p_occurred_at
  ) returning * into v_source;

  v_segment_count := case
    when jsonb_array_length(v_segments) = 0 then 1
    else jsonb_array_length(v_segments)
  end;

  insert into public.source_imports(
    project_id, source_record_id, provider, external_id, import_hash, status,
    participants, segment_count, metadata
  ) values (
    p_project_id, v_source.id, v_provider, v_external_id, v_import_hash, 'succeeded',
    v_participants, v_segment_count, v_metadata
  ) returning * into v_import;

  if jsonb_array_length(v_segments) = 0 then
    insert into public.source_segments(
      project_id, source_record_id, ordinal, text, occurred_at, external_id
    ) values (
      p_project_id, v_source.id, 0, p_content, p_occurred_at, v_external_id
    );
  else
    insert into public.source_segments(
      project_id, source_record_id, ordinal, speaker, text, occurred_at,
      external_id, source_url
    )
    select
      p_project_id,
      v_source.id,
      (item.ordinality - 1)::integer,
      nullif(btrim(item.value ->> 'speaker'), ''),
      item.value ->> 'text',
      nullif(coalesce(
        item.value ->> 'occurredAt', item.value ->> 'occurred_at'
      ), '')::timestamptz,
      nullif(btrim(coalesce(
        item.value ->> 'externalId', item.value ->> 'external_id'
      )), ''),
      nullif(btrim(coalesce(
        item.value ->> 'sourceUrl', item.value ->> 'source_url'
      )), '')
    from jsonb_array_elements(v_segments) with ordinality as item(value, ordinality);
  end if;

  return query select
    to_jsonb(v_source), v_import.id, v_import.provider::text, v_import.participants,
    v_import.segment_count, v_import.imported_at, v_import.metadata, false;
end;
$$;

revoke all on function public.import_source_context(
  uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.import_source_context(
  uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) to authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from PUBLIC, anon, authenticated';
  end if;
end;
$$;

revoke all on table public.source_imports, public.source_segments,
  public.context_entities, public.context_entity_aliases, public.context_edges
  from anon, authenticated;
grant select on table public.source_imports, public.source_segments to authenticated;
grant select, insert, update, delete on table public.context_entities,
  public.context_entity_aliases, public.context_edges to authenticated;
grant all on table public.source_imports, public.source_segments,
  public.context_entities, public.context_entity_aliases, public.context_edges
  to service_role;
