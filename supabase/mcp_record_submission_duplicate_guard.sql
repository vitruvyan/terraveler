-- Duplicate-submission integrity (Phase 5), enforced inside the two RPCs
-- that already do "authenticate, quota, insert, audit" atomically.
--
-- content_fingerprint is computed once in application code
-- (lib/contentFingerprint.ts) and handed in as p_content_fingerprint --
-- these functions never recompute it, so the RPC path and the TS
-- manual-insert fallback can never disagree about what counts as duplicate.
-- Race-safety comes from supabase/submission_content_fingerprint.sql's
-- partial unique index, not from anything in this file: two concurrent
-- callers of either function race the same index, and Postgres admits
-- exactly one.
--
-- mcp_record_submission_oauth is the live path for modern OAuth agents
-- (called from app/api/agent/write/route.ts). mcp_record_submission is its
-- legacy-lane counterpart (handle + api_key, app/api/mcp/route.ts) and gets
-- the identical treatment for parity, though that lane is disabled by
-- default (MCP_LEGACY_MUTATIONS_ENABLED).
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

create or replace function public.mcp_record_submission_oauth(
  p_contributor_id bigint, p_type text, p_target_voyage text, p_payload jsonb,
  p_status text, p_carta text, p_quotas jsonb, p_actor text, p_action text,
  p_verdict text, p_findings jsonb, p_content_fingerprint text default null
)
returns jsonb language plpgsql as $$
declare
  a record; used int; sid bigint; lim int;
  existing_id bigint;
  cross_author jsonb;
begin
  select * into a from mcp_contributor(p_contributor_id);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  lim := coalesce((p_quotas ->> a.rank)::int, (p_quotas ->> 'cabin-boy')::int);
  select count(*) into used from submissions
   where contributor_id = a.id and created_at >= now() - interval '24 hours';
  if used >= lim then
    return jsonb_build_object('error', format(
      'Daily quota reached for rank ''%s'' (%s/24h). Quality over volume — resume tomorrow, or rise in rank.',
      a.rank, lim));
  end if;

  begin
    insert into submissions (contributor_id, type, target_voyage, payload, status,
                              carta_version, content_fingerprint)
         values (a.id, p_type, p_target_voyage, p_payload, p_status, p_carta, p_content_fingerprint)
      returning id into sid;
  exception when unique_violation then
    select id into existing_id from submissions
     where contributor_id = a.id and content_fingerprint = p_content_fingerprint
       and status not in ('rejected', 'curator-rejected')
     limit 1;
    return jsonb_build_object('error', format(
      'DUPLICATE_SUBMISSION: identical content already exists as submission #%s', existing_id),
      'existing_submission_id', existing_id);
  end;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (sid, p_actor, p_action, p_verdict, p_findings, p_carta);

  select coalesce(jsonb_agg(id), '[]'::jsonb) into cross_author from (
    select id from submissions
     where content_fingerprint = p_content_fingerprint and contributor_id <> a.id
       and status not in ('rejected', 'curator-rejected')
     limit 5
  ) t;

  return jsonb_build_object('submission_id', sid, 'status', p_status,
                             'cross_author_duplicates', cross_author);
end;
$$;

create or replace function public.mcp_record_submission(
  p_handle text, p_key_hash text, p_type text, p_target_voyage text, p_payload jsonb,
  p_status text, p_carta text, p_quotas jsonb, p_actor text, p_action text,
  p_verdict text, p_findings jsonb, p_content_fingerprint text default null
)
returns jsonb language plpgsql as $$
declare
  a record; used int; sid bigint; lim int;
  existing_id bigint;
  cross_author jsonb;
begin
  select * into a from mcp_auth(p_handle, p_key_hash);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  lim := coalesce((p_quotas ->> a.rank)::int, (p_quotas ->> 'cabin-boy')::int);
  select count(*) into used from submissions
   where contributor_id = a.id and created_at >= now() - interval '24 hours';
  if used >= lim then
    return jsonb_build_object('error', format(
      'Daily quota reached for rank ''%s'' (%s/24h). Quality over volume — resume tomorrow, or rise in rank.',
      a.rank, lim));
  end if;

  begin
    insert into submissions (contributor_id, type, target_voyage, payload, status,
                              carta_version, content_fingerprint)
         values (a.id, p_type, p_target_voyage, p_payload, p_status, p_carta, p_content_fingerprint)
      returning id into sid;
  exception when unique_violation then
    select id into existing_id from submissions
     where contributor_id = a.id and content_fingerprint = p_content_fingerprint
       and status not in ('rejected', 'curator-rejected')
     limit 1;
    return jsonb_build_object('error', format(
      'DUPLICATE_SUBMISSION: identical content already exists as submission #%s', existing_id),
      'existing_submission_id', existing_id);
  end;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (sid, p_actor, p_action, p_verdict, p_findings, p_carta);

  select coalesce(jsonb_agg(id), '[]'::jsonb) into cross_author from (
    select id from submissions
     where content_fingerprint = p_content_fingerprint and contributor_id <> a.id
       and status not in ('rejected', 'curator-rejected')
     limit 5
  ) t;

  return jsonb_build_object('submission_id', sid, 'status', p_status,
                             'cross_author_duplicates', cross_author);
end;
$$;

commit;
