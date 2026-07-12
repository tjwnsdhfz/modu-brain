-- Version matches the migration recorded by the Supabase demo project.
create table public.analysis_run_step_events (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 32),
  event_key varchar(80) not null check (event_key ~ '^[a-z][a-z0-9:_-]{2,79}$'),
  step_name text not null check (
    step_name in ('source_snapshot', 'provider_analysis', 'evidence_validation', 'result_persistence')
  ),
  status text not null check (status in ('started', 'succeeded', 'failed', 'cancelled')),
  validation_outcome text check (validation_outcome in ('passed', 'failed')),
  code varchar(80) check (code is null or code ~ '^[A-Z0-9_]{3,80}$'),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  source_count smallint check (source_count is null or source_count between 0 and 50),
  input_characters integer check (
    input_characters is null or input_characters between 0 and 100000
  ),
  output_item_count integer check (output_item_count is null or output_item_count >= 0),
  evidence_reference_count integer check (
    evidence_reference_count is null or evidence_reference_count >= 0
  ),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, sequence),
  unique (analysis_run_id, event_key),
  constraint analysis_step_event_shape check (
    (status = 'started' and duration_ms is null and validation_outcome is null and code is null)
    or (status = 'succeeded' and code is not null)
    or (status in ('failed', 'cancelled') and code is not null)
  ),
  constraint analysis_step_validation_shape check (
    (step_name <> 'evidence_validation' and validation_outcome is null)
    or (
      step_name = 'evidence_validation'
      and (
        (status = 'started' and validation_outcome is null)
        or (status = 'succeeded' and validation_outcome = 'passed')
        or (status = 'failed' and validation_outcome = 'failed')
        or (status = 'cancelled' and validation_outcome is null)
      )
    )
  )
);

create table public.analysis_run_annotations (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  idempotency_key varchar(128) not null check (
    char_length(idempotency_key) between 8 and 128
  ),
  request_fingerprint varchar(64) not null check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  annotation_type text not null check (
    annotation_type in ('confirmation', 'correction', 'question', 'note')
  ),
  target_type text not null check (
    target_type in (
      'run', 'decision', 'participant', 'question', 'term',
      'knowledge_node', 'participant_view'
    )
  ),
  target_id varchar(160),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, created_by, idempotency_key),
  constraint analysis_annotation_target_shape check (
    (target_type = 'run' and target_id is null)
    or (
      target_type <> 'run'
      and target_id is not null
      and char_length(btrim(target_id)) between 1 and 160
    )
  )
);

create index analysis_annotations_run_creator_created_idx
  on public.analysis_run_annotations(analysis_run_id, created_by, created_at desc);
create index analysis_annotations_creator_idx
  on public.analysis_run_annotations(created_by);

create function public.prevent_analysis_artifact_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ANALYSIS_ARTIFACT_IMMUTABLE' using errcode = '23514';
end;
$$;

create trigger analysis_step_events_prevent_update
before update on public.analysis_run_step_events
for each row execute function public.prevent_analysis_artifact_update();

create trigger analysis_annotations_prevent_update
before update on public.analysis_run_annotations
for each row execute function public.prevent_analysis_artifact_update();

create function public.create_analysis_run_annotation(
  p_analysis_run_id uuid,
  p_idempotency_key text,
  p_annotation_type text,
  p_target_type text,
  p_target_id text,
  p_body text
)
returns table(outcome text, annotation jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_run public.analysis_runs;
  v_existing public.analysis_run_annotations;
  v_created public.analysis_run_annotations;
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_target_id text := nullif(btrim(coalesce(p_target_id, '')), '');
  v_body text := btrim(coalesce(p_body, ''));
  v_items jsonb;
  v_fingerprint text;
begin
  if v_user_id is null then
    raise insufficient_privilege;
  end if;
  if char_length(v_idempotency_key) not between 8 and 128 then
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
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'INVALID_ANNOTATION_BODY';
  end if;
  if (p_target_type = 'run' and v_target_id is not null)
     or (p_target_type <> 'run' and v_target_id is null) then
    raise exception 'INVALID_ANNOTATION_TARGET';
  end if;
  if v_target_id is not null and char_length(v_target_id) > 160 then
    raise exception 'INVALID_ANNOTATION_TARGET';
  end if;

  select r.* into v_run
  from public.analysis_runs r
  join public.projects p on p.id = r.project_id
  where r.id = p_analysis_run_id
    and r.created_by = v_user_id
    and p.owner_id = v_user_id
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
    if coalesce(jsonb_typeof(v_items), 'null') <> 'array' then
      raise exception 'ANNOTATION_TARGET_NOT_FOUND';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(v_items) item
      where item ->> 'id' = v_target_id
    ) then
      raise exception 'ANNOTATION_TARGET_NOT_FOUND';
    end if;
  end if;

  v_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
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

  select * into v_existing
  from public.analysis_run_annotations a
  where a.analysis_run_id = p_analysis_run_id
    and a.created_by = v_user_id
    and a.idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select 'reused'::text, to_jsonb(v_existing);
    return;
  end if;

  begin
    insert into public.analysis_run_annotations(
      analysis_run_id, created_by, idempotency_key, request_fingerprint,
      annotation_type, target_type, target_id, body
    ) values (
      p_analysis_run_id, v_user_id, v_idempotency_key, v_fingerprint,
      p_annotation_type, p_target_type, v_target_id, v_body
    ) returning * into v_created;
  exception when unique_violation then
    select * into v_existing
    from public.analysis_run_annotations a
    where a.analysis_run_id = p_analysis_run_id
      and a.created_by = v_user_id
      and a.idempotency_key = v_idempotency_key;
    if not found or v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select 'reused'::text, to_jsonb(v_existing);
    return;
  end;

  return query select 'created'::text, to_jsonb(v_created);
end;
$$;

alter table public.analysis_run_step_events enable row level security;
alter table public.analysis_run_annotations enable row level security;

create policy analysis_step_events_owner_select
on public.analysis_run_step_events for select to authenticated
using (exists (
  select 1
  from public.analysis_runs r
  join public.projects p on p.id = r.project_id
  where r.id = analysis_run_step_events.analysis_run_id
    and r.created_by = (select auth.uid())
    and p.owner_id = (select auth.uid())
));

create policy analysis_annotations_owner_select
on public.analysis_run_annotations for select to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.analysis_runs r
    join public.projects p on p.id = r.project_id
    where r.id = analysis_run_annotations.analysis_run_id
      and r.created_by = (select auth.uid())
      and p.owner_id = (select auth.uid())
  )
);

revoke all on function public.prevent_analysis_artifact_update()
  from public, anon, authenticated;
revoke all on function public.create_analysis_run_annotation(
  uuid, text, text, text, text, text
) from public, anon;
grant execute on function public.create_analysis_run_annotation(
  uuid, text, text, text, text, text
) to authenticated;

revoke all on table public.analysis_run_step_events, public.analysis_run_annotations
  from public, anon, authenticated;
grant select on table public.analysis_run_step_events, public.analysis_run_annotations
  to authenticated;
grant all on table public.analysis_run_step_events, public.analysis_run_annotations
  to service_role;
