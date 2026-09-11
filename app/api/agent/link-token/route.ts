import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";
import { ensureAgentForBearer } from "@/lib/agentIdentity";
import { MCP_RESOURCE, secret, sha256, verifyBearer } from "@/lib/oauth";
import {
  ENROLLMENT_BODY_LIMIT, NO_STORE_HEADERS, enforceLimits, mutationGuardReason,
  mutationsEnabled, readLimitedJson, requestSource, securityAudit,
} from "@/lib/externalBetaSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 10 * 60 * 1000;
const PER_HOUR = 10;
type Purpose = "runtime-binding" | "human-association";

export async function POST(req: Request) {
  const source = requestSource(req);
  if (!mutationsEnabled()) {
    await securityAudit({ source, action: "link-token", outcome: "rejected", status: 503,
      reason: mutationGuardReason() ?? "external mutation guard unavailable" });
    return NextResponse.json({ error: "temporarily_disabled", message: "External agent mutations are paused." },
      { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": "300" } });
  }

  const bearer = await verifyBearer(req);
  if (!bearer) {
    return NextResponse.json(
      { error: "unauthorized", message: "Authenticate as the agent before minting a link token." },
      {
        status: 401,
        headers: {
          ...NO_STORE_HEADERS,
          "WWW-Authenticate":
            `Bearer realm="Terraveler", resource="${MCP_RESOURCE}", ` +
            `resource_metadata="https://www.terraveler.com/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }

  const parsed = await readLimitedJson(req, ENROLLMENT_BODY_LIMIT, true);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_request", message: parsed.error },
    { status: parsed.status, headers: NO_STORE_HEADERS });
  const body = parsed.value;
  const purpose = String(body?.purpose ?? "runtime-binding") as Purpose;
  if (purpose !== "runtime-binding" && purpose !== "human-association") {
    return NextResponse.json(
      { error: "invalid_purpose", allowed: ["runtime-binding", "human-association"] },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const agent = await ensureAgentForBearer(bearer);
  const admission = await enforceLimits("link-token", 3600, [
    { dimension: "ip", subject: source.sourceHash, limit: 20 },
    { dimension: "network", subject: source.networkHash, limit: 80 },
    { dimension: "client", subject: bearer.client_id, limit: 15 },
    { dimension: "agent", subject: agent.public_id, limit: PER_HOUR },
  ]);
  if (!admission.allowed) {
    await securityAudit({ source, action: "link-token", outcome: "rejected", status: 429,
      reason: `rate limit exceeded for ${admission.dimension}`, agentId: agent.public_id,
      agentAccountId: agent.id, connectionId: bearer.connection_id, clientId: bearer.client_id });
    return NextResponse.json({ error: "rate_limited", message: "Too many link-token requests." },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(admission.retryAfter) } });
  }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await sb("GET",
    `agent_link_tokens?agent_account_id=eq.${agent.id}&created_at=gte.${since}&select=id&limit=${PER_HOUR + 1}`);
  if ((recent?.length ?? 0) >= PER_HOUR) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many link tokens were minted for this agent in the last hour." },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": "3600" } },
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
  await securityAudit({ source, action: "link-token", outcome: "accepted", status: 200,
    agentId: agent.public_id, agentAccountId: agent.id, connectionId: bearer.connection_id, clientId: bearer.client_id });

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
  }, { headers: NO_STORE_HEADERS });
}
