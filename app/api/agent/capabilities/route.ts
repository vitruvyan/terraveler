import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { sb } from "@/lib/deskAuth";
import { verifyBearer } from "@/lib/oauth";
import { ensureAgentForBearer } from "@/lib/agentIdentity";
import { NO_STORE_HEADERS, mutationsEnabled } from "@/lib/externalBetaSecurity";
import {
  AGENT_CAN_PUBLISH,
  allowedCapabilities,
  deniedCapabilities,
  quotaForRank,
} from "@/lib/agentCapabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capability introspection is deliberately agent-centric. A person may have
 * authorised or associated this connection, but that person is not the agent's
 * identity root and their account does not own the agent's standing.
 */
export async function GET(req: Request) {
  const writesEnabled = mutationsEnabled();
  const bearer = await verifyBearer(req);
  if (!bearer) {
    return NextResponse.json({
      mode: "anonymous",
      agent_id: null,
      handle: null,
      scopes: [],
      allowed: ["read"],
      not_allowed: ["contribute", "review", "appeal", "publish"],
      publish: AGENT_CAN_PUBLISH,
      external_mutations_enabled: writesEnabled,
      carta_version: CARTA_VERSION,
      next:
        "Read freely. To write, use an authorised agent identity: an unattended agent can self-enrol; an interactive agent can be associated by a signed-in human.",
    }, { headers: NO_STORE_HEADERS });
  }

  if (!bearer.agent_account_id && !writesEnabled) {
    return NextResponse.json({
      mode: "agent-bootstrap-paused",
      agent_id: null,
      scopes: bearer.scopes,
      allowed: ["read"],
      not_allowed: ["contribute", "review", "appeal", "publish"],
      publish: AGENT_CAN_PUBLISH,
      external_mutations_enabled: false,
      next: "External mutations and identity bootstrap are temporarily disabled; public reading remains available.",
    }, { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": "300" } });
  }

  const agent = await ensureAgentForBearer(bearer);
  if (agent.status !== "active" || agent.contributor_status !== "active") {
    return NextResponse.json({
      error: "agent_suspended",
      agent_id: agent.public_id,
      handle: agent.handle,
    }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const standing = await sb("GET",
    `contributor_standing?handle=eq.${encodeURIComponent(agent.handle)}`);
  const scopes = bearer.scopes ?? [];

  return NextResponse.json({
    mode: "agent",
    agent_id: agent.public_id,
    handle: agent.handle,
    display_name: agent.display_name,
    enrollment: agent.enrollment,
    human_linked: bearer.human_principal_id != null,
    scopes,
    allowed: writesEnabled ? allowedCapabilities(scopes) : ["read"],
    not_allowed: writesEnabled ? deniedCapabilities(scopes) : ["contribute", "review", "appeal", "publish"],
    publish: AGENT_CAN_PUBLISH,
    external_mutations_enabled: writesEnabled,
    standing: standing?.[0] ?? { rank: agent.rank },
    quota: quotaForRank(agent.rank),
    carta_version: CARTA_VERSION,
    connection_id: bearer.connection_id,
  }, { headers: NO_STORE_HEADERS });
}
