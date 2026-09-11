import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { dataApi, dataRpc, getUser, readCookie } from "@/lib/deskAuth";
import { ensureHumanContributor } from "@/lib/humanContributor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const token = readCookie(req);
    const user = token ? await getUser(token) : null;
    if (!user) {
      return NextResponse.json({ error: "Sign in to release a Voyager offer." }, { status: 401 });
    }

    const contributor = await ensureHumanContributor(user);
    if (contributor.status !== "active") {
      return NextResponse.json({ error: "This contributor is suspended." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const waypointId = Number(body?.waypoint_id);
    if (!Number.isInteger(waypointId) || waypointId <= 0) {
      return NextResponse.json({ error: "A valid Waypoint is required." }, { status: 400 });
    }

    const result = await dataRpc("chartroom_release_waypoint_offer", {
      p_human_principal_id: contributor.humanPrincipalId,
      p_human_contributor_id: contributor.id,
      p_waypoint_id: waypointId,
      p_carta: CARTA_VERSION,
    });
    if (result?.error) {
      const forbidden = /only the human contributor/i.test(String(result.error));
      return NextResponse.json({ error: result.error }, { status: forbidden ? 403 : 409 });
    }

    // The first Chartroom iteration appended a human-readable reservation
    // marker to description so old list_gaps clients could see whom the work was
    // addressed to. Remove exactly that marker when the offer is released;
    // failure here must never roll back a successful release.
    try {
      const released = result?.released ?? {};
      const marker = `Requested Voyager: ${released.agent_name} (${released.agent_id}).`;
      const rows = await dataApi(
        "GET",
        `editorial_gaps?id=eq.${waypointId}&select=description&limit=1`,
      );
      const before = typeof rows?.[0]?.description === "string" ? rows[0].description : "";
      if (before.includes(marker)) {
        const after = before
          .split(/\n{2,}/)
          .filter((part: string) => part.trim() !== marker)
          .join("\n\n")
          .trim();
        await dataApi("PATCH", `editorial_gaps?id=eq.${waypointId}`, {
          description: after || null,
        });
      }
    } catch {
      // Compatibility copy is secondary to the authoritative structured state.
    }

    return NextResponse.json({ ok: true, waypoint: result.released, status: "open" });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
