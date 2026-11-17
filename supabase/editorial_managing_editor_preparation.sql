-- Canonical VPS PostgreSQL. Apply after editorial_preparation.sql.
-- Allow coordinator configuration for preparation only; worker claim/assignment contracts unchanged.
begin;
create or replace function public.desk_save_editorial_specialist_agent(
 p_agent_key text,p_name text,p_role text,p_model text,p_instructions text,
 p_enabled boolean,p_expected_version integer,p_request_id text,p_specialty text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_agent_versions; current_specialty text; effective_specialty text:=p_specialty; receipt jsonb; version_id bigint;
begin
 if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' or p_agent_key is null or p_agent_key !~ '^[a-z0-9][a-z0-9-]{1,79}$' then return jsonb_build_object('error','invalid-agent'); end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent-request:'||p_request_id,0));
 select * into prior from public.editorial_agent_versions where request_id=p_request_id;
 if found then
  select requested_specialty into current_specialty from public.editorial_agent_specialties where agent_version_id=prior.id;
  if p_specialty is distinct from current_specialty then return jsonb_build_object('error','idempotency-conflict'); end if;
  receipt:=public.desk_save_editorial_agent(p_agent_key,p_name,p_role,p_model,p_instructions,p_enabled,p_expected_version,p_request_id);
  if receipt ? 'error' then return receipt; end if;
  return receipt||jsonb_build_object('specialty',(select specialty from public.editorial_agent_specialties where agent_version_id=prior.id));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||p_agent_key,0));
 if effective_specialty is null then
  select s.specialty into effective_specialty from public.editorial_agents_current a join public.editorial_agent_specialties s on s.agent_version_id=a.id where a.agent_key=p_agent_key;
 end if;
 if effective_specialty is not null then
  if public.editorial_specialty_role(effective_specialty) is distinct from p_role then return jsonb_build_object('error','specialty-role-mismatch'); end if;
  if p_enabled and effective_specialty not in ('managing-editor','history','diary','factcheck') then return jsonb_build_object('error','specialist-handler-not-implemented'); end if;
 end if;
 receipt:=public.desk_save_editorial_agent(p_agent_key,p_name,p_role,p_model,p_instructions,p_enabled,p_expected_version,p_request_id);
 if receipt ? 'error' then return receipt; end if;
 if effective_specialty is not null then
  select id into version_id from public.editorial_agent_versions where request_id=p_request_id;
  insert into public.editorial_agent_specialties(agent_version_id,specialty,requested_specialty) values(version_id,effective_specialty,p_specialty);
 end if;
 return receipt||jsonb_build_object('specialty',effective_specialty);
end $$;
revoke all on function public.desk_save_editorial_specialist_agent(text,text,text,text,text,boolean,integer,text,text) from public,terraveler_service;
grant execute on function public.desk_save_editorial_specialist_agent(text,text,text,text,text,boolean,integer,text,text) to terraveler_service;
notify pgrst,'reload schema';
commit;
