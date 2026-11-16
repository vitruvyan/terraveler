import { dataApi } from "@/lib/deskAuth";
import { positiveTopic } from "@/lib/editorialProjects";

type Read = (method: string, path: string) => Promise<any>;
export type EditorialPreview = {
  topic: { id: number; title: string };
  result_id: number; task_id: number; created_at: string;
  title: string; paragraphs: { text: string; source_ids: string[] }[];
  sources: { id: string; title: string; href: string | null; rights: string }[];
  review: { verdict: string; issues: string[] } | null;
};
export function safeSourceHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const text = (v: unknown, limit: number): v is string => typeof v === "string" && !!v.trim() && v.length <= limit;
/** Read only committed, immutable writer results, scoped to the requested dossier.
 * Never send source passages, model envelopes, trace or task input to the reader. */
export async function readEditorialPreview(topicId: number, resultId: number | null = null, read: Read = dataApi): Promise<EditorialPreview | null> {
  if (!positiveTopic(topicId) || (resultId !== null && !positiveTopic(resultId))) throw new Error("Invalid preview identity");
  const topics = await read("GET", `editorial_topics?id=eq.${topicId}&select=id,title&limit=1`);
  if (!Array.isArray(topics)) throw new Error("Invalid preview response");
  if (!topics[0]) return null;
  const results = await read("GET", `editorial_results?select=id,task_id,created_at,result,editorial_tasks!inner(topic_id,role)&editorial_tasks.topic_id=eq.${topicId}&editorial_tasks.role=eq.writer${resultId === null ? "" : `&id=eq.${resultId}`}&order=id.desc&limit=1`);
  if (!Array.isArray(results)) throw new Error("Invalid preview response");
  const row = results[0], draft = row?.result;
  if (!row) return null;
  if (!positiveTopic(row.id) || !positiveTopic(row.task_id) || draft?.kind !== "draft" || !text(draft.title, 500) || !text(draft.body, 50000)) throw new Error("Invalid draft");
  const sources: EditorialPreview["sources"] = [];
  const seen = new Set<string>();
  if (Array.isArray(draft.references)) for (const ref of draft.references.slice(0, 40)) {
    if (!text(ref?.id, 2000) || seen.has(ref.id) || !text(ref.title, 2000) || !text(ref.rights, 2000)) continue;
    seen.add(ref.id);
    sources.push({ id: ref.id, title: ref.title, href: safeSourceHref(ref.url), rights: ref.rights });
  }
  const citations = Array.isArray(draft.citations) ? draft.citations.slice(0, 200) : [];
  const paragraphs = draft.body.split(/\n\s*\n/).filter((p: string) => p.trim()).map((p: string) => ({
    text: p.trim(), source_ids: [...new Set<string>(citations.filter((c: any) => c?.claim === p.trim() && seen.has(c.source_id)).map((c: any) => c.source_id))],
  }));
  // A later review of another draft must never certify this result.
  const reviews = await read("GET", `editorial_results?select=result,editorial_tasks!inner(topic_id,role,dependency_id)&editorial_tasks.topic_id=eq.${topicId}&editorial_tasks.role=eq.reviewer&editorial_tasks.dependency_id=eq.${row.task_id}&order=id.desc&limit=1`);
  if (!Array.isArray(reviews)) throw new Error("Invalid preview response");
  const r = reviews[0]?.result;
  const validReview = r?.kind === "review" && ["ready-for-editor", "changes-requested", "blocked"].includes(r.verdict) && Array.isArray(r.issues) && r.issues.length <= 100 && r.issues.every((i: unknown) => text(i, 12000)) && (r.verdict === "ready-for-editor" ? r.issues.length === 0 : r.issues.length > 0);
  return { topic: { id: topicId, title: topics[0].title }, result_id: row.id, task_id: row.task_id,
    created_at: typeof row.created_at === "string" ? row.created_at : "", title: draft.title, paragraphs, sources,
    review: validReview ? { verdict: r.verdict, issues: r.issues } : null };
}
