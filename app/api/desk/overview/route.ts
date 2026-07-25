import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quarterdeck numbers: state counts across the governance tables plus the
 *  tail of the audit log — the admin overview is a read layer over the audit
 *  trail the system already keeps. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const [subs, gaps, contributors, reviews, audit] = await Promise.all([
      sb("GET", "submissions?select=status&limit=1000"),
      sb("GET", "editorial_gaps?select=status&limit=1000"),
      sb("GET", "contributors?select=status&limit=1000"),
      sb("GET", "reviews?select=id&limit=1000").catch(() => []),
      sb("GET", "audit_log?order=id.desc&limit=40&select=submission_id,actor,action,verdict,findings,created_at"),
    ]);
    const tally = (rows: any[]) =>
      rows.reduce((acc: Record<string, number>, r: any) => {
        const k = r.status ?? "unknown";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
    return NextResponse.json({
      counts: {
        submissions: tally(subs),
        gaps: tally(gaps),
        contributors: tally(contributors),
        reviews_total: reviews.length,
      },
      feed: audit,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
