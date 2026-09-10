import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";
import { ensureAgentForBearer } from "@/lib/agentIdentity";
import { MCP_RESOURCE, secret, sha256, verifyBearer } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 10 * 60 * 1000;
const PER_HOUR = 10;
type Purpose = "runtime-binding" | "human-association";

/**
 * An authenticated agent can prove continuity of its own identity without
 * revealing a long-lived identity secret. The result is deliberately short
 * lived and one-use. It can be handed to a new runtime, or to a human who wants
 * to associate their independently registered account with this agent.
 */
export async function POST(req: Request) {
  const bearer = await verifyBearer(req);
  if (!bearer) {
    return NextResponse.json(
      { error: "unauthorized", message: "Authenticate as the agent before minting a link token." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate":
            `Bearer realm="Terraveler", resource="${MCP_RESOURCE}", ` +
            `resource_metadata="https://www.terraveler.com/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }

  const body = await req.json().catch(() => ({}));
  const purpose = String(body?.purpose ?? "runtime-binding") as Purpose;
  if (purpose !== "runtime-binding" && purpose !== "human-association") {
    return NextResponse.json(
      { error: "invalid_purpose", allowed: ["runtime-binding", "human-association"] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const agent = await ensureAgentForBearer(bearer);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await sb("GET",
    `agent_link_tokens?agent_account_id=eq.${agent.id}&created_at=gte.${since}&select=id&limit=${PER_HOUR + 1}`);
  if ((recent?.length ?? 0) >= PER_HOUR) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many link tokens were minted for this agent in the last hour." },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const token = secret();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await sb("POST", "agent_link_tokens", {
    token_hash: sha256(token),
    agent_account_id: agent.id,
    purpose,
    issued_by_connection_id: bearer.connection_id,
    expires_at: expiresAt,
  });

  return NextResponse.json({
    agent_id: agent.public_id,
    purpose,
    link_token: token,
    expires_at: expiresAt,
    one_time: true,
    note:
      purpose === "runtime-binding"
        ? "Give this one-time token only to the new runtime that should become another connection of this same agent."
        : "Give this one-time token to the human who wants to associate their Terraveler account with this agent.",
  }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
