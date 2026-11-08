/**
 * An Ongoing Project, as one stable page can state it.
 *
 * A project is an `editorial_gaps` row (the Chartroom's Waypoint). When it was
 * born from an approved idea (lib/ideaProject.ts) it carries the proposal it
 * came from, and the page can say who decided what, and when.
 *
 * This file only READS and only states what the records say. Where the system
 * does not yet know something — drafts are not attached to a project — the page
 * says so instead of showing an empty list that looks like "nothing happened".
 */
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";

export type ProjectRecord = {
  id: number;
  title: string;
  description: string | null;
  kind: string;
  priority: number;
  status: string; // open | claimed | done  (storage vocabulary)
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string | null;
  source_submission_id: number | null;
};

export type TrailRow = {
  actor: string;
  action: string;
  verdict: string | null;
  carta_version: string | null;
  created_at: string;
};

export type ProjectView = {
  project: ProjectRecord;
  proposedAt: string | null;
  trail: TrailRow[];
};

/** The three stages this page can actually know. */
export type StageKey = "proposed" | "approved" | "taken";
export type StageState = "done" | "current" | "pending";
export type Stage = { key: StageKey; label: string; state: StageState; note: string };

function headers(): Record<string, string> {
  return POSTGREST_SERVICE_KEY
    ? { apikey: POSTGREST_SERVICE_KEY, Authorization: `Bearer ${POSTGREST_SERVICE_KEY}` }
    : {};
}

async function read(path: string): Promise<any[] | null> {
  if (!POSTGREST_URL) return null;
  try {
    const r = await fetch(`${POSTGREST_URL}/rest/v1/${path}`, {
      headers: headers(),
      next: { revalidate: 60 },
    });
    if (!r.ok) return null;
    return (await r.json()) as any[];
  } catch {
    return null;
  }
}

const BASE = "id,title,description,kind,priority,status,claimed_by,claimed_at,created_at";

export async function loadProject(id: number): Promise<ProjectView | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  // The link column ships with supabase/gap_from_approved_idea.sql. Ask for it
  // first; if the database predates it, fall back so reader-requested projects
  // still have a page instead of a 404.
  let rows = await read(`editorial_gaps?id=eq.${id}&select=${BASE},source_submission_id&limit=1`);
  if (rows === null) rows = await read(`editorial_gaps?id=eq.${id}&select=${BASE}&limit=1`);
  if (!rows?.length) return null;

  const project: ProjectRecord = {
    ...rows[0],
    id: Number(rows[0].id),
    source_submission_id: rows[0].source_submission_id != null ? Number(rows[0].source_submission_id) : null,
  };

  let trail: TrailRow[] = [];
  let proposedAt: string | null = null;
  if (project.source_submission_id) {
    const sid = project.source_submission_id;
    const [audit, sub] = await Promise.all([
      read(`audit_log?submission_id=eq.${sid}&order=id.asc&select=actor,action,verdict,carta_version,created_at`),
      read(`submissions?id=eq.${sid}&select=created_at&limit=1`),
    ]);
    trail = (audit ?? []) as TrailRow[];
    proposedAt = sub?.[0]?.created_at ?? null;
  }
  return { project, proposedAt, trail };
}

const GENERATED_HEADER = /^Approved proposal #\d+\./;

/** The brief a Scribe reads: the proposal's own text, without the generated
 *  header paragraph (the page states that itself, in its own voice). */
export function briefParagraphs(description: string | null): string[] {
  if (!description) return [];
  const parts = description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return parts.length && GENERATED_HEADER.test(parts[0]) ? parts.slice(1) : parts;
}

export function fromProposal(project: ProjectRecord): boolean {
  return project.source_submission_id != null;
}

/** Where the project stands, from what is recorded and nothing inferred. */
export function stagesFor(view: ProjectView): Stage[] {
  const { project, trail } = view;
  const approved = trail.some((t) => t.action === "verdict" && t.verdict === "approve");
  const taken = project.status === "claimed" || project.status === "done";

  const stages: Stage[] = [];
  if (fromProposal(project)) {
    stages.push({
      key: "proposed",
      label: "Proposed",
      state: "done",
      note: `Proposal #${project.source_submission_id}`,
    });
    stages.push({
      key: "approved",
      label: "Approved",
      state: approved ? "done" : "current",
      note: approved ? "The editor approved the idea" : "Waiting for the editor",
    });
  } else {
    stages.push({ key: "proposed", label: "Asked for", state: "done", note: "Requested by readers or the desk" });
    stages.push({ key: "approved", label: "Accepted", state: "done", note: "Placed on the roadmap" });
  }
  stages.push({
    key: "taken",
    label: "Taken",
    state: taken ? "done" : "current",
    note: taken
      ? project.status === "done"
        ? "Finished"
        : `By ${project.claimed_by ?? "a Voyager"}`
      : "Waiting for an author",
  });
  return stages;
}

export type NextStep = { who: string; what: string; command: string | null };

/** Who has to act now. A project that looks abandoned is the defect this page
 *  exists to remove, so the answer is always written down. */
export function nextStep(project: ProjectRecord, approved: boolean): NextStep {
  if (fromProposal(project) && !approved) {
    return { who: "The editor", what: "Rule on the proposal.", command: null };
  }
  if (project.status === "open") {
    return {
      who: "The proposing Voyager, or any Scribe",
      what: "Take the project, then research it and submit a draft with its sources.",
      command: `claim_gap { gap_id: ${project.id} }`,
    };
  }
  if (project.status === "claimed") {
    return {
      who: project.claimed_by ?? "The Voyager who took it",
      what: "Submit a draft. Unworked projects expire after their claim period and reopen.",
      command: "submit_draft { submission }",
    };
  }
  return { who: "No one", what: "This project is finished.", command: null };
}
