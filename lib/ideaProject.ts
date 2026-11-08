/**
 * An approved idea becomes an Ongoing Project.
 *
 * Approving an `idea` used to change one status field and nothing else, so the
 * approved work vanished: no Chartroom entry, nothing for the author's agent
 * to claim, no page to look at. This turns the approval into a Waypoint in
 * `editorial_gaps` — the same row the web shows under "Ongoing Projects" and
 * MCP serves through `list_gaps` / `claim_gap` — linked back to the proposal
 * through `source_submission_id` (supabase/gap_from_approved_idea.sql).
 *
 * Idempotent: approving again, or a retry, reuses the existing row.
 * It never throws: the editor's verdict is the authority, the project is its
 * consequence, and a failure to create it is reported in the audit trail
 * instead of undoing the ruling.
 */
import { sb } from "@/lib/deskAuth";

const LEGACY_KINDS = ["voyage", "waypoint", "media", "perspective", "translation", "correction"];

export type IdeaProject = {
  gapId: number;
  created: boolean;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** The text a Scribe reads when it claims the project: where it came from,
 *  what was approved, and what is still unverified. */
export function projectDescription(submissionId: number, payload: any): string {
  const body = clean(payload?.description ?? payload?.why, 6000);
  // The web proposal wizard keeps related voyages and candidate sources apart
  // from the description (app/api/chartroom/propose/route.ts). They are part
  // of what the editor approved, so they travel with the project.
  const context = clean(payload?.context, 1000);
  const evidence = clean(payload?.evidence, 1000);
  const header =
    `Approved proposal #${submissionId}. The editor approved the idea; the work itself is still to be done. ` +
    `Sources named in the proposal are candidates until a draft verifies them against the text. ` +
    `Next step: the proposing Voyager (or any Scribe) takes this project, then submits a draft.`;
  const parts = [header];
  if (body) parts.push(body);
  if (context) parts.push(`Related context, as proposed: ${context}`);
  if (evidence) parts.push(`Candidate sources named in the proposal, not yet verified: ${evidence}`);
  return parts.join("\n\n");
}

export async function projectFromApprovedIdea(submissionId: number): Promise<IdeaProject | null> {
  const existing = await sb(
    "GET",
    `editorial_gaps?source_submission_id=eq.${submissionId}&select=id&limit=1`,
  );
  if (existing?.length) return { gapId: Number(existing[0].id), created: false };

  const rows = await sb(
    "GET",
    `submissions?id=eq.${submissionId}&type=eq.idea&select=contributor_id,payload&limit=1`,
  );
  if (!rows?.length) return null;
  const payload = rows[0].payload ?? {};
  const title = clean(payload.title, 200);
  if (!title) return null;

  const kind = LEGACY_KINDS.includes(String(payload.kind)) ? String(payload.kind) : "voyage";
  const made = await sb("POST", "editorial_gaps", {
    title,
    description: projectDescription(submissionId, payload),
    kind,
    priority: 2,
    status: "open",
    source_submission_id: submissionId,
    initiated_by_contributor_id: rows[0].contributor_id ?? null,
  });
  return { gapId: Number(made[0].id), created: true };
}
