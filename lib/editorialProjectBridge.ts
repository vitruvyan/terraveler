/** An association between canonical dossiers and existing public work items.
 * No second project lifecycle, publication authority or claim permission.
 */
import { dataApi, dataRpc } from "@/lib/deskAuth";
type Read = (method: string, path: string) => Promise<any>;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export type ProjectBridgeRequest = { topic_id: number; submission_id: number; request_id: string; gap_id: number | null };
export function parseProjectBridgeRequest(value: unknown): ProjectBridgeRequest | null {
 if (!value || typeof value !== "object" || Array.isArray(value)) return null;
 const v = value as Record<string, unknown>;
 if (Object.keys(v).some(k => !["topic_id", "submission_id", "request_id", "gap_id"].includes(k)) ||
  !positive(v.topic_id) || !positive(v.submission_id) || typeof v.request_id !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(v.request_id) ||
  (v.gap_id != null && !positive(v.gap_id))) return null;
 return { topic_id: v.topic_id, submission_id: v.submission_id, request_id: v.request_id, gap_id: v.gap_id == null ? null : v.gap_id };
}
export async function reconcileProject(input: ProjectBridgeRequest, rpc = dataRpc) {
 return rpc("editorial_reconcile_project", { p_topic_id: input.topic_id, p_submission_id: input.submission_id,
  p_request_id: input.request_id, p_gap_id: input.gap_id });
}
export type PublicProject = {
 topic_id: number; gap_id: number; source_submission_id: number;
 title: string; description: string | null; kind: string; status: "open" | "claimed" | "done";
 claimed_by: string | null; claimed_at: string | null;
 public_api: string; next_step: string; publication: "not-established-by-work-state";
};
function rows(value: unknown): Record<string, any>[] {
 if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object" || Array.isArray(v))) throw Error("Invalid project projection response");
 return value;
}
/** Null means no currently publishable linked project. Read failures propagate. */
export async function getPublicProject(gapId: number, read: Read = dataApi): Promise<PublicProject | null> {
 if (!positive(gapId)) throw Error("Invalid public work item ID");
 const links = rows(await read("GET", `editorial_project_bridges?gap_id=eq.${gapId}&select=topic_id,gap_id&limit=1`));
 const link = links[0];
 if (!link) return null;
 if (!positive(link.topic_id) || link.gap_id !== gapId) throw Error("Invalid project projection response");
 const gaps = rows(await read("GET", `editorial_gaps?id=eq.${gapId}&select=id,title,description,kind,status,claimed_by,claimed_at,source_submission_id&limit=1`));
 const gap = gaps[0];
 if (!gap) return null;
 if (!positive(gap.source_submission_id)) return null;
 // A previous approval must not keep a rejected/revoked proposal public.
 const approved = rows(await read("GET", `submissions?id=eq.${gap.source_submission_id}&type=eq.idea&status=eq.approved&select=id&limit=1`));
 if (!approved[0]) return null;
 const sourceLinks = rows(await read("GET", `editorial_topic_submissions?submission_id=eq.${gap.source_submission_id}&topic_id=eq.${link.topic_id}&select=submission_id&limit=1`));
 if (!sourceLinks[0]) return null;
 if (gap.id !== gapId || typeof gap.title !== "string" || !["open", "claimed", "done"].includes(gap.status) ||
  !["voyage", "waypoint", "media", "perspective", "translation", "correction"].includes(gap.kind)) throw Error("Invalid public project response");
 return { topic_id: link.topic_id, gap_id: gapId, source_submission_id: gap.source_submission_id,
  title: gap.title, description: typeof gap.description === "string" ? gap.description : null, kind: gap.kind, status: gap.status,
  claimed_by: typeof gap.claimed_by === "string" ? gap.claimed_by : null, claimed_at: typeof gap.claimed_at === "string" ? gap.claimed_at : null,
  public_api: `https://www.terraveler.com/api/projects/${gapId}`,
  next_step: gap.status === "open" ? "Consult list_gaps and get_contract for current eligibility; use the existing claim_gap flow only if eligible."
   : gap.status === "claimed" ? "A contributor holds this public work item. Consult the existing contribution workflow; internal agent work is separate."
   : "Work is marked done. Publication is a separate decision; check the published atlas and publication audit.",
  publication: "not-established-by-work-state" };
}
export async function getSubmissionProject(submissionId: number, read: Read = dataApi): Promise<PublicProject | null> {
 if (!positive(submissionId)) throw Error("Invalid submission ID");
 const submissions = rows(await read("GET", `submissions?id=eq.${submissionId}&type=eq.idea&status=eq.approved&select=id&limit=1`));
 if (!submissions[0]) return null;
 const topics = rows(await read("GET", `editorial_topic_submissions?submission_id=eq.${submissionId}&select=topic_id&limit=1`));
 if (!topics[0]) return null;
 if (!positive(topics[0].topic_id)) throw Error("Invalid project projection response");
 const links = rows(await read("GET", `editorial_project_bridges?topic_id=eq.${topics[0].topic_id}&select=gap_id&limit=1`));
 if (!links[0]) return null;
 return getPublicProject(links[0].gap_id, read);
}
