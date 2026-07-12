-- Expand phase: add service-role-only replacements for the final authenticated
-- mutation RPCs without revoking the compatibility functions yet.
-- The Node BFF supplies the authenticated user id after validating its HttpOnly
-- cookie session; each function rechecks ownership before mutating data.

begin;

create function public.app_import_source_context(
  p_user_id uuid,
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
security invoker
set search_path = ''
as $$
declare
  v_kind text := pg_catalog.lower(pg_catalog.btrim(p_kind));
  v_title text := pg_catalog.btrim(p_title);
  v_provider text := pg_catalog.lower(pg_catalog.btrim(p_provider));
  v_external_id text := nullif(pg_catalog.btrim(p_external_id), '');
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
  if p_user_id is null then
    raise insufficient_privilege;
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_id = p_user_id
      and p.archived_at is null
  ) then
    raise insufficient_privilege;
  end if;

  if v_kind is null or v_kind not in ('meeting', 'research', 'feedback', 'note') then
    raise exception 'INVALID_SOURCE_KIND';
  end if;
  if v_title is null or pg_catalog.char_length(v_title) not between 1 and 120 then
    raise exception 'INVALID_SOURCE_TITLE';
  end if;
  if p_content is null or pg_catalog.char_length(p_content) not between 1 and 100000 then
    raise exception 'INVALID_SOURCE_CONTENT';
  end if;
  if v_provider is null
     or v_provider not in ('kakaotalk', 'teams', 'notion', 'paste') then
    raise exception 'INVALID_IMPORT_PROVIDER';
  end if;
  if p_external_id is not null and v_external_id is null then
    raise exception 'INVALID_EXTERNAL_ID';
  end if;
  if v_external_id is not null and pg_catalog.char_length(v_external_id) > 500 then
    raise exception 'INVALID_EXTERNAL_ID';
  end if;
  if pg_catalog.jsonb_typeof(v_participants) <> 'array' then
    raise exception 'INVALID_PARTICIPANTS';
  end if;
  if pg_catalog.jsonb_array_length(v_participants) > 200
     or pg_catalog.octet_length(v_participants::text) > 32768 then
    raise exception 'INVALID_PARTICIPANTS';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_participants) as participant(value)
    where pg_catalog.jsonb_typeof(participant.value) <> 'string'
      or pg_catalog.char_length(pg_catalog.btrim(participant.value #>> '{}')) not between 1 and 120
  ) then
    raise exception 'INVALID_PARTICIPANTS';
  end if;
  if pg_catalog.jsonb_typeof(v_metadata) <> 'object'
     or pg_catalog.octet_length(v_metadata::text) > 65536
     or v_metadata ?| array[
       'access_token', 'refresh_token', 'oauth_token', 'authorization', 'client_secret'
     ] then
    raise exception 'INVALID_IMPORT_METADATA';
  end if;
  if pg_catalog.jsonb_typeof(v_segments) <> 'array' then
    raise exception 'INVALID_SOURCE_SEGMENTS';
  end if;
  if pg_catalog.jsonb_array_length(v_segments) > 2000 then
    raise exception 'INVALID_SOURCE_SEGMENTS';
  end if;

  for v_segment in
    select item.value
    from pg_catalog.jsonb_array_elements(v_segments) as item(value)
  loop
    if pg_catalog.jsonb_typeof(v_segment) <> 'object' then
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
       or pg_catalog.char_length(pg_catalog.btrim(v_segment_text)) not between 1 and 100000
       or pg_catalog.strpos(p_content, v_segment_text) = 0 then
      raise exception 'INVALID_SOURCE_SEGMENT_TEXT';
    end if;
    v_total_segment_chars := v_total_segment_chars + pg_catalog.char_length(v_segment_text);
    if v_total_segment_chars > 100000 then
      raise exception 'SOURCE_SEGMENTS_TOO_LARGE';
    end if;
    if v_segment_speaker is not null
       and pg_catalog.char_length(pg_catalog.btrim(v_segment_speaker)) not between 1 and 120 then
      raise exception 'INVALID_SEGMENT_SPEAKER';
    end if;
    if v_segment_external_id is not null
       and pg_catalog.char_length(pg_catalog.btrim(v_segment_external_id)) not between 1 and 500 then
      raise exception 'INVALID_SEGMENT_EXTERNAL_ID';
    end if;
    if v_segment_source_url is not null
       and (
         pg_catalog.char_length(v_segment_source_url) > 2048
         or v_segment_source_url !~ '^https://'
       ) then
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

  v_content_hash := pg_catalog.encode(extensions.digest(p_content, 'sha256'), 'hex');
  v_import_hash := pg_catalog.encode(extensions.digest(
    case
      when v_external_id is null then pg_catalog.convert_to(p_content, 'UTF8')
      else pg_catalog.convert_to(v_external_id, 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(p_content, 'UTF8')
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
    select i.* into v_import
    from public.source_imports i
    where i.project_id = p_project_id
      and i.provider = v_provider
      and i.import_hash = v_import_hash;

    update public.source_records s
    set title = v_title,
        archived_at = null
    where s.id = v_source.id
    returning s.* into v_source;

    return query select
      pg_catalog.to_jsonb(v_source), v_import.id, v_import.provider::text,
      v_import.participants, v_import.segment_count, v_import.imported_at,
      v_import.metadata, true;
    return;
  end if;

  insert into public.source_records(
    project_id, kind, title, content, content_sha256, char_count, occurred_at
  ) values (
    p_project_id, v_kind, v_title, p_content, v_content_hash,
    pg_catalog.char_length(p_content), p_occurred_at
  ) returning * into v_source;

  v_segment_count := case
    when pg_catalog.jsonb_array_length(v_segments) = 0 then 1
    else pg_catalog.jsonb_array_length(v_segments)
  end;

  insert into public.source_imports(
    project_id, source_record_id, provider, external_id, import_hash, status,
    participants, segment_count, metadata
  ) values (
    p_project_id, v_source.id, v_provider, v_external_id, v_import_hash, 'succeeded',
    v_participants, v_segment_count, v_metadata
  ) returning * into v_import;

  if pg_catalog.jsonb_array_length(v_segments) = 0 then
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
      nullif(pg_catalog.btrim(item.value ->> 'speaker'), ''),
      item.value ->> 'text',
      nullif(coalesce(
        item.value ->> 'occurredAt', item.value ->> 'occurred_at'
      ), '')::timestamptz,
      nullif(pg_catalog.btrim(coalesce(
        item.value ->> 'externalId', item.value ->> 'external_id'
      )), ''),
      nullif(pg_catalog.btrim(coalesce(
        item.value ->> 'sourceUrl', item.value ->> 'source_url'
      )), '')
    from pg_catalog.jsonb_array_elements(v_segments)
      with ordinality as item(value, ordinality);
  end if;

  return query select
    pg_catalog.to_jsonb(v_source), v_import.id, v_import.provider::text,
    v_import.participants, v_import.segment_count, v_import.imported_at,
    v_import.metadata, false;
end;
$$;

create function public.app_create_analysis_run_annotation(
  p_user_id uuid,
  p_analysis_run_id uuid,
  p_idempotency_key text,
  p_annotation_type text,
  p_target_type text,
  p_target_id text,
  p_body text
)
returns table(outcome text, annotation jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.analysis_runs;
  v_existing public.analysis_run_annotations;
  v_created public.analysis_run_annotations;
  v_idempotency_key text := pg_catalog.btrim(coalesce(p_idempotency_key, ''));
  v_target_id text := nullif(pg_catalog.btrim(coalesce(p_target_id, '')), '');
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_items jsonb;
  v_fingerprint text;
begin
  if p_user_id is null then
    raise insufficient_privilege;
  end if;
  if pg_catalog.char_length(v_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_ANNOTATION_IDEMPOTENCY_KEY';
  end if;
  if p_annotation_type not in ('confirmation', 'correction', 'question', 'note') then
    raise exception 'INVALID_ANNOTATION_TYPE';
  end if;
  if p_target_type not in (
    'run', 'decision', 'participant', 'question', 'term',
    'knowledge_node', 'participant_view'
  ) then
    raise exception 'INVALID_ANNOTATION_TARGET';
  end if;
  if pg_catalog.char_length(v_body) not between 1 and 2000 then
    raise exception 'INVALID_ANNOTATION_BODY';
  end if;
  if (p_target_type = 'run' and v_target_id is not null)
     or (p_target_type <> 'run' and v_target_id is null) then
    raise exception 'INVALID_ANNOTATION_TARGET';
  end if;
  if v_target_id is not null and pg_catalog.char_length(v_target_id) > 160 then
    raise exception 'INVALID_ANNOTATION_TARGET';
  end if;

  select r.* into v_run
  from public.analysis_runs r
  join public.projects p on p.id = r.project_id
  where r.id = p_analysis_run_id
    and r.created_by = p_user_id
    and p.owner_id = p_user_id
    and p.archived_at is null;
  if not found then
    raise insufficient_privilege;
  end if;
  if v_run.status <> 'succeeded' then
    raise exception 'RUN_NOT_ANNOTATABLE';
  end if;

  if p_target_type <> 'run' then
    v_items := case p_target_type
      when 'decision' then v_run.result_jsonb -> 'decisions'
      when 'participant' then v_run.result_jsonb -> 'participants'
      when 'question' then v_run.result_jsonb -> 'questions'
      when 'term' then v_run.result_jsonb -> 'keyTerms'
      when 'knowledge_node' then v_run.result_jsonb #> '{knowledgeMap,nodes}'
      when 'participant_view' then v_run.result_jsonb #> '{participantAgents,views}'
      else '[]'::jsonb
    end;
    if coalesce(pg_catalog.jsonb_typeof(v_items), 'null') <> 'array' then
      raise exception 'ANNOTATION_TARGET_NOT_FOUND';
    end if;
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_items) item
      where item ->> 'id' = v_target_id
    ) then
      raise exception 'ANNOTATION_TARGET_NOT_FOUND';
    end if;
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'annotationType', p_annotation_type,
          'targetType', p_target_type,
          'targetId', v_target_id,
          'body', v_body
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select a.* into v_existing
  from public.analysis_run_annotations a
  where a.analysis_run_id = p_analysis_run_id
    and a.created_by = p_user_id
    and a.idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select 'reused'::text, pg_catalog.to_jsonb(v_existing);
    return;
  end if;

  begin
    insert into public.analysis_run_annotations(
      analysis_run_id, created_by, idempotency_key, request_fingerprint,
      annotation_type, target_type, target_id, body
    ) values (
      p_analysis_run_id, p_user_id, v_idempotency_key, v_fingerprint,
      p_annotation_type, p_target_type, v_target_id, v_body
    ) returning * into v_created;
  exception when unique_violation then
    select a.* into v_existing
    from public.analysis_run_annotations a
    where a.analysis_run_id = p_analysis_run_id
      and a.created_by = p_user_id
      and a.idempotency_key = v_idempotency_key;
    if not found or v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select 'reused'::text, pg_catalog.to_jsonb(v_existing);
    return;
  end;

  return query select 'created'::text, pg_catalog.to_jsonb(v_created);
end;
$$;

revoke all on function public.app_import_source_context(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.app_import_source_context(
  uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb
) to service_role;

revoke all on function public.app_create_analysis_run_annotation(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.app_create_analysis_run_annotation(
  uuid, uuid, text, text, text, text, text
) to service_role;

commit;
