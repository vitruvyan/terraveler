import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { dataApi, dataRpc, requireEditor } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = [
  "id", "title", "waypoint_type", "kind", "claimed_by", "claimed_at",
  "context_voyage", "context_waypoint_seq", "priority",
].join(",");

/** Every Waypoint currently claimed, oldest hold first — the editor needs to
 *  see what has been sitting the longest, since that is what the automatic
 *  TTL reap (lazy: it only runs as a side effect of someone else claiming or
 *  listing gaps) may never actually reach. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const rows = await dataApi("GET",
      `editorial_gaps?status=eq.claimed&order=claimed_at.asc.nullsfirst&select=${SELECT}`);
    return NextResponse.json({ claims: rows });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

/** Release a claim by hand, regardless of its TTL — the editor's own
 *  override for a Waypoint stuck on a contributor who has gone quiet.
 *  See desk_release_claim() in supabase/desk_claim_release.sql. */
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { gap_id } = await req.json().catch(() => ({}));
  const id = Number(gap_id);
  if (!id) return NextResponse.json({ error: "gap_id required" }, { status: 400 });
  try {
    const result = await dataRpc("desk_release_claim", {
      p_gap_id: id, p_actor: "editor-in-chief", p_carta: CARTA_VERSION,
    });
    if (result?.error) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, released: result.released });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
