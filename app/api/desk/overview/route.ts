import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";
import { PENDING_STATUSES, hasEscalateFinding } from "@/lib/deskEscalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ships' Officers §8 (brake 2): appealed submissions and the Curator's
// `escalate` findings are the two states the mycelium will eventually route
// to a human — and until they show up here, they reach nobody. This queue is
// exactly what desk_review.py leaves pending: it selects from
// ('submitted','peer-review','human-review') and, on an ESCALATE finding,
// records verdict='escalate' in audit_log *without* touching submissions.status
// (scripts/desk_review.py record()) — so the submission sits in its ordinary
// status forever unless something reads the audit trail for it. This route is
// that something.

/** Quarterdeck numbers: state counts across the governance tables plus the
 *  tail of the audit log — the admin overview is a read layer over the audit
 *  trail the system already keeps. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const [subs, gaps, contributors, reviews, audit, demand, escalationAudit] = await Promise.all([
      sb("GET", "submissions?select=id,status&limit=1000"),
      sb("GET", "editorial_gaps?select=status&limit=1000"),
      sb("GET", "contributors?select=status&limit=1000"),
      sb("GET", "reviews?select=id&limit=1000").catch(() => []),
      sb("GET", "audit_log?order=id.desc&limit=40&select=submission_id,actor,action,verdict,findings,created_at"),
      // What readers looked for and the atlas lacked — roadmap written by
      // demand rather than guesswork. Optional: absent before the migration.
      sb("GET", "search_misses?status=eq.open&order=hits.desc,last_seen.desc&limit=12&select=id,query,hits,first_seen,last_seen")
        .catch(() => []),
      // Newest first, so the first row seen per submission_id below is that
      // submission's LATEST audit_log entry — a status carries forward until
      // something rules again, and so must the escalation flag derived from it.
      sb("GET", "audit_log?order=id.desc&limit=1000&select=submission_id,findings"),
    ]);
    const tally = (rows: any[]) =>
      rows.reduce((acc: Record<string, number>, r: any) => {
        const k = r.status ?? "unknown";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});

    const latestFindingsBySubmission = new Map<number, unknown>();
    for (const row of escalationAudit) {
      if (row.submission_id == null || latestFindingsBySubmission.has(row.submission_id)) continue;
      latestFindingsBySubmission.set(row.submission_id, row.findings);
    }
    const escalations = subs.filter((s: any) =>
      PENDING_STATUSES.includes(s.status) &&
      hasEscalateFinding(latestFindingsBySubmission.get(s.id)),
    ).length;
    const appealed = subs.filter((s: any) => s.status === "appealed").length;

    return NextResponse.json({
      counts: {
        submissions: tally(subs),
        gaps: tally(gaps),
        contributors: tally(contributors),
        reviews_total: reviews.length,
        appealed,
        escalations,
      },
      feed: audit,
      demand,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
