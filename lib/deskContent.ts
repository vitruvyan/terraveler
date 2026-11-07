import { ATLAS } from "@/lib/voyages";

export type DeskProject = {
  id: number;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string | null;
  source_submission_id: number | null;
};

export type DeskVoyage = {
  slug: string;
  title: string;
  href: string;
  navigator: string;
  years: string;
};

export type DeskContent = {
  projects: DeskProject[];
  voyages: DeskVoyage[];
  proposalLinksAvailable: boolean;
};

const PROJECT_FIELDS = "id,title,description,kind,status,claimed_by,claimed_at,created_at";

/** PR #104 adds this column. Only a missing-column/schema-cache failure permits
 * fallback; network, permission and other database errors must stay visible. */
export function missingProposalLink(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /source_submission_id/i.test(message) && /does not exist|could not find|schema cache|PGRST204|42703/i.test(message);
}

export async function loadDeskContent(readRows: (path: string) => Promise<unknown[]>): Promise<DeskContent> {
  let rows: unknown[];
  let proposalLinksAvailable = true;
  try {
    rows = await readRows(`editorial_gaps?order=priority.asc,id.asc&select=${PROJECT_FIELDS},source_submission_id`);
  } catch (error) {
    if (!missingProposalLink(error)) throw error;
    proposalLinksAvailable = false;
    rows = await readRows(`editorial_gaps?order=priority.asc,id.asc&select=${PROJECT_FIELDS}`);
  }
  const projects = rows.map((value) => {
    const row = value as Record<string, unknown>;
    return {
      id: Number(row.id),
      title: String(row.title),
      description: row.description == null ? null : String(row.description),
      kind: String(row.kind),
      status: String(row.status),
      claimed_by: row.claimed_by == null ? null : String(row.claimed_by),
      claimed_at: row.claimed_at == null ? null : String(row.claimed_at),
      created_at: row.created_at == null ? null : String(row.created_at),
      source_submission_id: row.source_submission_id == null ? null : Number(row.source_submission_id),
    };
  });
  return {
    projects,
    // The published atlas is the authority, never a submission's approval flag.
    voyages: ATLAS.map(({ slug, title, href, navigator, years }) => ({ slug, title, href, navigator, years })),
    proposalLinksAvailable,
  };
}

export function projectStatus(project: Pick<DeskProject, "status">): string {
  switch (project.status) {
    case "open": return "Open · waiting for an author";
    case "claimed": return "In progress · assigned";
    case "done": return "Work marked done · publication not established";
    default: return `Recorded state: ${project.status}`;
  }
}

export function projectNextStep(project: Pick<DeskProject, "status">): string {
  switch (project.status) {
    case "open": return "An eligible contributor can take this work in the Chartroom.";
    case "claimed": return "The assigned contributor prepares the work; review and publication are separate steps.";
    case "done": return "Check the published atlas separately; a completed task does not prove publication.";
    default: return "Check the record before taking further action.";
  }
}

export function filterProjects(projects: DeskProject[], query: string, status: string): DeskProject[] {
  const needle = query.trim().toLocaleLowerCase();
  return projects.filter((p) => (status === "all" || p.status === status) &&
    `${p.title} ${p.kind} ${p.claimed_by ?? ""} ${p.id} ${p.source_submission_id ?? ""}`.toLocaleLowerCase().includes(needle));
}
