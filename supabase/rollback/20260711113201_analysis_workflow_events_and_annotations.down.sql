-- LOCAL/EMPTY DATABASE ONLY. Production rollback uses restore or forward-fix.
-- Roll back the matching 20260711113201 migration atomically.
begin;

drop function if exists public.create_analysis_run_annotation(
  uuid, text, text, text, text, text
);

drop trigger if exists analysis_annotations_prevent_update
  on public.analysis_run_annotations;
drop trigger if exists analysis_step_events_prevent_update
  on public.analysis_run_step_events;
drop function if exists public.prevent_analysis_artifact_update();

drop table if exists public.analysis_run_annotations;
drop table if exists public.analysis_run_step_events;

commit;
