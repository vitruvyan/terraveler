-- Phase 3B.3: Atomic Quarantine Transaction RPC
-- Safely quarantines a subject when material drift is detected,
-- clearing active trust_mode and setting operational lifecycle state to quarantined.

create or replace function quarantine_source_subject(
  p_subject_type text,
  p_subject_id bigint,
  p_reverification_id bigint,
  p_reason text
)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- Validate subject binding of the reverification artifact
  if not exists (
    select 1 from public.source_reverifications 
    where id = p_reverification_id and subject_type = p_subject_type and subject_id = p_subject_id
  ) then
    raise exception 'SUBJECT_BINDING_VIOLATION: Reverification % does not match subject (%, %)', 
      p_reverification_id, p_subject_type, p_subject_id;
  end if;

  -- 1. Enforce atomic operational lifecycle mutation and clear trust_mode
  if p_subject_type = 'endpoint' then
    update public.source_endpoints 
    set status = 'quarantined', trust_mode = null
    where id = p_subject_id;
  elif p_subject_type = 'collection' then
    update public.source_collections 
    set status = 'quarantined', trust_mode = null
    where id = p_subject_id;
  else
    raise exception 'CONSISTENCY_VIOLATION: Invalid subject type %', p_subject_type;
  end if;

  -- 2. Update reverification completed status
  update public.source_reverifications
  set status = 'completed', completed_at = now()
  where id = p_reverification_id;
end $$;

-- Restrict execution to the backend service role
revoke execute on function quarantine_source_subject from public, terraveler_anon;
grant execute on function quarantine_source_subject to terraveler_service;
