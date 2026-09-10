import { NextResponse } from "next/server";
import { getUser, readCookie, sb } from "@/lib/deskAuth";
import { ensureAgentForConnection } from "@/lib/agentIdentity";
import { CODE_TTL_S, MCP_RESOURCE, parseScopes, secret, sha256 } from "@/lib/oauth";
import { resolveOAuthClient } from "@/lib/cimd";

/**
 * What the human click actually does.
 *
 * The person authenticates as a HUMAN account and chooses to associate an MCP
 * connection with an AGENT account. The two identities remain independent:
 * the agent gets its own contributor/standing and the human-agent relationship
 * is recorded separately and may later be revoked without deleting either.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISSUER = "https://www.terraveler.com";

function back(uri: string, params: Record<string, string>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return NextResponse.json({ location: u.toString() });
}

export async function POST(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  if (!user)
    return NextResponse.json(
      { error: "not_signed_in", error_description: "Sign in again — nothing was granted." },
      { status: 401 },
    );

  const body = await req.json().catch(() => ({}));
  const { decision, client_id, redirect_uri, code_challenge, state } = body ?? {};
  const resource = String(body?.resource ?? "").replace(/\/+$/, "");
  if (resource && resource !== MCP_RESOURCE)
    return NextResponse.json(
      { error: "invalid_target", error_description: `tokens here are issued for ${MCP_RESOURCE} only` },
      { status: 400 },
    );
  const scopes = parseScopes(body?.scope);
  if (!client_id || !redirect_uri || !code_challenge)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  let client;
  try {
    client = await resolveOAuthClient(String(client_id));
  } catch {
    client = null;
  }
  if (!client || !(client.redirect_uris ?? []).includes(String(redirect_uri)))
    return NextResponse.json(
      { error: "invalid_request", error_description: "unverified client, or callback not present in verified client metadata" },
      { status: 400 },
    );

  if (decision !== "approve")
    return back(String(redirect_uri), {
      error: "access_denied",
      error_description: "the person declined",
      state: String(state ?? ""),
      iss: ISSUER,
    });

  const found = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`);
  const principal = found?.[0]
    ?? (await sb("POST", "human_principals", { auth_sub: user.sub, email: user.email }))?.[0];
  if (!principal?.id)
    return NextResponse.json({ error: "server_error", error_description: "could not resolve human account" }, { status: 500 });

  const existing = await sb("GET",
    `agent_connections?human_principal_id=eq.${principal.id}` +
    `&client_id=eq.${encodeURIComponent(String(client_id))}` +
    `&select=id,scopes,revoked_at,agent_account_id,contributor_id&limit=1`);
  let connection = existing?.[0];
  let createdConnection = false;

  if (connection) {
    const merged = [...new Set([...(connection.scopes ?? []), ...scopes])];
    await sb("PATCH", `agent_connections?id=eq.${connection.id}`,
      { scopes: merged, revoked_at: null });
  } else {
    connection = (await sb("POST", "agent_connections", {
      human_principal_id: principal.id,
      client_id: String(client_id),
      scopes,
    }))?.[0];
    createdConnection = true;
  }
  if (!connection?.id)
    return NextResponse.json({ error: "server_error", error_description: "could not create agent connection" }, { status: 500 });

  let agent;
  try {
    agent = await ensureAgentForConnection({
      connectionId: connection.id,
      agentAccountId: connection.agent_account_id ?? null,
      contributorId: connection.contributor_id ?? null,
      humanPrincipalId: principal.id,
      displayName: client.client_name || "Terraveler agent",
    });
  } catch (error) {
    if (createdConnection) await sb("DELETE", `agent_connections?id=eq.${connection.id}`).catch(() => {});
    throw error;
  }

  const code = secret();
  await sb("POST", "oauth_codes", {
    code_hash: sha256(code),
    client_id: String(client_id),
    connection_id: connection.id,
    redirect_uri: String(redirect_uri),
    code_challenge: String(code_challenge),
    code_challenge_method: "S256",
    scopes,
    resource: resource || MCP_RESOURCE,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });

  await sb("POST", "audit_log", {
    submission_id: null,
    actor: `human:${user.email ?? user.sub}`,
    action: "associate-agent",
    verdict: "granted",
    findings: [["INFO", 0,
      `associated agent ${agent.public_id} with client ${String(client_id)} and scopes ${scopes.join(", ")} — connection ${connection.id}`]],
    carta_version: null,
  }).catch(() => {});

  return back(String(redirect_uri), {
    code,
    state: String(state ?? ""),
    iss: ISSUER,
  });
}
