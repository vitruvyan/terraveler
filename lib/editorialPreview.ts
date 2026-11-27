import { dataApi } from "@/lib/deskAuth";
import { positiveTopic } from "@/lib/editorialProjects";

type Read = (method: string, path: string) => Promise<any>;
export type EditorialPreviewWaypoint = {
  id: string; sequence: number; place_historical: string; place_modern: string | null;
  latitude: number; longitude: number; arrival_date: string | null; departure_date: string | null;
  date_note: string | null; event: string; coordinate_note: string; source_ids: string[];
  confidence: "certain" | "approximate" | "reconstructed"; uncertainty: string | null;
};
export type EditorialPreview = {
  topic: { id: number; title: string };
  result_id: number; task_id: number; created_at: string;
  title: string; paragraphs: { text: string; source_ids: string[] }[];
  sources: { id: string; title: string; href: string | null; rights: string }[];
  waypoints: EditorialPreviewWaypoint[]; waypoints_omitted: number;
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
const optionalText = (v: unknown, limit: number) => v === null || text(v, limit);
function partialDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.test(value)) return false;
  const [, year, month, day] = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/)!;
  if (Number(year) < 1 || (month !== undefined && (Number(month) < 1 || Number(month) > 12))) return false;
  if (day === undefined) return true;
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() === Number(month) - 1 && parsed.getUTCDate() === Number(day);
}
function previewWaypoints(value: unknown, known: Set<string>): { values: EditorialPreviewWaypoint[]; omitted: number } {
  if (value === undefined) return { values: [], omitted: 0 };
  if (!Array.isArray(value) || value.length > 40) throw new Error("Invalid waypoints");
  const values: EditorialPreviewWaypoint[] = [];
  const ids = new Set<string>(), sequences = new Set<number>();
  let omitted = 0;
  for (const waypoint of value) {
    const valid = waypoint && typeof waypoint === "object" && !Array.isArray(waypoint) &&
      text(waypoint.id, 80) && /^[a-z0-9][a-z0-9-]{0,79}$/.test(waypoint.id) && !ids.has(waypoint.id) &&
      Number.isInteger(waypoint.sequence) && waypoint.sequence >= 1 && waypoint.sequence <= 200 && !sequences.has(waypoint.sequence) &&
      text(waypoint.place_historical, 500) && optionalText(waypoint.place_modern, 500) &&
      typeof waypoint.latitude === "number" && Number.isFinite(waypoint.latitude) && waypoint.latitude >= -90 && waypoint.latitude <= 90 &&
      typeof waypoint.longitude === "number" && Number.isFinite(waypoint.longitude) && waypoint.longitude >= -180 && waypoint.longitude <= 180 &&
      partialDate(waypoint.arrival_date) && partialDate(waypoint.departure_date) && optionalText(waypoint.date_note, 500) &&
      text(waypoint.event, 5000) && text(waypoint.coordinate_note, 500) && optionalText(waypoint.uncertainty, 500) &&
      ["certain", "approximate", "reconstructed"].includes(waypoint.confidence) && (waypoint.confidence === "certain" || text(waypoint.uncertainty, 500)) &&
      Array.isArray(waypoint.source_ids) && waypoint.source_ids.length > 0 && new Set(waypoint.source_ids).size === waypoint.source_ids.length && waypoint.source_ids.every((id: unknown) => typeof id === "string" && known.has(id));
    if (!valid) { omitted++; continue; }
    ids.add(waypoint.id); sequences.add(waypoint.sequence);
    values.push({ id: waypoint.id, sequence: waypoint.sequence, place_historical: waypoint.place_historical,
      place_modern: waypoint.place_modern, latitude: waypoint.latitude, longitude: waypoint.longitude,
      arrival_date: waypoint.arrival_date, departure_date: waypoint.departure_date, date_note: waypoint.date_note,
      event: waypoint.event, coordinate_note: waypoint.coordinate_note, source_ids: [...waypoint.source_ids],
      confidence: waypoint.confidence, uncertainty: waypoint.uncertainty });
  }
  values.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  return { values, omitted };
}
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
  // A draft can have several reviewers (copyedit, factcheck): take the latest
  // result of each and let the most severe verdict win, so a later clean
  // review can never hide a blocking one.
  const reviews = await read("GET", `editorial_results?select=task_id,result,editorial_tasks!inner(topic_id,role,dependency_id)&editorial_tasks.topic_id=eq.${topicId}&editorial_tasks.role=eq.reviewer&editorial_tasks.dependency_id=eq.${row.task_id}&order=id.desc&limit=50`);
  if (!Array.isArray(reviews)) throw new Error("Invalid preview response");
  const latest = new Map<number, any>();
  for (const review of reviews) if (Number.isSafeInteger(review?.task_id) && !latest.has(review.task_id)) latest.set(review.task_id, review.result);
  const validOne = (v: any) => v?.kind === "review" && ["ready-for-editor", "changes-requested", "blocked"].includes(v.verdict) && Array.isArray(v.issues) && v.issues.length <= 100 && v.issues.every((i: unknown) => text(i, 12000)) && (v.verdict === "ready-for-editor" ? v.issues.length === 0 : v.issues.length > 0);
  const values = [...latest.values()];
  const validReview = values.length > 0 && values.every(validOne) && reviews.every((v: any) => Number.isSafeInteger(v?.task_id));
  const severity = ["ready-for-editor", "changes-requested", "blocked"];
  const r = validReview ? { verdict: values.map(v => v.verdict).sort((a, b) => severity.indexOf(b) - severity.indexOf(a))[0],
    issues: values.flatMap(v => v.issues).slice(0, 100) } : null;
  const route = previewWaypoints(draft.waypoints, seen);
  return { topic: { id: topicId, title: topics[0].title }, result_id: row.id, task_id: row.task_id,
    created_at: typeof row.created_at === "string" ? row.created_at : "", title: draft.title, paragraphs, sources,
    waypoints: route.values, waypoints_omitted: route.omitted,
    review: r };
}
