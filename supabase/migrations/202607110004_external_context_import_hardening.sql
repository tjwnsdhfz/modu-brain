create or replace function public.prevent_imported_source_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    new.kind is distinct from old.kind
    or new.content is distinct from old.content
    or new.content_sha256 is distinct from old.content_sha256
    or new.char_count is distinct from old.char_count
    or new.occurred_at is distinct from old.occurred_at
  ) and exists (
    select 1 from public.source_imports i where i.source_record_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'IMPORTED_SOURCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_imported_source_mutation()
  from public, anon, authenticated;

drop trigger if exists source_records_prevent_imported_mutation on public.source_records;
create trigger source_records_prevent_imported_mutation
before update of kind, content, content_sha256, char_count, occurred_at
on public.source_records
for each row execute function public.prevent_imported_source_mutation();

alter table public.source_imports
  drop constraint if exists source_imports_provider_check;
alter table public.source_imports
  add constraint source_imports_provider_check
  check (provider in ('kakaotalk', 'teams', 'notion', 'paste'));

-- Existing 002 rows used a content-only import hash. Preserve idempotency by
-- backfilling external imports before the replacement RPC starts serving traffic.
update public.source_imports i
set import_hash = encode(extensions.digest(
  convert_to(btrim(i.external_id), 'UTF8')
    || decode('00', 'hex')
    || convert_to(s.content, 'UTF8'),
  'sha256'
), 'hex')
from public.source_records s
where s.id = i.source_record_id
  and i.external_id is not null
  and i.import_hash <> encode(extensions.digest(
    convert_to(btrim(i.external_id), 'UTF8')
      || decode('00', 'hex')
      || convert_to(s.content, 'UTF8'),
    'sha256'
  ), 'hex');

create or replace function public.import_source_context(
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
  v_content_hash varchar(64);
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
  if v_provider is null
     or v_provider not in ('kakaotalk', 'teams', 'notion', 'paste') then
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
  if exists (
    select 1
    from jsonb_array_elements(v_participants) as participant(value)
    where jsonb_typeof(participant.value) <> 'string'
      or char_length(btrim(participant.value #>> '{}')) not between 1 and 120
  ) then
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

  v_content_hash := encode(extensions.digest(p_content, 'sha256'), 'hex');
  v_import_hash := encode(extensions.digest(
    case
      when v_external_id is null then convert_to(p_content, 'UTF8')
      else convert_to(v_external_id, 'UTF8')
        || decode('00', 'hex')
        || convert_to(p_content, 'UTF8')
    end,
    'sha256'
  ), 'hex');
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

    update public.source_records
    set title = v_title,
        archived_at = null
    where id = v_source.id
    returning * into v_source;

    return query select
      to_jsonb(v_source), v_import.id, v_import.provider::text, v_import.participants,
      v_import.segment_count, v_import.imported_at, v_import.metadata, true;
    return;
  end if;

  insert into public.source_records(
    project_id, kind, title, content, content_sha256, char_count, occurred_at
  ) values (
    p_project_id, v_kind, v_title, p_content, v_content_hash,
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
