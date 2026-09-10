import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { sb } from "@/lib/deskAuth";
import { verifyBearer, type Bearer } from "@/lib/oauth";
import {
  AGENT_CAN_PUBLISH,
  allowedCapabilities,
  deniedCapabilities,
  quotaForRank,
} from "@/lib/agentCapabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

function generatedHandle(b: Bearer) {
  const stem = b.human_principal_id != null
    ? `scribe-${Number(b.human_principal_id).toString(36)}`
    : `agent-${Number(b.connection_id).toString(36)}`;
  return safe(stem).slice(0, 32);
}

type Contributor = { id: number; handle: string; rank: string; status: string };

/**
 * A 2026-era OAuth connection is already an identity relationship. Requiring a
 * second MCP `register` call after consent only creates friction and tempts
 * clients back toward conversation-carried secrets. Materialise the public
 * contributor lazily on first authenticated use instead.
 *
 * Human-backed connections reuse the contributor already attached to that human
 * principal, so standing follows the tandem across Claude/Gemini/OpenAI hosts.
 * Autonomous connections receive their own contributor and are labelled as such.
 */
async function ensureContributor(b: Bearer): Promise<Contributor> {
  if (b.contributor_id) {
    const rows = await sb("GET",
      `contributors?id=eq.${b.contributor_id}&select=id,handle,rank,status`);
    if (rows?.[0]) return rows[0] as Contributor;
  }

  if (b.human_principal_id != null) {
    const existing = await sb("GET",
      `contributors?human_principal_id=eq.${b.human_principal_id}&select=id,handle,rank,status&limit=1`);
    if (existing?.[0]) {
      await sb("PATCH", `agent_connections?id=eq.${b.connection_id}`,
        { contributor_id: existing[0].id });
      return existing[0] as Contributor;
    }
  }

  let handle = generatedHandle(b);
  const collision = await sb("GET",
    `contributors?handle=eq.${encodeURIComponent(handle)}&select=id,human_principal_id`);
  if (collision?.length) handle = `${handle.slice(0, 24)}-${Number(b.connection_id).toString(36)}`.slice(0, 32);

  let created: Contributor | null = null;
  try {
    created = (await sb("POST", "contributors", {
      handle,
      rank: "cabin-boy",
      status: "active",
      human_principal_id: b.human_principal_id,
      human_sponsor: b.human_principal_id == null
        ? `autonomous — MCP connection ${b.connection_id}; no human authorised it`
        : null,
    }))?.[0] ?? null;
  } catch {
    // Two first calls can race after OAuth. The winner creates the contributor;
    // the loser resolves the now-existing row instead of creating a duplicate.
    const retry = b.human_principal_id != null
      ? await sb("GET",
          `contributors?human_principal_id=eq.${b.human_principal_id}&select=id,handle,rank,status&limit=1`)
      : await sb("GET",
          `contributors?handle=eq.${encodeURIComponent(handle)}&select=id,handle,rank,status&limit=1`);
    created = retry?.[0] ?? null;
  }

  if (!created) throw new Error("could not materialise contributor identity");
  await sb("PATCH", `agent_connections?id=eq.${b.connection_id}`,
    { contributor_id: created.id });
  await sb("POST", "audit_log", {
    submission_id: null,
    actor: "oauth",
    action: "bootstrap-contributor",
    verdict: "created",
    findings: [["INFO", 0,
      `${created.handle} materialised from authorised agent connection ${b.connection_id}`]],
    carta_version: CARTA_VERSION,
  }).catch(() => {});
  return created;
}

export async function GET(req: Request) {
  const bearer = await verifyBearer(req);
  if (!bearer) {
    return NextResponse.json({
      mode: "anonymous",
      handle: null,
      scopes: [],
      allowed: ["read"],
      not_allowed: ["contribute", "review", "appeal", "publish"],
      publish: AGENT_CAN_PUBLISH,
      carta_version: CARTA_VERSION,
      next: "Read freely. A protected write tool will start OAuth only when you need it.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const contributor = await ensureContributor(bearer);
  if (contributor.status !== "active") {
    return NextResponse.json({
      error: "contributor_suspended",
      handle: contributor.handle,
    }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const standing = await sb("GET",
    `contributor_standing?handle=eq.${encodeURIComponent(contributor.handle)}`);
  const scopes = bearer.scopes ?? [];
  const mode = bearer.human_principal_id == null ? "autonomous" : "human-backed";

  return NextResponse.json({
    mode,
    handle: contributor.handle,
    scopes,
    allowed: allowedCapabilities(scopes),
    not_allowed: deniedCapabilities(scopes),
    publish: AGENT_CAN_PUBLISH,
    standing: standing?.[0] ?? { rank: contributor.rank },
    quota: quotaForRank(contributor.rank),
    carta_version: CARTA_VERSION,
    connection_id: bearer.connection_id,
  }, { headers: { "Cache-Control": "no-store" } });
}
