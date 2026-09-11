import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { RANK_QUOTA } from "@/lib/agentCapabilities";
import { dataApi, dataRpc, getUser, readCookie } from "@/lib/deskAuth";
import { ensureHumanContributor } from "@/lib/humanContributor";
import {
  adaptEditorialGap,
  isWaypointType,
  legacyKindForWaypointType,
  type LegacyEditorialGap,
  type WaypointType,
} from "@/lib/chartroom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAIM_LIMITS = Object.fromEntries(
  Object.entries(RANK_QUOTA).map(([rank, quota]) => [rank, quota.active_claims]),
);

const CONTEXT_SELECT = [
  "id", "title", "description", "kind", "priority", "status", "claimed_by", "claimed_at",
  "waypoint_type", "context_type", "context_voyage", "context_waypoint_seq", "context_place",
  "requested_agent_account_id",
].join(",");

const VOYAGE_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

async function signedInHuman(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  return user ? ensureHumanContributor(user) : null;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseContext(input: any) {
  const voyage = cleanText(input?.voyage, 100).toLowerCase();
  const waypointSeq = Number(input?.waypoint_seq);
  const place = cleanText(input?.place, 180);
  if (!VOYAGE_RE.test(voyage)) throw new Error("A valid voyage slug is required.");
  if (!Number.isInteger(waypointSeq) || waypointSeq <= 0) {
    throw new Error("A valid voyage waypoint is required.");
  }
  return { voyage, waypointSeq, place };
}

async function createContextWaypoint(contributor: any, body: any): Promise<LegacyEditorialGap> {
  const type = body?.type;
  if (!isWaypointType(type)) throw new Error("A valid Waypoint type is required.");
  const { voyage, waypointSeq, place } = parseContext(body?.context);
  const title = cleanText(body?.title, 180);
  const description = cleanText(body?.description, 1200);
  if (title.length < 4) throw new Error("Give the Waypoint a short, concrete title.");

  const rows = await dataApi("POST", "editorial_gaps", {
    title,
    description: description || null,
    kind: legacyKindForWaypointType(type as WaypointType),
    waypoint_type: type,
    priority: 2,
    status: "open",
    context_type: "voyage_waypoint",
    context_voyage: voyage,
    context_waypoint_seq: waypointSeq,
    context_place: place || null,
    created_by_contributor_id: contributor.id,
    initiated_by_contributor_id: contributor.id,
  });
  return rows[0] as LegacyEditorialGap;
}

async function associatedVoyagers(humanPrincipalId: number) {
  const links = await dataApi(
    "GET",
    `human_agent_links?human_principal_id=eq.${humanPrincipalId}` +
      `&relation=eq.associated&revoked_at=is.null&order=created_at.desc` +
      `&select=agent_account_id,created_at`,
  );

  const agents = await Promise.all((links ?? []).map(async (link: any) => {
    const accounts = await dataApi(
      "GET",
      `agent_accounts?id=eq.${Number(link.agent_account_id)}` +
        `&status=eq.active&select=id,public_id,display_name,contributor_id&limit=1`,
    );
    const account = accounts?.[0];
    if (!account) return null;
    const contributors = await dataApi(
      "GET",
      `contributors?id=eq.${account.contributor_id}&status=eq.active` +
        `&select=id,handle,rank&limit=1`,
    );
    const c = contributors?.[0];
    if (!c) return null;
    return {
      accountId: Number(account.id),
      agentId: String(account.public_id),
      name: account.display_name || c.handle,
      handle: c.handle,
      rank: c.rank,
    };
  }));

  return agents.filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const voyage = cleanText(url.searchParams.get("voyage"), 100).toLowerCase();
    const waypointSeq = Number(url.searchParams.get("waypoint"));
    if (!VOYAGE_RE.test(voyage) || !Number.isInteger(waypointSeq) || waypointSeq <= 0) {
      return NextResponse.json({ error: "voyage and waypoint are required." }, { status: 400 });
    }

    const rows = await dataApi(
      "GET",
      `editorial_gaps?context_voyage=eq.${encodeURIComponent(voyage)}` +
        `&context_waypoint_seq=eq.${waypointSeq}` +
        `&status=in.(open,claimed)&order=priority.asc,id.asc&select=${CONTEXT_SELECT}`,
    );

    const contributor = await signedInHuman(req);
    const agents = contributor ? await associatedVoyagers(contributor.humanPrincipalId) : [];

    return NextResponse.json({
      ok: true,
      waypoints: (rows as LegacyEditorialGap[]).map(adaptEditorialGap),
      agents,
    });
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/context_voyage|waypoint_type|requested_agent_account_id/i.test(message)) {
      return NextResponse.json(
        { error: "Chartroom contextual migration has not been applied yet.", migration_required: true },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    const action = String(body.action ?? "");
    let waypointId = Number(body.waypoint_id);

    if (action === "raise" || ((action === "take" || action === "offer") && !Number.isInteger(waypointId))) {
      try {
        const created = await createContextWaypoint(contributor, body);
        waypointId = Number(created.id);
        if (action === "raise") {
          return NextResponse.json({ ok: true, waypoint: adaptEditorialGap(created), status: "open" });
        }
      } catch (error: any) {
        return NextResponse.json({ error: String(error?.message || error) }, { status: 400 });
      }
    }

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

    if (action === "offer") {
      const agentAccountId = Number(body.agent_account_id);
      if (!Number.isInteger(agentAccountId) || agentAccountId <= 0) {
        return NextResponse.json({ error: "Choose a Voyager first." }, { status: 400 });
      }
      const result = await dataRpc("chartroom_offer_waypoint", {
        p_human_principal_id: contributor.humanPrincipalId,
        p_human_contributor_id: contributor.id,
        p_agent_account_id: agentAccountId,
        p_waypoint_id: waypointId,
        p_carta: CARTA_VERSION,
      });
      if (result?.error) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }

      // list_gaps remains an MCP 2025/2026-compatible public read. Until the
      // modern tool grows an authenticated "my work" projection, put the target
      // Voyager in the human-readable description as well as structured columns.
      const current = await dataApi(
        "GET",
        `editorial_gaps?id=eq.${waypointId}&select=description&limit=1`,
      );
      const marker = `Requested Voyager: ${result.offered.agent_name} (${result.offered.agent_id}).`;
      const before = cleanText(current?.[0]?.description, 1000);
      if (!before.includes(marker)) {
        await dataApi("PATCH", `editorial_gaps?id=eq.${waypointId}`, {
          description: `${before}${before ? "\n\n" : ""}${marker}`.slice(0, 1200),
        });
      }
      return NextResponse.json({ ok: true, waypoint: result.offered, status: "offered" });
    }

    if (action !== "take") {
      return NextResponse.json(
        { error: "Action must be take, offer, raise, follow or unfollow." },
        { status: 400 },
      );
    }

    // Humans and agents observe the same standing policy, but their contributor
    // records stay independent. A human-agent association is never consulted
    // when the human takes work for themselves.
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
