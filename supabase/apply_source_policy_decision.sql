-- Phase 3B.2: Atomic Policy Application and Lifecycle Engine RPC
-- Enforces strict TOCTOU checks, database consistency checks,
-- and atomic database-side lifecycle mutations.

create or replace function apply_source_policy_decision(
  p_subject_type text,
  p_subject_id bigint,
  p_verified_evidence_id bigint,
  p_expected_evidence_hash text,
  p_decision_outcome text,
  p_trust_mode text,
  p_rule_id text,
  p_policy_version text,
  p_verification_version text,
  p_evidence_snapshot jsonb,
  p_reason text,
  p_decider_type text,
  p_decider_id bigint,
  p_supersedes_decision_id bigint default null
)
returns bigint language plpgsql security definer as $$
declare
  v_evidence_hash text;
  v_verifier_version text;
  v_old_endpoint_id bigint := null;
  v_old_collection_id bigint := null;
  v_old_proposal_id bigint := null;
  v_decision_id bigint;
  v_endpoint_id bigint := null;
  v_collection_id bigint := null;
  v_proposal_id bigint := null;
begin
  -- --------------------------------------------------------------------------
  -- 1. TOCTOU & Version Verification
  -- --------------------------------------------------------------------------
  select evidence_hash, verifier_version into v_evidence_hash, v_verifier_version
  from source_verified_evidence
  where id = p_verified_evidence_id;
  
  if not found then
    raise exception 'TOCTOU_VIOLATION: VerifiedEvidence % not found', p_verified_evidence_id;
  end if;
  
  if v_evidence_hash != p_expected_evidence_hash then
    raise exception 'TOCTOU_VIOLATION: Evidence hash mismatch. Expected %, stored %', p_expected_evidence_hash, v_evidence_hash;
  end if;
  
  if v_verifier_version != p_verification_version then
    raise exception 'TOCTOU_VIOLATION: Verifier version mismatch. Expected %, stored %', p_verification_version, v_verifier_version;
  end if;
  
  if p_policy_version != 'SG-P1' then
    raise exception 'TOCTOU_VIOLATION: Unsupported policy version: %', p_policy_version;
  end if;

  -- --------------------------------------------------------------------------
  -- 2. DB-level Consistency & Actor Checks
  -- --------------------------------------------------------------------------
  if p_decision_outcome = 'approve' and p_trust_mode is null then
    raise exception 'CONSISTENCY_VIOLATION: APPROVE requires a non-null trust_mode';
  end if;
  
  if p_decision_outcome != 'approve' and p_trust_mode is not null then
    raise exception 'CONSISTENCY_VIOLATION: % outcome requires a NULL trust_mode', p_decision_outcome;
  end if;
  
  if p_decider_type = 'system' and p_decider_id is not null then
    raise exception 'CONSISTENCY_VIOLATION: System decider must have NULL decider_id';
  end if;
  
  if p_decider_type = 'human' and p_decider_id is null then
    raise exception 'CONSISTENCY_VIOLATION: Human decider requires a non-null decider_id';
  end if;

  if p_decider_type not in ('human', 'system') then
    raise exception 'CONSISTENCY_VIOLATION: Invalid decider type %', p_decider_type;
  end if;

  -- Map subjects
  if p_subject_type = 'endpoint' then
    v_endpoint_id := p_subject_id;
  elif p_subject_type = 'collection' then
    v_collection_id := p_subject_id;
  elif p_subject_type = 'proposal' then
    v_proposal_id := p_subject_id;
  else
    raise exception 'CONSISTENCY_VIOLATION: Invalid subject type %', p_subject_type;
  end if;

  -- --------------------------------------------------------------------------
  -- 3. Supersession Checks
  -- --------------------------------------------------------------------------
  if p_supersedes_decision_id is not null then
    select endpoint_id, collection_id, proposal_id 
    into v_old_endpoint_id, v_old_collection_id, v_old_proposal_id
    from source_policy_decisions
    where id = p_supersedes_decision_id;
    
    if not found then
      raise exception 'SUPERSESSION_VIOLATION: Superseded decision % does not exist', p_supersedes_decision_id;
    end if;
    
    -- Verify same subject target
    if coalesce(v_old_endpoint_id, -1) != coalesce(v_endpoint_id, -1) or
       coalesce(v_old_collection_id, -1) != coalesce(v_collection_id, -1) or
       coalesce(v_old_proposal_id, -1) != coalesce(v_proposal_id, -1) then
      raise exception 'SUPERSESSION_VIOLATION: Superseded subject mismatch';
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- 4. Persist the New Immutable SourcePolicyDecision
  -- --------------------------------------------------------------------------
  insert into source_policy_decisions (
    endpoint_id, collection_id, proposal_id,
    decision_outcome, trust_mode, rights_class, rights_identifier,
    evidence_snapshot, policy_version, verification_version,
    supersedes_decision_id, carta_version, decided_by_actor_type,
    decided_by_actor_id, reason
  ) values (
    v_endpoint_id, v_collection_id, v_proposal_id,
    p_decision_outcome, p_trust_mode, 
    coalesce(p_evidence_snapshot->>'rights_class', 'unknown'),
    coalesce(p_evidence_snapshot->>'rights_identifier', null),
    p_evidence_snapshot, p_policy_version, p_verification_version,
    p_supersedes_decision_id, '0.7', p_decider_type, p_decider_id, p_reason
  ) returning id into v_decision_id;

  -- --------------------------------------------------------------------------
  -- 5. Atomic Lifecycle State Mutations
  -- --------------------------------------------------------------------------
  if p_decision_outcome = 'approve' then
    if p_subject_type = 'endpoint' then
      update source_endpoints 
      set status = 'active', trust_mode = p_trust_mode
      where id = p_subject_id;
    elif p_subject_type = 'collection' then
      update source_collections 
      set status = 'active', trust_mode = p_trust_mode
      where id = p_subject_id;
    elif p_subject_type = 'proposal' then
      -- Explicit registry operation boundary: do NOT magically invent endpoint/collection
      update source_proposals 
      set status = 'resolved'
      where id = p_subject_id;
    end if;
    
  elif p_decision_outcome = 'needs_human_review' then
    if p_subject_type = 'endpoint' then
      update source_endpoints 
      set status = 'needs_human_review'
      where id = p_subject_id;
    elif p_subject_type = 'collection' then
      update source_collections 
      set status = 'needs_human_review'
      where id = p_subject_id;
    elif p_subject_type = 'proposal' then
      update source_proposals 
      set status = 'needs_policy_review'
      where id = p_subject_id;
    end if;
    
  elif p_decision_outcome = 'reject' then
    if p_subject_type = 'endpoint' then
      update source_endpoints 
      set status = 'rejected'
      where id = p_subject_id;
    elif p_subject_type = 'collection' then
      update source_collections 
      set status = 'rejected'
      where id = p_subject_id;
    elif p_subject_type = 'proposal' then
      update source_proposals 
      set status = 'rejected'
      where id = p_subject_id;
    end if;
  end if;

  return v_decision_id;
end $$;

-- Restrict execution to the backend service role
revoke execute on function apply_source_policy_decision from public, terraveler_anon;
grant execute on function apply_source_policy_decision to terraveler_service;
