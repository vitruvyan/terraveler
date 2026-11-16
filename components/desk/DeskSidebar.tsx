"use client";
import AdminNavigation from "./AdminNavigation";

/* Shared navigation replaces the old sidebar. Keep these section and count
 * types for existing admin callers and specimen fixtures. */

export type Section = "dashboard" | "workspace" | "content" | "overview" | "submissions" | "sources" | "users" | "waypoints" | "prompts" | "analytics";
export type SubmissionsSub = "needs_verdict" | "peer_review" | "history";
/* Replaces the old four (pending/flagged/drift/resolved), which were
 * organised by which source table held the row rather than by the editor's
 * actual question. See SourceGovernance.tsx's header comment. */
export type SourcesSub = "pending" | "dossier" | "reverify";
export type UsersSub = "humans" | "agents";

export type DeskSidebarCounts = {
  needsVerdict: number;
  peerReview: number;
  history: number;
  pending: number;
  /** Endpoints needs_human_review or quarantined — the old `flagged` tab's
   *  own badge, now surfaced on the Dossier that folded that tab in. */
  flagged: number;
  sources?: number;
  claimed: number;
  claimedOverdue: number;
  humans: number;
  agents: number;
};

export type DeskSidebarProps = {
  section: Section;
  submissionsSub: SubmissionsSub;
  sourcesSub: SourcesSub;
  usersSub: UsersSub;
  counts: DeskSidebarCounts;
  /** Optional so a Server Component (the /specimen chapter) can render this
   *  with fixture data without crossing the client-function boundary —
   *  same reason SourceGovernance.tsx's onResolve is optional. */
  onNavigate?: (section: Section, sub?: string) => void;
};

/** Compatibility wrapper for specimen callers; the application uses the same navigation on every admin page. */
export default function DeskSidebar({ section, submissionsSub, sourcesSub, usersSub }: DeskSidebarProps) {
  const params = new URLSearchParams({ tab: section });
  if (section === "submissions") params.set("sub", submissionsSub);
  if (section === "sources") params.set("sub", sourcesSub);
  if (section === "users") params.set("sub", usersSub);
  return <AdminNavigation active={section === "dashboard" ? "dashboard" : section === "workspace" ? "workspace" : "administration"} currentHref={`/desk?${params}`} />;
}
