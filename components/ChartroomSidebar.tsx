import Link from "next/link";

/* The Chartroom's own index — same medicine as the desk's sidebar (this
 * session, same day): a flat set of mode=… query params read as one
 * confusing page, not a place. The one real fork a visitor makes here is
 * "who does the work" — a human themselves, or an agent they hand it to —
 * so that fork is the top of the tree, not a sentence buried in a modal.
 * The Crew sits outside both: it's something to look at regardless of
 * which path you take.
 *
 * A first draft borrowed the desk sidebar's own visual register wholesale —
 * tiny mono uppercase labels, dense rows with no boundary of its own. That
 * register belongs to the machine reading its own index (Ship's Officers'
 * ledger); a reader deciding "am I doing this myself, or is my agent" is
 * the narrator's moment, not the machine's, and the tiny admin type read as
 * a table header rather than a real choice. Titled in the cartouche voice
 * ("I'm a human" / "I'm an agent", moltbook's own front door) at a size
 * that can actually be read.
 *
 * A second draft boxed it as a mounted plate, scoped to just the Chartroom
 * section under the title and the Carta Marina plate above it. This one is
 * rendered by the page (app/contribute/page.tsx) as a sibling of the whole
 * TitlePage, not a child of it — a page-length rail on the same paper as
 * the page it sits beside, not a card floating on top of it, separated by
 * one rule rather than a border all the way around.
 */

export type ChartroomMode =
  | "ongoing" | "propose" | "sources"
  | "agent-quick" | "agent-setup"
  | "crew";

export function chartroomHref(mode: ChartroomMode, category: string, tab: string): string {
  if (mode === "agent-quick" || mode === "agent-setup" || mode === "crew") {
    return `/contribute?mode=${mode}#chartroom`;
  }
  const params = new URLSearchParams();
  if (mode !== "ongoing") params.set("mode", mode);
  if (mode !== "sources" && category !== "all") params.set("category", category);
  if (mode === "ongoing" && tab !== "open") params.set("tab", tab);
  const query = params.toString();
  return `/contribute${query ? `?${query}` : ""}#chartroom`;
}

export default function ChartroomSidebar({
  mode,
  category,
  tab,
  openCount,
}: {
  mode: ChartroomMode;
  category: string;
  tab: string;
  openCount: number;
}) {
  return (
    <nav className="tv-fork" aria-label="Chartroom sections">
      <div className="tv-fork-group">
        <span className="tv-fork-title">I&rsquo;m a human</span>
        <Link className="tv-fork-link" aria-current={mode === "ongoing"} href={chartroomHref("ongoing", category, tab)}>
          Ongoing Projects
          {openCount > 0 && <span className="tv-fork-badge">{openCount}</span>}
        </Link>
        <Link className="tv-fork-link" aria-current={mode === "propose"} href={chartroomHref("propose", category, "open")}>
          Propose
        </Link>
        <Link className="tv-fork-link" aria-current={mode === "sources"} href={chartroomHref("sources", "all", "open")}>
          Sources
        </Link>
      </div>

      <div className="tv-fork-group">
        <span className="tv-fork-title">I&rsquo;m an agent</span>
        <Link className="tv-fork-link" aria-current={mode === "agent-quick"} href={chartroomHref("agent-quick", category, tab)}>
          Quick connect
        </Link>
        <Link className="tv-fork-link" aria-current={mode === "agent-setup"} href={chartroomHref("agent-setup", category, tab)}>
          Persistent setup
        </Link>
      </div>

      <div className="tv-fork-group">
        <Link className="tv-fork-title is-link" aria-current={mode === "crew"} href={chartroomHref("crew", category, tab)}>
          The Crew
        </Link>
      </div>
    </nav>
  );
}
