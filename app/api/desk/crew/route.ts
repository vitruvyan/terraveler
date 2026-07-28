import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { requireEditor, sb } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANKS = ["cabin-boy", "deckhand", "navigator", "captain", "admiral"];

/** The crew roster: public standing merged with the admin-only columns. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const [standing, contributors] = await Promise.all([
      sb("GET", "contributor_standing?select=*"),
      sb("GET", "contributors?select=id,status,api_key_hash,created_at"),
    ]);
    const admin: Record<number, any> = {};
    for (const c of contributors) admin[c.id] = c;
    return NextResponse.json({
      crew: standing.map((s: any) => ({
        ...s,
        status: admin[s.id]?.status ?? "active",
        has_key: Boolean(admin[s.id]?.api_key_hash),
        created_at: admin[s.id]?.created_at ?? null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

/** Admin actions on a contributor — every one lands in the audit trail.
 *  suspend | reactivate | set-rank (with rank) | rotate-key (returns the new
 *  key ONCE; only the sha256 is stored). */
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { contributor_id, action, rank } = await req.json().catch(() => ({}));
  const cid = Number(contributor_id);
  if (!cid || !action) {
    return NextResponse.json({ error: "contributor_id and action required" }, { status: 400 });
  }
  try {
    const rows = await sb("GET", `contributors?id=eq.${cid}&select=id,handle`);
    if (!rows.length) return NextResponse.json({ error: "no such contributor" }, { status: 404 });
    const handle = rows[0].handle;

    let detail = "";
    let newKey: string | undefined;
    switch (action) {
      case "suspend":
        await sb("PATCH", `contributors?id=eq.${cid}`, { status: "suspended" });
        detail = `'${handle}' suspended`;
        break;
      case "reactivate":
        await sb("PATCH", `contributors?id=eq.${cid}`, { status: "active" });
        detail = `'${handle}' reactivated`;
        break;
      case "set-rank":
        if (!RANKS.includes(String(rank))) {
          return NextResponse.json({ error: `rank must be one of: ${RANKS.join(", ")}` }, { status: 400 });
        }
        await sb("PATCH", `contributors?id=eq.${cid}`, { rank });
        detail = `'${handle}' rank set to ${rank}`;
        break;
      case "rotate-key":
        newKey = randomBytes(24).toString("hex");
        await sb("PATCH", `contributors?id=eq.${cid}`, {
          api_key_hash: createHash("sha256").update(newKey).digest("hex"),
        });
        detail = `'${handle}' api_key rotated`;
        break;
      default:
        return NextResponse.json({ error: "action must be suspend | reactivate | set-rank | rotate-key" }, { status: 400 });
    }

    await sb("POST", "audit_log", {
      submission_id: null,
      actor: "editor-in-chief",
      action: `crew-${action}`,
      verdict: null,
      findings: [["INFO", 5, detail]],
      carta_version: CARTA_VERSION,
    });
    return NextResponse.json({ ok: true, detail, ...(newKey ? { api_key: newKey } : {}) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
