-- Canonical VPS PostgreSQL. Apply AFTER editorial_image_text_editor.sql and
-- editorial_research_relevance.sql.
--
-- Room for the research the writer is meant to use.
--
-- The writer's context joins every research item's cited references, findings
-- and waypoints. The bound (40 references, 40,000 octets) was set when each item
-- read one book's first ~9 chunks. With ranked, mixed reads, a real dossier
-- (Magellan, run 23: 26 cited references, 22 findings, 9 waypoints) needs ~49 KB,
-- and claiming its writer raised 'research synthesis exceeds bounded context',
-- rolled back the claim and stopped the worker. The served models take 200k+
-- tokens; the bound is a safety rail, not a model limit. It becomes 160
-- references, 200 findings and 300,000 octets: sized so that the reviewer's
-- prompt (this research plus the draft, gateway cap 393,216 bytes) stays inside
-- the smallest served context, granite4.2:30b at 131,072 tokens. Everything else
-- in the function is unchanged from editorial_image_text_editor.sql.
begin;
create or replace function public.editorial_graph_context(p_task_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare g public.editorial_graph_tasks; t public.editorial_tasks; result jsonb;
 refs jsonb:='[]'; findings jsonb:='[]'; uncertainties jsonb:='[]'; waypoints jsonb:='[]';
 v jsonb; prior jsonb; research jsonb; draft jsonb; dep_results jsonb; writer_specialty text; selection jsonb;
begin
 select * into g from public.editorial_graph_tasks where task_id=p_task_id;
 if not found then return '{}'::jsonb; end if;
 select * into t from public.editorial_tasks where id=p_task_id;
 if t.role='research' then
  select coalesce(jsonb_agg(jsonb_build_object('work_item_id',p.work_item_id,'result',r.result- 'candidate') order by p.work_item_id),'[]') into dep_results
  from public.editorial_graph_edges e join public.editorial_graph_tasks p on p.task_id=e.depends_on join public.editorial_results r on r.task_id=p.task_id where e.task_id=t.id;
  for result in select value->'result' from jsonb_array_elements(dep_results) loop
   for v in select value from jsonb_array_elements(result->'references') loop
    if not public.editorial_graph_check_reference(v,g.run_id) then raise exception 'source policy changed or receipt invalid'; end if;
   end loop;
  end loop;
  return jsonb_build_object('dependency_research',dep_results);
 end if;
 -- Caption writers and their reviewers work from the verified image selection only.
 select item->>'specialty' into writer_specialty from public.editorial_graph_runs run join public.editorial_plans p on p.id=run.plan_id
  cross join lateral jsonb_array_elements(p.plan->'work_items') item
  where run.id=g.run_id and item->>'id'=(case when t.role='writer' then g.work_item_id
   else (select m.work_item_id from public.editorial_graph_tasks m where m.task_id=t.dependency_id) end);
 if writer_specialty='caption' then
  selection:=public.editorial_graph_image_selection(g.run_id);
  if t.role='writer' then return jsonb_build_object('image_selection',selection); end if;
  select r.result into draft from public.editorial_results r where r.task_id=t.dependency_id;
  if draft->>'kind' is distinct from 'draft' or draft->>'format' is distinct from 'captions' then raise exception 'caption draft required'; end if;
  return jsonb_build_object('image_selection',selection,'draft_result',draft);
 end if;
 for result in select r.result from public.editorial_graph_tasks h join public.editorial_tasks x on x.id=h.task_id join public.editorial_results r on r.task_id=x.id where h.run_id=g.run_id and x.role='research' order by h.work_item_id loop
  -- Image selections are not textual evidence: writers never receive them as research.
  if result->>'kind'='iconography' then continue; end if;
  if result->>'kind' is distinct from 'research' then raise exception 'research result required'; end if;
  for v in select value from jsonb_array_elements(result->'references') loop
   if not public.editorial_graph_check_reference(v,g.run_id) then raise exception 'source policy changed or receipt invalid'; end if;
   select value into prior from jsonb_array_elements(refs) where value->>'id'=v->>'id';
   if not found then refs:=refs||jsonb_build_array(v);
   elsif (prior-'governance') is distinct from (v-'governance') then raise exception 'conflicting source snapshots'; end if;
  end loop;
  findings:=findings||coalesce(result->'findings','[]');
  uncertainties:=uncertainties||coalesce(result->'uncertainties','[]');
  waypoints:=waypoints||coalesce(result->'waypoints','[]');
 end loop;
 if jsonb_array_length(refs) not between 1 and 160 or jsonb_array_length(findings) not between 1 and 200
 or jsonb_array_length(waypoints)>40 or octet_length((refs||findings||waypoints)::text)>300000
 then raise exception 'research synthesis exceeds bounded context'; end if;
 research:=jsonb_build_object('kind','research','references',refs,'findings',findings,'uncertainties',uncertainties,'waypoints',waypoints);
 if t.role='reviewer' then
  select r.result into draft from public.editorial_results r where r.task_id=t.dependency_id;
  if draft->>'kind' is distinct from 'draft' or draft ? 'format' then raise exception 'draft result required'; end if;
  if draft->'waypoints' is distinct from waypoints then raise exception 'waypoint provenance mismatch'; end if;
  return jsonb_build_object('research_result',research,'draft_result',draft);
 end if;
 return jsonb_build_object('research_result',research);
end $$;
commit;
