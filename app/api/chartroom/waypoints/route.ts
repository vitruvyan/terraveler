import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { RANK_QUOTA } from "@/lib/agentCapabilities";
import { dataApi, dataRpc, getUser, readCookie } from "@/lib/deskAuth";
import { ensureHumanContributor } from "@/lib/humanContributor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAIM_LIMITS = Object.fromEntries(
  Object.entries(RANK_QUOTA).map(([rank, quota]) => [rank, quota.active_claims]),
);

async function signedInHuman(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  return user ? ensureHumanContributor(user) : null;
}

export async function POST(req: Request) {
  try {
    const contributor = await signedInHuman(req);
    if (!contributor) {
      return NextResponse.json({ error: "Sign in to take part in the Chartroom." }, { status: 401 });
    }
    if (contributor.status !== "active") {
      return NextResponse.json({ error: "This contributor is suspended." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const waypointId = Number(body.waypoint_id);
    const action = String(body.action ?? "");
    if (!Number.isInteger(waypointId) || waypointId <= 0) {
      return NextResponse.json({ error: "A valid Waypoint is required." }, { status: 400 });
    }

    if (action === "follow" || action === "unfollow") {
      if (action === "follow") {
        const exists = await dataApi(
          "GET",
          `chartroom_follows?contributor_id=eq.${contributor.id}` +
            `&editorial_gap_id=eq.${waypointId}&select=editorial_gap_id&limit=1`,
        );
        if (!exists.length) {
          await dataApi("POST", "chartroom_follows", {
            contributor_id: contributor.id,
            editorial_gap_id: waypointId,
          });
        }
      } else {
        await dataApi(
          "DELETE",
          `chartroom_follows?contributor_id=eq.${contributor.id}` +
            `&editorial_gap_id=eq.${waypointId}`,
        );
      }
      return NextResponse.json({ ok: true, following: action === "follow" });
    }

    if (action !== "take") {
      return NextResponse.json({ error: "Action must be take, follow or unfollow." }, { status: 400 });
    }

    // Humans and agents observe the same standing policy, but their contributor
    // records stay independent. A human-agent association is never consulted.
    const result = await dataRpc("chartroom_take_waypoint", {
      p_contributor_id: contributor.id,
      p_waypoint_id: waypointId,
      p_claim_limits: CLAIM_LIMITS,
      p_ttl_days: 14,
      p_carta: CARTA_VERSION,
      p_actor: `contributor:${contributor.handle}`,
    });
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ ok: true, waypoint: result.taken, status: "taken" });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
