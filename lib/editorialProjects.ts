import { dataApi, dataRpc } from "@/lib/deskAuth";
import { parseEditorialStart } from "@/lib/editorialWorkflow";

type Read = (method: string, path: string) => Promise<any>;
export function editorialExecution(env: Record<string, string | undefined> = process.env) {
  return { configured: env.EDITORIAL_WORKFLOW_ENABLED === "1", worker_health: "not-observed" };
}
export function positiveTopic(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
/** Page through the canonical data plane without silently losing old contributions. */
async function rows(path: string, read: Read) {
  const result: any[] = [];
  while (result.length < 20000) {
    const page = await read("GET", `${path}&limit=500&offset=${result.length}`);
    if (!Array.isArray(page)) throw new Error("Invalid project response");
    if (!page.length) return result;
    result.push(...page);
  }
  throw new Error("Project exceeds inspection window");
}
function taskAgent(task: any) {
  const binding = Array.isArray(task.editorial_task_agents) ? task.editorial_task_agents[0] : task.editorial_task_agents;
  const value = binding?.editorial_agent_versions;
  const agent = Array.isArray(value) ? value[0] : value;
  return agent ? { name: agent.name, version: agent.version, model: agent.model } : null;
}
const taskFields = "id,topic_id,role,state,attempt,editorial_task_agents(editorial_agent_versions(name,version,model))";
function projectView(topic: any, links: any[], tasks: any[], runs: any[], draft: any = null) {
  const run = runs.find(r => r.topic_id === topic.id);
  const current = run ? tasks.find(t => t.id === run.current_task_id) : null;
  let next = "Define the brief and commission agent work.";
  if (run?.state === "attention") next = run.attention_reason || "Agent work needs attention. Inspect the task and resolve the blocker before restarting.";
  else if (run?.state === "awaiting-editor") next = "Read the reviewed candidate draft. Publication still requires your explicit authorization and the existing content checks.";
  else if (run) next = current?.state === "running" ? `${current.role}: an attempt holds a task lease. Refresh to inspect progress.` : `Waiting for an enabled ${current?.role || "assigned"} agent and the editorial worker. No running attempt is reported.`;
  return { id: topic.id, topic_key: topic.topic_key, title: topic.title, objective: topic.objective,
    contributions: links.filter(l => l.topic_id === topic.id).map(l => {
      const snapshot = l.snapshot || {};
      return { submission_id: l.submission_id, title: snapshot.payload?.title || snapshot.payload?.meta?.title || snapshot.payload?.target_voyage || `Proposal #${l.submission_id}`,
        type: snapshot.type || "contribution", status: snapshot.status || "approved" };
    }),
    tasks: tasks.filter(t => t.topic_id === topic.id).map(t => ({ id: t.id, role: t.role, state: t.state, attempt: t.attempt, agent: taskAgent(t) })),
    pipeline: run ? { id: run.id, state: run.state, revision: run.revision, next_step: next } : null,
    latest_draft: draft?.kind === "draft" && typeof draft.title === "string" && typeof draft.body === "string" ? { title: draft.title, body: draft.body } : null };
}
export async function readEditorialProjects(read: Read = dataApi) {
  const topics = await rows("editorial_topics?select=id,topic_key,title,objective&order=id.desc", read);
  if (!topics.length) return [];
  const [links, tasks, runs] = await Promise.all([
    rows("editorial_topic_submissions?select=submission_id,topic_id,snapshot&order=submission_id.asc", read),
    rows(`editorial_tasks?select=${taskFields}&order=id.desc`, read),
    rows("editorial_pipeline_runs?select=id,topic_id,state,revision,current_task_id,attention_reason&order=id.desc", read),
  ]);
  return topics.map(t => projectView(t, links, tasks, runs));
}
export async function readEditorialProject(topicId: number, read: Read = dataApi) {
  if (!positiveTopic(topicId)) throw new Error("Invalid topic");
  const topics = await read("GET", `editorial_topics?id=eq.${topicId}&select=id,topic_key,title,objective&limit=1`);
  if (!Array.isArray(topics)) throw new Error("Invalid project response");
  if (!topics[0]) return null;
  const [links, tasks, runs] = await Promise.all([
    rows(`editorial_topic_submissions?topic_id=eq.${topicId}&select=submission_id,topic_id,snapshot&order=submission_id.asc`, read),
    rows(`editorial_tasks?topic_id=eq.${topicId}&select=${taskFields}&order=id.desc`, read),
    read("GET", `editorial_pipeline_runs?topic_id=eq.${topicId}&select=id,topic_id,state,revision,current_task_id,draft_task_id,attention_reason&order=id.desc&limit=1`),
  ]);
  if (!Array.isArray(runs)) throw new Error("Invalid project response");
  let draft = null;
  if (positiveTopic(runs[0]?.draft_task_id)) {
    const results = await read("GET", `editorial_results?task_id=eq.${runs[0].draft_task_id}&select=result&limit=1`);
    if (!Array.isArray(results)) throw new Error("Invalid project response");
    draft = results[0]?.result;
  }
  return projectView(topics[0], links, tasks, runs, draft);
}
export async function readEditorialMessages(topicId: number, read: Read = dataApi) {
  if (!positiveTopic(topicId)) throw new Error("Invalid topic");
  const messages = await read("GET", `editorial_chat_messages?topic_id=eq.${topicId}&select=role,content,created_at&order=id.desc&limit=50`);
  if (!Array.isArray(messages)) throw new Error("Invalid conversation response");
  return messages.reverse();
}
export function parseProjectAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { action, ...input } = value as Record<string, unknown>;
  if (action === "attach") { const parsed = parseEditorialStart(input); return parsed ? { action, input: parsed } as const : null; }
  if (action !== "start" || Object.keys(input).some(k => !["topic_id", "brief", "request_id"].includes(k)) ||
    !positiveTopic(input.topic_id) || typeof input.brief !== "string" || !input.brief.trim() || input.brief.trim().length > 12000 ||
    typeof input.request_id !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(input.request_id)) return null;
  return { action: "start", input: { topic_id: input.topic_id, brief: input.brief.trim(), request_id: input.request_id } } as const;
}
export async function applyProjectAction(action: NonNullable<ReturnType<typeof parseProjectAction>>, rpc = dataRpc) {
  if (action.action === "attach") return rpc("editorial_attach", { p_submission_id: action.input.submission_id, p_topic_key: action.input.topic_key, p_title: action.input.title, p_objective: action.input.objective });
  return rpc("editorial_start_pipeline", { p_topic_id: action.input.topic_id, p_brief: action.input.brief, p_request_id: action.input.request_id });
}
