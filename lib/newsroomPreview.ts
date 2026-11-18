import { dataApi } from "@/lib/deskAuth";
import { readAdminDashboard, type AdminDashboardData } from "@/lib/adminDashboard";

export function newsroomPreviewEnabled(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV === "preview" || env.NODE_ENV === "development";
}
type Read = (method: string, path: string) => Promise<any>;
export type NewsAgent = { key: string; name: string; role: string; specialty: string | null; version: number; model: string; enabled: boolean };
export type NewsTask = { id: number; topic_id: number; role: string; state: string; attempt: number; agent_key: string | null; bound_version: number | null };
export type NewsEvent = { id: number; task_id: number; topic_id: number | null; type: string; at: string; attempt: number; agent_key: string | null; bound_version: number | null };
export type NewsIdea = { id: number; title: string; type: string; status: string; at: string };
export type NewsGraph = { id: number; topic_id: number; plan_id: number; state: string; task_count: number; completed_count: number };
export type NewsroomSnapshot = {
  checked_at: string; dashboard: AdminDashboardData | null; agents: NewsAgent[] | null;
  tasks: NewsTask[] | null; events: NewsEvent[] | null; ideas: NewsIdea[] | null;
  graphs: NewsGraph[] | null; errors: string[];
};
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const string = (v: unknown, max = 300): string => typeof v === "string" ? v.slice(0,max) : "";
const key = (v: unknown): string | null => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
const one = (v: any) => Array.isArray(v) ? v[0] : v;
const eventTypes = new Set(["queued","claimed","completed","failed","lease-expired","agent-bound","specialist-assigned"]);
const fields = "id,topic_id,role,state,attempt,editorial_specialist_assignments(agent_key),editorial_task_agents(editorial_agent_versions(agent_key,version))";
async function rows(read: Read, path: string): Promise<any[]> {
  const result = await read("GET",path);
  if (!Array.isArray(result)) throw Error("unavailable");
  return result;
}
export function projectTask(row: any, historical = false): NewsTask | null {
  if (!positive(row?.id) || !positive(row?.topic_id) || !integer(row?.attempt)) return null;
  const bound = one(one(row.editorial_task_agents)?.editorial_agent_versions);
  const assignment = one(row.editorial_specialist_assignments);
  return {id:row.id,topic_id:row.topic_id,role:string(row.role,40),state:string(row.state,40),attempt:row.attempt,
    agent_key:key(bound?.agent_key) ?? (historical ? null : key(assignment?.agent_key)),
    bound_version:positive(bound?.version) ? bound.version : null};
}
export function projectEvents(records: any[], tasks: NewsTask[]): NewsEvent[] {
  const byId = new Map(tasks.map(t=>[t.id,t]));
  return records.flatMap(e=>{
    if(!positive(e?.id)||!positive(e?.task_id)||!integer(e?.attempt)||!eventTypes.has(e.event)||typeof e.created_at!=="string"||!Number.isFinite(Date.parse(e.created_at)))return [];
    const t=byId.get(e.task_id);
    // The immutable binding identifies the task's agent, not the author of every event.
    // A queued event may predate binding; never attribute it to an agent's action.
    return [{id:e.id,task_id:e.task_id,topic_id:t?.topic_id??null,type:e.event,at:e.created_at,attempt:e.attempt,agent_key:t?.bound_version ? t.agent_key : null,bound_version:t?.bound_version??null}];
  });
}
async function recentEvents(read:Read) {
  const records=await rows(read,"editorial_task_events?select=id,task_id,event,attempt,created_at&order=id.desc&limit=80");
  const ids=[...new Set(records.map(e=>e.task_id).filter(positive))];
  const tasks=ids.length ? await rows(read,"editorial_tasks?select="+fields+"&id=in.("+ids.join(",")+")&limit=80") : [];
  return projectEvents(records,tasks.flatMap(t=>{const v=projectTask(t,true);return v?[v]:[];}));
}
export async function readNewsroomPreview(read:Read=dataApi, dashboard:()=>Promise<AdminDashboardData>=()=>readAdminDashboard(read)):Promise<NewsroomSnapshot>{
  const settled=await Promise.allSettled([
    dashboard(),
    rows(read,"editorial_specialist_agents_current?select=agent_key,name,role,specialty,version,model,enabled&order=agent_key.asc&limit=100").then(rs=>rs.flatMap(a=>key(a.agent_key)&&positive(a.version)?[{key:a.agent_key,name:string(a.name),role:string(a.role),specialty:string(a.specialty)||null,version:a.version,model:string(a.model),enabled:a.enabled===true}]:[])),
    rows(read,"editorial_tasks?select="+fields+"&state=in.(queued,running,attention)&order=id.desc&limit=100").then(rs=>rs.flatMap(t=>{const v=projectTask(t);return v?[v]:[];})),
    recentEvents(read),
    rows(read,"submissions?select=id,type,status,created_at,target_voyage,title:payload->>title,meta_title:payload->meta->>title&type=in.(idea,content-suggestion,feature-suggestion)&order=id.desc&limit=60").then(rs=>rs.flatMap(s=>positive(s.id)?[{id:s.id,title:string(s.title)||string(s.meta_title)||string(s.target_voyage)||"Proposal #"+s.id,type:string(s.type),status:string(s.status),at:string(s.created_at)}]:[])),
    rows(read,"editorial_graph_status?select=id,topic_id,plan_id,state,task_count,completed_count&order=id.desc&limit=100").then(rs=>rs.flatMap(g=>positive(g.id)&&positive(g.topic_id)&&positive(g.plan_id)&&integer(g.task_count)&&integer(g.completed_count)?[{id:g.id,topic_id:g.topic_id,plan_id:g.plan_id,state:string(g.state,40),task_count:g.task_count,completed_count:g.completed_count}]:[])),
  ] as const);
  const value=<T,>(result:PromiseSettledResult<T>):T|null=>result.status==="fulfilled"?result.value:null;
  const names=["Briefing","Agent registry","Open tasks","Task events","Editorial wall","Plan dispatches"];
  return {checked_at:new Date().toISOString(),dashboard:value(settled[0]),agents:value(settled[1]),tasks:value(settled[2]),events:value(settled[3]),ideas:value(settled[4]),graphs:value(settled[5]),errors:settled.flatMap((s,i)=>s.status==="rejected"?[names[i]]:[])};
}
