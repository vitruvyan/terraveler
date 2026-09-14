"use client";

/* The desk's own index. Reads like the table of contents of a bound ledger,
 * not an app's icon rail — flat, brass rule for "you are here", mono badges
 * for the counts (see the design law: chrome that states a fact is the
 * machine speaking). Quarterdeck/Crew/Analytics are single entries; only
 * Submissions and Sources have earned subsections, which is exactly why
 * they get a non-clickable group label above theirs instead of being a
 * fourth kind of thing to learn.
 */

export type Section = "overview" | "submissions" | "sources" | "crew" | "prompts" | "analytics";
export type SubmissionsSub = "needs_verdict" | "peer_review" | "history";
export type SourcesSub = "pending" | "flagged" | "drift" | "resolved";

export type DeskSidebarCounts = {
  needsVerdict: number;
  peerReview: number;
  history: number;
  pending: number;
  flagged: number;
  drift: number;
  resolved: number;
};

export type DeskSidebarProps = {
  section: Section;
  submissionsSub: SubmissionsSub;
  sourcesSub: SourcesSub;
  counts: DeskSidebarCounts;
  /** Optional so a Server Component (the /specimen chapter) can render this
   *  with fixture data without crossing the client-function boundary —
   *  same reason SourceGovernance.tsx's onResolve is optional. */
  onNavigate?: (section: Section, sub?: string) => void;
};

function Badge({ n, alarm }: { n: number; alarm?: boolean }) {
  return <span className={`dk-nav-badge${alarm && n > 0 ? " is-alarm" : ""}`}>{n}</span>;
}

export default function DeskSidebar({ section, submissionsSub, sourcesSub, counts, onNavigate }: DeskSidebarProps) {
  return (
    <nav className="dk-sidebar" aria-label="desk sections">
      <div className="dk-nav-group">
        <button
          type="button"
          className="dk-nav-heading is-link"
          aria-current={section === "overview"}
          onClick={() => onNavigate?.("overview")}
        >
          Quarterdeck
        </button>
      </div>

      <div className="dk-nav-group">
        <span className="dk-nav-heading">Submissions</span>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "submissions" && submissionsSub === "needs_verdict"}
          onClick={() => onNavigate?.("submissions", "needs_verdict")}
        >
          Needs your verdict <Badge n={counts.needsVerdict} alarm />
        </button>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "submissions" && submissionsSub === "peer_review"}
          onClick={() => onNavigate?.("submissions", "peer_review")}
        >
          In peer review <Badge n={counts.peerReview} />
        </button>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "submissions" && submissionsSub === "history"}
          onClick={() => onNavigate?.("submissions", "history")}
        >
          History <Badge n={counts.history} />
        </button>
      </div>

      <div className="dk-nav-group">
        <span className="dk-nav-heading">Sources</span>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "sources" && sourcesSub === "pending"}
          onClick={() => onNavigate?.("sources", "pending")}
        >
          Pending proposals <Badge n={counts.pending} alarm />
        </button>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "sources" && sourcesSub === "flagged"}
          onClick={() => onNavigate?.("sources", "flagged")}
        >
          Flagged endpoints <Badge n={counts.flagged} alarm />
        </button>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "sources" && sourcesSub === "drift"}
          onClick={() => onNavigate?.("sources", "drift")}
        >
          Material drift <Badge n={counts.drift} alarm />
        </button>
        <button
          type="button"
          className="dk-nav-sub"
          aria-current={section === "sources" && sourcesSub === "resolved"}
          onClick={() => onNavigate?.("sources", "resolved")}
        >
          Resolved decisions <Badge n={counts.resolved} />
        </button>
      </div>

      <div className="dk-nav-group">
        <button
          type="button"
          className="dk-nav-heading is-link"
          aria-current={section === "crew"}
          onClick={() => onNavigate?.("crew")}
        >
          Crew
        </button>
      </div>

      <div className="dk-nav-group">
        <button
          type="button"
          className="dk-nav-heading is-link"
          aria-current={section === "prompts"}
          onClick={() => onNavigate?.("prompts")}
        >
          Prompts
        </button>
      </div>

      <div className="dk-nav-group">
        <button
          type="button"
          className="dk-nav-heading is-link"
          aria-current={section === "analytics"}
          onClick={() => onNavigate?.("analytics")}
        >
          Analytics
        </button>
      </div>

      {/* The specimen chapters are working documents about the site, not
          part of its own navigation tree — kept visually apart, never
          taking the aria-current treatment above. */}
      <div className="dk-nav-footer">
        <span className="dk-nav-footer-label">the system</span>
        <a className="dk-tab-link" href="/specimen">type</a>
        <a className="dk-tab-link" href="/specimen/palette">colour</a>
        <a className="dk-tab-link" href="/specimen/mark">mark</a>
      </div>
    </nav>
  );
}
