import { ATLAS, voyagePath } from "@/lib/voyages";
import { dataApi } from "@/lib/deskAuth";
import { readEditorialProjects, editorialExecution } from "@/lib/editorialProjects";
import { teamModelCatalogue } from "@/lib/editorialTeam";
type Read = (method: string, path: string) => Promise<any>;
export type DashboardAgent = { name: string; role: string; model: string; enabled: boolean; version: number };
export type DashboardProject = { id: number; title: string; state: string; next_step: string; running: number };
export type DashboardDraft = { result_id: number; topic_id: number; title: string; created_at: string };
export type AdminDashboardData = {
  checked_at: string; execution_configured: boolean; worker_health: "not-observed";
  gateway: { status: string; models: string[] };
  projects: DashboardProject[] | null; agents: DashboardAgent[] | null; drafts: DashboardDraft[] | null;
  publication: { awaiting_decision: number } | null;
  atlas: { title: string; href: string }[];
  errors: string[];
};
async function rows(path: string, read: Read) {
  const all: any[] = [];
  while (all.length < 20000) {
    const page = await read("GET", `${path}&limit=500&offset=${all.length}`);
    if (!Array.isArray(page)) throw Error("Invalid dashboard response");
    if (!page.length) return all;
    all.push(...page);
  }
  throw Error("Dashboard inspection limit exceeded");
}
/** Independent read projections: failure is unknown, never an empty healthy queue. */
export async function readAdminDashboard(read: Read = dataApi, catalogue = teamModelCatalogue): Promise<AdminDashboardData> {
  const outcomes = await Promise.allSettled([
    readEditorialProjects(read),
    rows("editorial_specialist_agents_current?select=name,role,model,enabled,version&order=agent_key.asc", read),
    rows("editorial_results?select=id,created_at,kind:result->>kind,title:result->>title,editorial_tasks!inner(topic_id,role)&editorial_tasks.role=eq.writer&order=id.desc", read),
    rows("submissions?select=id,status&order=id.desc", read),
    catalogue(),
  ]);
  const value = (i: number): any => outcomes[i].status === "fulfilled" ? outcomes[i].value : null;
  const errors = outcomes.flatMap((o, i) => o.status === "rejected" ? [["Projects", "Agent registry", "Saved drafts", "Publication records", "Limen catalogue"][i]] : []);
  const projects = value(0), agents = value(1), results = value(2), submissions = value(3), gateway = value(4);
  const seen = new Set<number>();
  const drafts: DashboardDraft[] | null = results === null ? null : results.flatMap((r: any) => {
    const task = Array.isArray(r.editorial_tasks) ? r.editorial_tasks[0] : r.editorial_tasks;
    if (!Number.isSafeInteger(task?.topic_id) || task.topic_id < 1 || seen.has(task.topic_id) || r.kind !== "draft" || typeof r.title !== "string" || !Number.isSafeInteger(r.id) || r.id < 1) return [];
    seen.add(task.topic_id);
    return [{ result_id: r.id, topic_id: task.topic_id, title: r.title, created_at: typeof r.created_at === "string" ? r.created_at : "" }];
  });
  return { checked_at: new Date().toISOString(), execution_configured: editorialExecution().configured, worker_health: "not-observed",
    gateway: { status: gateway?.status ?? "unavailable", models: Array.isArray(gateway?.models) ? gateway.models.map((m: any) => m.id) : [] },
    projects: projects === null ? null : projects.map((p: any) => ({ id: p.id, title: p.title, state: p.pipeline?.state ?? "not-started", next_step: p.pipeline?.next_step ?? "Define the brief and commission work.", running: p.tasks.filter((t: any) => t.state === "running").length })),
    agents: agents === null ? null : agents.map((a: any) => ({ name: a.name, role: a.role, model: a.model, enabled: a.enabled === true, version: a.version })),
    drafts, atlas: ATLAS.map(v => ({ title: v.title, href: voyagePath(v.slug) })), publication: submissions === null ? null : { awaiting_decision: submissions.filter((s: any) => ["human-review", "appealed"].includes(s.status)).length }, errors };
}
