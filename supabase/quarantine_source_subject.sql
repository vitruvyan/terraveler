-- Phase 3B.3: Atomic Quarantine Transaction RPC (Hardened Sealing)
-- Safely quarantines a subject when material drift is detected,
-- clearing active trust_mode, incrementing reverification_generation,
-- and inserting append-only completion events with a safe search_path.

create or replace function quarantine_source_subject(
  p_drift_evaluation_id bigint,
  p_expected_hash text,
  p_reason text
)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_reverification_id bigint;
  v_subject_type text;
  v_subject_id bigint;
  v_recommended_action text;
  v_current_status text;
  v_rows_affected integer;
begin
  -- 1. Read Persisted Drift Evaluation and Verify TOCTOU/Authority Integrity
  select reverification_id, subject_type, subject_id, recommended_action
  into v_reverification_id, v_subject_type, v_subject_id, v_recommended_action
  from public.source_drift_evaluations
  where id = p_drift_evaluation_id and evaluation_hash = p_expected_hash;
  
  if not found then
    raise exception 'TOCTOU_VIOLATION: DriftEvaluation % with matching hash % not found', p_drift_evaluation_id, p_expected_hash;
  end if;
  
  if v_recommended_action != 'QUARANTINE_AND_REEVALUATE' then
    raise exception 'AUTHORIZATION_VIOLATION: DriftEvaluation % action is %, cannot authorize quarantine', p_drift_evaluation_id, v_recommended_action;
  end if;

  -- 2. Verify Current Subject Lifecycle State is Eligible for Quarantine
  if v_subject_type = 'endpoint' then
    select status into v_current_status from public.source_endpoints where id = v_subject_id;
  elif v_subject_type = 'collection' then
    select status into v_current_status from public.source_collections where id = v_subject_id;
  else
    raise exception 'CONSISTENCY_VIOLATION: Invalid subject type %', v_subject_type;
  end if;

  if v_current_status not in ('active', 'needs_human_review', 'quarantined') then
    raise exception 'LIFECYCLE_VIOLATION: Subject is currently in %, cannot transition to quarantined', v_current_status;
  end if;

  -- 3. Execute Atomic Lifecycle State Mutation, Clear Trust Mode, and Increment Generation (TOCTOU Safety)
  if v_subject_type = 'endpoint' then
    update public.source_endpoints 
    set status = 'quarantined', 
        trust_mode = null,
        reverification_generation = reverification_generation + 1,
        last_verified_at = now()
    where id = v_subject_id;
    get diagnostics v_rows_affected = row_count;
    
  elif v_subject_type = 'collection' then
    update public.source_collections 
    set status = 'quarantined', 
        trust_mode = null,
        reverification_generation = reverification_generation + 1,
        last_verified_at = now()
    where id = v_subject_id;
    get diagnostics v_rows_affected = row_count;
  end if;

  if v_rows_affected != 1 then
    raise exception 'CONCURRENCY_VIOLATION: Expected exactly 1 subject row to be updated, affected %', v_rows_affected;
  end if;

  -- 4. Insert Append-Only Progress Events (Never update base reverification record)
  insert into public.source_reverification_events (reverification_id, event_type, metadata)
  values (v_reverification_id, 'quarantined', jsonb_build_object('reason', p_reason, 'drift_evaluation_id', p_drift_evaluation_id));

  insert into public.source_reverification_events (reverification_id, event_type, metadata)
  values (v_reverification_id, 'completed', jsonb_build_object('evaluation_hash', p_expected_hash));
end $$;

-- Restrict execution to the backend service role
revoke execute on function quarantine_source_subject from public, terraveler_anon;
grant execute on function quarantine_source_subject to terraveler_service;
