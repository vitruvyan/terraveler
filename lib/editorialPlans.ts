import { dataApi, dataRpc } from "@/lib/deskAuth";
import { editorialSpecialist } from "@/lib/editorialSpecialists";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const text = (v: unknown, limit: number): v is string => typeof v === "string" && !!v.trim() && v.length <= limit;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9_-]{0,79}$/.test(v);
export type EditorialPlan = {
  orientation_receipt_id: string; gaps: string[];
  work_items: { id: string; question: string; deliverable: string; specialty: string; depends_on: string[]; source_receipt_ids: string[] }[];
};
export type SaveEditorialPlan = { topic_id: number; expected_version: number; request_id: string; plan: EditorialPlan };
/** Early API validation; SQL independently verifies structure and server-owned receipts. */
export function parseEditorialPlanRequest(value: unknown): SaveEditorialPlan | null {
  if (!object(value) || !keys(value, ["topic_id", "expected_version", "request_id", "plan"]) ||
      !Number.isSafeInteger(value.topic_id) || Number(value.topic_id) <= 0 ||
      !Number.isInteger(value.expected_version) || Number(value.expected_version) < 0 || Number(value.expected_version) > 2147483646 ||
      typeof value.request_id !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(value.request_id)) return null;
  const p = value.plan;
  if (!object(p) || !keys(p, ["orientation_receipt_id", "gaps", "work_items"]) ||
      typeof p.orientation_receipt_id !== "string" || !UUID.test(p.orientation_receipt_id) ||
      !Array.isArray(p.gaps) || p.gaps.length > 50 || !p.gaps.every(g => text(g, 2000)) ||
      !Array.isArray(p.work_items) || !p.work_items.length || p.work_items.length > 50) return null;
  const names = new Set<string>();
  for (const item of p.work_items) {
    if (!object(item) || !keys(item, ["id", "question", "deliverable", "specialty", "depends_on", "source_receipt_ids"]) ||
        !id(item.id) || names.has(item.id) || !text(item.question, 2000) || !text(item.deliverable, 2000) ||
        !editorialSpecialist(item.specialty) ||
        !Array.isArray(item.depends_on) || item.depends_on.length > 50 || !item.depends_on.every(id) || new Set(item.depends_on).size !== item.depends_on.length ||
        !Array.isArray(item.source_receipt_ids) || item.source_receipt_ids.length > 40 ||
        !item.source_receipt_ids.every((r: unknown) => typeof r === "string" && UUID.test(r)) || new Set(item.source_receipt_ids).size !== item.source_receipt_ids.length) return null;
    names.add(item.id);
  }
  const complete = new Set<string>();
  while (complete.size < names.size) {
    let progress = false;
    for (const item of p.work_items) if (!complete.has(item.id) && item.depends_on.every((d: string) => complete.has(d))) { complete.add(item.id); progress = true; }
    if (!progress) return null;
  }
  return value as unknown as SaveEditorialPlan;
}
export async function saveEditorialPlan(input: SaveEditorialPlan, rpc = dataRpc) {
  return rpc("editorial_save_plan", { p_topic_id: input.topic_id, p_expected_version: input.expected_version, p_request_id: input.request_id, p_plan: input.plan });
}
type Read = (method: string, path: string) => Promise<any>;
export async function readEditorialPlans(topicId: number, before: number | null = null, read: Read = dataApi) {
  if (!Number.isSafeInteger(topicId) || topicId <= 0 || (before !== null && (!Number.isSafeInteger(before) || before <= 0))) throw Error("Invalid plan query");
  const rows = await read("GET", `editorial_plans?topic_id=eq.${topicId}&select=id,topic_id,version,state,plan,created_at&order=version.desc&limit=20${before === null ? "" : `&version=lt.${before}`}`);
  if (!Array.isArray(rows)) throw Error("Invalid plan response");
  return { plans: rows, next_before: rows.length === 20 ? rows.at(-1).version : null };
}
