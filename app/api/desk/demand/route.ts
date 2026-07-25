import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARTA_VERSION = "0.2";

/**
 * Acts on the demand log: what readers searched for and the atlas lacked.
 *
 * `promote` turns a request into an editorial gap — the roadmap Scribes work
 * from — which is the whole point of recording misses: the backlog stops being
 * the desk's guess about what is wanted and starts being what was actually
 * asked for. `dismiss` files it as out of scope so it stops resurfacing.
 * Either way the decision lands in the audit trail, like every other one.
 */
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { id, action, kind, priority } = await req.json().catch(() => ({}));
  const missId = Number(id);
  if (!missId || !["promote", "dismiss"].includes(String(action))) {
    return NextResponse.json({ error: "id and action (promote|dismiss) required" }, { status: 400 });
  }

  try {
    const rows = await sb("GET", `search_misses?id=eq.${missId}&select=id,query,hits`);
    if (!rows.length) return NextResponse.json({ error: "no such entry" }, { status: 404 });
    const { query, hits } = rows[0];

    if (action === "promote") {
      const allowed = ["voyage", "waypoint", "media", "perspective", "translation", "correction"];
      await sb("POST", "editorial_gaps", {
        title: String(query).slice(0, 200),
        description:
          `Requested by readers: searched ${hits} time(s) in the atlas with no result. ` +
          `Scope and sources to be assessed before drafting.`,
        kind: allowed.includes(String(kind)) ? kind : "voyage",
        priority: Number(priority) >= 1 && Number(priority) <= 5 ? Number(priority) : 2,
      });
    }

    await sb("PATCH", `search_misses?id=eq.${missId}`, {
      status: action === "promote" ? "promoted" : "dismissed",
    });

    await sb("POST", "audit_log", {
      submission_id: null,
      actor: "editor-in-chief",
      action: `demand-${action}`,
      verdict: null,
      findings: [["INFO", 5, `'${query}' (${hits} searches) ${action === "promote" ? "promoted to the roadmap" : "dismissed as out of scope"}`]],
      carta_version: CARTA_VERSION,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
