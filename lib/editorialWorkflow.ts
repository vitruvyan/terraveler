import { dataApi, dataRpc } from "@/lib/deskAuth";

export type StartEditorialWork = {
  submission_id: number;
  topic_key: string;
  title: string;
  objective: string;
};

/** An explicit dossier identity, never a fuzzy merge based on similar titles. */
export function parseEditorialStart(value: unknown): StartEditorialWork | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["submission_id", "topic_key", "title", "objective"].includes(k))) return null;
  if (!Number.isSafeInteger(v.submission_id) || Number(v.submission_id) < 1 ||
      typeof v.topic_key !== "string" || !/^[a-z0-9][a-z0-9-]{2,99}$/.test(v.topic_key) ||
      typeof v.title !== "string" || !v.title.trim() || v.title.trim().length > 200 ||
      typeof v.objective !== "string" || !v.objective.trim() || v.objective.trim().length > 6000) return null;
  return { submission_id: Number(v.submission_id), topic_key: v.topic_key,
    title: v.title.trim(), objective: v.objective.trim() };
}

export async function startEditorialWork(input: StartEditorialWork, rpc = dataRpc) {
  return rpc("editorial_start", {
    p_submission_id: input.submission_id, p_topic_key: input.topic_key,
    p_title: input.title, p_objective: input.objective,
  });
}

type Read = (method: string, path: string) => Promise<any>;
/** Bounded pages; the admin can inspect a dossier without downloading every trace. */
export async function readEditorialWork(topicId: number | null, before: number | null, read: Read = dataApi) {
  if (topicId === null) {
    const topics = await read("GET", `editorial_topics?select=*&order=id.desc&limit=100${before === null ? "" : `&id=lt.${before}`}`);
    if (!Array.isArray(topics)) throw new Error("Invalid workflow response");
    return { topics, next_before: topics.length === 100 ? topics.at(-1).id : null };
  }
  const [topics, tasks, results] = await Promise.all([
    read("GET", `editorial_topics?id=eq.${topicId}&select=*&limit=1`),
    read("GET", `editorial_tasks?topic_id=eq.${topicId}&select=id,topic_id,role,state,attempt,created_at,editorial_task_agents(agent_version_id,editorial_agent_versions(agent_key,version,name,model))&order=id.desc&limit=100${before === null ? "" : `&id=lt.${before}`}`),
    read("GET", `editorial_results?editorial_tasks.topic_id=eq.${topicId}&select=id,task_id,created_at,editorial_tasks!inner(topic_id)&order=id.desc&limit=100`),
  ]);
  if (![topics, tasks, results].every(Array.isArray)) throw new Error("Invalid workflow response");
  return { topic: topics[0] ?? null, tasks, results,
    next_before: tasks.length === 100 ? tasks.at(-1).id : null, results_truncated: results.length === 100,
    publication: "human-authorization-required" };
}
