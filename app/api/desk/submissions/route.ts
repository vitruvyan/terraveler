import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({
      submissions: subs.map((s: any) => ({
        ...s,
        contributor: byId[s.contributor_id] ?? null,
        audit: auditBySub[s.id] ?? [],
        reviews: reviewsBySub[s.id] ?? [],
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
