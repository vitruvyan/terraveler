import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";
import { PENDING_STATUSES, hasEscalateFinding } from "@/lib/deskEscalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The desk's own "needs action vs. history" split, applied here the same
 * way it already was to Sources — and computed with the exact same
 * PENDING_STATUSES / hasEscalateFinding /api/desk/overview uses for its
 * escalation count, so the two routes can't drift on what "escalated"
 * means (see lib/deskEscalation.ts).
 *
 *   needs_verdict — appealed (Carta §5, the editor alone rules), human-review
 *                   (ideas/suggestions skip peer review entirely), or a
 *                   submitted/peer-review draft the Curator escalated
 *   peer_review   — submitted/peer-review, not escalated: still with other
 *                    contributors, nothing for the editor here yet
 *   history       — approved, rejected, curator-rejected, changes-requested:
 *                    settled, or (changes-requested) the next move belongs
 *                    to the contributor, not the editor
 */
function bucket(status: string, escalated: boolean): "needs_verdict" | "peer_review" | "history" {
  if (status === "appealed" || status === "human-review") return "needs_verdict";
  if (PENDING_STATUSES.includes(status)) return escalated ? "needs_verdict" : "peer_review";
  return "history";
}

export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const subs = await sb("GET",
      "submissions?order=id.desc&limit=100&select=id,type,target_voyage,status,carta_version,created_at,payload,contributor_id");
    const contributors = await sb("GET", "contributors?select=id,handle,rank");
    const audit = await sb("GET",
      "audit_log?order=id.asc&select=submission_id,actor,action,verdict,findings,created_at");
    const reviews = await sb("GET",
      "reviews?order=id.asc&select=submission_id,reviewer_id,verdict,findings,created_at")
      .catch(() => []); // table may predate the peer-review migration
    const byId: Record<number, any> = {};
    for (const c of contributors) byId[c.id] = c;
    const auditBySub: Record<number, any[]> = {};
    for (const a of audit) {
      if (a.submission_id == null) continue;
      (auditBySub[a.submission_id] ??= []).push(a);
    }
    const reviewsBySub: Record<number, any[]> = {};
    for (const r of reviews) {
      (reviewsBySub[r.submission_id] ??= []).push({ ...r, reviewer: byId[r.reviewer_id] ?? null });
    }

    const grouped: { needs_verdict: any[]; peer_review: any[]; history: any[] } =
      { needs_verdict: [], peer_review: [], history: [] };
    for (const s of subs) {
      const subAudit = auditBySub[s.id] ?? [];
      const escalated = subAudit.length > 0 && hasEscalateFinding(subAudit[subAudit.length - 1].findings);
      const full = {
        ...s,
        contributor: byId[s.contributor_id] ?? null,
        audit: subAudit,
        reviews: reviewsBySub[s.id] ?? [],
        escalated,
      };
      grouped[bucket(s.status, escalated)].push(full);
    }

    return NextResponse.json(grouped);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
