import { NextResponse } from "next/server";
import { COOKIE, getUser, readCookie, sb } from "@/lib/deskAuth";
import { CODE_TTL_S, MCP_RESOURCE, parseScopes, secret, sha256 } from "@/lib/oauth";

/**
 * What the one click actually does.
 *
 * Four things, in order, and the order matters: find or create the person,
 * find or create the connection between that person and this client, mint a
 * code bound to both, and hand back the address to return to.
 *
 * The connection is looked up rather than always created, so a second
 * authorisation by the same person with the same client re-uses the row and
 * keeps its standing. Approving again is not becoming somebody new.
 *
 * The browser is never redirected by this route — it returns the location and
 * lets the page navigate. A 302 from fetch() would be followed silently by the
 * browser and the client would never see the code.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      { error: "invalid_target",
        error_description: `tokens here are issued for ${MCP_RESOURCE} only` },
      { status: 400 },
    );
  const scopes = parseScopes(body?.scope);
  if (!client_id || !redirect_uri || !code_challenge)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const clients = await sb("GET",
    `oauth_clients?client_id=eq.${encodeURIComponent(String(client_id))}&select=client_id,redirect_uris`);
  const client = clients?.[0];
  // Re-checked here and not merely on the page: the page is a suggestion, this
  // is the gate. A hand-made POST must meet the same conditions.
  if (!client || !(client.redirect_uris ?? []).includes(String(redirect_uri)))
    return NextResponse.json(
      { error: "invalid_request", error_description: "unknown client, or unregistered redirect address" },
      { status: 400 },
    );

  if (decision !== "approve")
    return back(String(redirect_uri), {
      error: "access_denied",
      error_description: "the person declined",
      state: String(state ?? ""),
    });

  // ── the person
  const found = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`);
  const principal = found?.[0]
    ?? (await sb("POST", "human_principals", { auth_sub: user.sub, email: user.email }))?.[0];

  // ── the connection between that person and this client
  const existing = await sb("GET",
    `agent_connections?human_principal_id=eq.${principal.id}` +
    `&client_id=eq.${encodeURIComponent(String(client_id))}&select=id,scopes,revoked_at`);
  let connection = existing?.[0];
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
  }

  // ── the code, bound to the client, the connection and the exact redirect
  const code = secret();
  await sb("POST", "oauth_codes", {
    code_hash: sha256(code),
    client_id: String(client_id),
    connection_id: connection.id,
    redirect_uri: String(redirect_uri),
    code_challenge: String(code_challenge),
    code_challenge_method: "S256",
    scopes,
    // Bound at issue. A code with no resource can only come from a client that
    // named none; new flows always carry one, and the token endpoint refuses a
    // mismatch rather than trusting a permissive null.
    resource: resource || MCP_RESOURCE,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });

  await sb("POST", "audit_log", {
    submission_id: null, actor: `human:${user.email ?? user.sub}`, action: "authorize",
    verdict: "granted",
    findings: [["INFO", 0,
      `authorised client ${String(client_id)} with scopes ${scopes.join(", ")} — ` +
      `connection ${connection.id}`]],
    carta_version: null,
  }).catch(() => {});

  return back(String(redirect_uri), { code, state: String(state ?? "") });
}
