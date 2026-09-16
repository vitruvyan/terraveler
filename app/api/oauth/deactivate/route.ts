import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";
import { verifyBearer } from "@/lib/oauth";
import { NO_STORE_HEADERS, enforceLimits, requestSource, securityAudit } from "@/lib/externalBetaSecurity";

/**
 * Permanently deactivate the OAuth client used by this bearer.
 *
 * RFC 7009 revokes a token, not the credential that can mint its replacement.
 * This endpoint closes that lifecycle gap for unattended client_credentials
 * agents. It invalidates the current client secret, every connection created by
 * that client and every token on those connections. The durable agent identity,
 * standing, submissions and audit history remain intact, so another runtime may
 * later be bound through the normal identity-link flow.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bearer = await verifyBearer(req);
  if (!bearer)
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });

  const source = requestSource(req);
  const admission = await enforceLimits("oauth-deactivate-client", 3600, [
    { dimension: "client", subject: bearer.client_id, limit: 3 },
  ]);
  if (!admission.allowed)
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "Client deactivation rate limit exceeded." },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(admission.retryAfter) } },
    );

  const clients = await sb("GET",
    `oauth_clients?client_id=eq.${encodeURIComponent(bearer.client_id)}` +
    `&select=client_id,client_secret_hash,agent_account_id`);
  const client = clients?.[0];
  if (!client?.client_secret_hash || Number(client.agent_account_id) !== bearer.agent_account_id)
    return NextResponse.json({
      error: "invalid_client",
      error_description: "Only an autonomous client_credentials client may deactivate itself here.",
    }, { status: 400, headers: NO_STORE_HEADERS });

  // Disable token minting first. If a later storage operation fails, the most
  // important security property still holds: this credential cannot recover.
  await sb("PATCH", `oauth_clients?client_id=eq.${encodeURIComponent(bearer.client_id)}`,
    { client_secret_hash: null });

  const connections = await sb("GET",
    `agent_connections?client_id=eq.${encodeURIComponent(bearer.client_id)}&select=id`);
  const ids = (connections ?? []).map((row: { id: number }) => Number(row.id)).filter(Number.isInteger);
  const now = new Date().toISOString();
  if (ids.length) {
    await sb("PATCH", `oauth_tokens?connection_id=in.(${ids.join(",")})&revoked_at=is.null`,
      { revoked_at: now });
    await sb("PATCH", `agent_connections?id=in.(${ids.join(",")})&revoked_at=is.null`,
      { revoked_at: now });
  }

  await securityAudit({
    source, action: "oauth-deactivate-client", outcome: "accepted", status: 200,
    agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id,
    connectionId: bearer.connection_id, clientId: bearer.client_id,
  });

  return NextResponse.json({
    ok: true,
    client_deactivated: true,
    agent_id: bearer.agent_id,
    identity_preserved: true,
    note: "The client secret, all connections for this client and all their tokens are now invalid. The Terraveler agent identity, standing and audit history were preserved.",
  }, { status: 200, headers: NO_STORE_HEADERS });
}
