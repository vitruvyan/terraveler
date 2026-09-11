import { NextResponse } from "next/server";
import { sb, rpc } from "@/lib/deskAuth";
import { createAgentAccount, getAgentAccount } from "@/lib/agentIdentity";
import {
  ACCESS_TTL_S, MCP_RESOURCE, REUSE_GRACE_MS, constantTimeEqual, issueTokens, parseScopes,
  pkceMatches, redirectAllowed, secret, sha256,
} from "@/lib/oauth";
import {
  ENROLLMENT_BODY_LIMIT, NO_STORE_HEADERS, acquireMutationLease, enforceLimits,
  readLimitedJson, releaseMutationLease, requestSource,
} from "@/lib/externalBetaSecurity";

/**
 * OAuth token endpoint. Interactive authorization and self-enrolled agents use
 * different grants, but both end at an agent_connection bound to a persistent
 * Terraveler agent identity. A human association is optional metadata; it is
 * never the identity root of the agent.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = NO_STORE_HEADERS;

function fail(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: noStore });
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const parsed = await readLimitedJson(req, ENROLLMENT_BODY_LIMIT);
    if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: parsed.status });
    const j = parsed.value;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > ENROLLMENT_BODY_LIMIT)
    throw Object.assign(new Error("request body too large"), { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > ENROLLMENT_BODY_LIMIT)
    throw Object.assign(new Error("request body too large"), { status: 413 });
  return Object.fromEntries(new URLSearchParams(raw));
}

async function detonate(connectionId: number, why: string) {
  await sb("PATCH", `oauth_tokens?connection_id=eq.${connectionId}&revoked_at=is.null`,
    { revoked_at: new Date().toISOString() });
  await sb("PATCH", `agent_connections?id=eq.${connectionId}`,
    { revoked_at: new Date().toISOString() });
  await sb("POST", "audit_log", {
    submission_id: null, actor: "oauth", action: "revoke", verdict: "replay-detected",
    findings: [["SECURITY", 0, why]], carta_version: null,
  }).catch(() => {});
}

function resourceOk(given: string | undefined, bound: string | null): boolean {
  if (!bound) return true;
  if (!given) return true;
  return given.replace(/\/+$/, "") === bound.replace(/\/+$/, "");
}

async function authorizationCode(p: Record<string, string>) {
  const { code, code_verifier, client_id, redirect_uri } = p;
  if (!code || !code_verifier || !client_id || !redirect_uri)
    return fail("invalid_request", "code, code_verifier, client_id and redirect_uri are required");

  const claimed = await rpc("claim_authorization_code", { p_code_hash: sha256(code) });
  const row = claimed?.[0];

  if (!row) {
    const known = await sb("GET", `oauth_codes?code_hash=eq.${sha256(code)}&select=*`);
    const prior = known?.[0];
    if (!prior) return fail("invalid_grant", "unknown or expired authorization code");
    const bindingsHold =
      prior.client_id === client_id &&
      redirectAllowed([prior.redirect_uri], redirect_uri) &&
      pkceMatches(code_verifier, prior.code_challenge);
    if (bindingsHold) {
      await detonate(prior.connection_id,
        `authorization code redeemed twice by a holder of the PKCE verifier ` +
        `(client ${client_id}); connection revoked`);
      return fail("invalid_grant",
        "this code has already been redeemed. Two holders of the verifier means one is " +
        "not you, so the connection has been revoked — authorise again.");
    }
    return fail("invalid_grant", "this authorization code has already been redeemed");
  }

  if (new Date(row.expires_at).getTime() < Date.now())
    return fail("invalid_grant", "authorization code expired — start again");
  if (row.client_id !== client_id)
    return fail("invalid_grant", "this code was issued to a different client");
  if (!redirectAllowed([row.redirect_uri], redirect_uri))
    return fail("invalid_grant", "redirect_uri does not match the one the code was issued for");
  if (!pkceMatches(code_verifier, row.code_challenge))
    return fail("invalid_grant", "PKCE verification failed");
  if (!resourceOk(p.resource, row.resource))
    return fail("invalid_target", "this code was issued for a different resource");

  const tokens = await issueTokens(row.connection_id, row.scopes, row.resource ?? MCP_RESOURCE);
  return NextResponse.json(
    { ...tokens, token_type: "Bearer", scope: (row.scopes ?? []).join(" ") },
    { headers: noStore },
  );
}

async function refresh(p: Record<string, string>) {
  const { refresh_token, client_id } = p;
  if (!refresh_token) return fail("invalid_request", "refresh_token is required");
  const hash = sha256(refresh_token);

  const claimed = await rpc("claim_refresh_token", { p_token_hash: hash });
  const tok = claimed?.[0];

  if (!tok) {
    const known = await sb("GET",
      `oauth_tokens?token_hash=eq.${hash}&kind=eq.refresh&select=id,connection_id,rotated_to,revoked_at,created_at`);
    const prior = known?.[0];
    if (!prior) return fail("invalid_grant", "unknown refresh token");
    if (prior.rotated_to) {
      const rotatedRecently =
        Date.now() - new Date(prior.revoked_at ?? prior.created_at).getTime() < REUSE_GRACE_MS;
      if (rotatedRecently) {
        const family = await sb("GET",
          `oauth_tokens?id=eq.${prior.rotated_to}&select=scopes,resource,connection_id`);
        if (family?.[0])
          return fail("invalid_grant",
            "this token was just rotated. Use the refresh token from that response — " +
            "it was issued seconds ago and is still current.");
      }
      await detonate(prior.connection_id,
        `rotated refresh token presented again after the reuse window ` +
        `(client ${client_id ?? "unnamed"}); connection revoked`);
      return fail("invalid_grant",
        "this refresh token was already exchanged. Two holders means one of them is not " +
        "you, so every token on this connection has been revoked. Authorise again.");
    }
    return fail("invalid_grant", "this token has been revoked");
  }

  if (new Date(tok.expires_at).getTime() < Date.now())
    return fail("invalid_grant", "refresh token expired — authorise again");
  if (client_id && tok.client_id && client_id !== tok.client_id)
    return fail("invalid_grant", "this refresh token belongs to a different client");

  const asked = parseScopes(p.scope || (tok.scopes ?? []).join(" "));
  const granted = asked.filter((s) => (tok.scopes ?? []).includes(s));
  const scopes = granted.length ? granted : tok.scopes;

  const tokens = await issueTokens(tok.connection_id, scopes, p.resource || MCP_RESOURCE);
  const fresh = await sb("GET",
    `oauth_tokens?token_hash=eq.${sha256(tokens.refresh_token)}&select=id`);
  await sb("PATCH", `oauth_tokens?id=eq.${tok.id}`, { rotated_to: fresh?.[0]?.id ?? null });

  return NextResponse.json(
    { ...tokens, token_type: "Bearer", scope: scopes.join(" "), expires_in: ACCESS_TTL_S },
    { headers: noStore },
  );
}

/**
 * A self-enrolled agent authenticates its software credential and receives a
 * short-lived access token. The OAuth client is not the identity: it points to
 * an agent_account, whose public id and contributor standing survive changes of
 * model or runtime.
 */
async function clientCredentials(p: Record<string, string>) {
  const { client_id, client_secret } = p;
  if (!client_id || !client_secret)
    return fail("invalid_client", "client_id and client_secret are required", 401);

  const rows = await sb("GET",
    `oauth_clients?client_id=eq.${encodeURIComponent(client_id)}` +
    `&select=client_id,client_secret_hash,agent_account_id,client_name,operator`);
  const client = rows?.[0];
  if (!client?.client_secret_hash)
    return fail("invalid_client",
      "unknown client, or a client registered for the interactive flow. Register with " +
      "grant_types: [\"client_credentials\"] to self-enrol an agent.", 401);
  if (!constantTimeEqual(sha256(client_secret), client.client_secret_hash))
    return fail("invalid_client", "client authentication failed", 401);

  const scopes = parseScopes(p.scope);
  let existing = (await sb("GET",
    `agent_connections?client_id=eq.${encodeURIComponent(client_id)}` +
    `&human_principal_id=is.null&select=id,scopes,revoked_at,agent_account_id,contributor_id&limit=1`))?.[0];

  let agentAccountId = client.agent_account_id ?? existing?.agent_account_id ?? null;
  if (!agentAccountId) {
    // Only pre-Voyager clients can reach this compatibility repair. New
    // self-enrolment creates and binds the named identity at registration.
    const agent = await createAgentAccount({
      displayName: client.client_name ?? null,
      operator: client.operator ?? null,
      enrollment: "legacy-import",
    });
    agentAccountId = agent.id;
    await sb("PATCH", `oauth_clients?client_id=eq.${encodeURIComponent(client_id)}`, {
      agent_account_id: agent.id,
    });
  } else if (!client.agent_account_id) {
    await sb("PATCH", `oauth_clients?client_id=eq.${encodeURIComponent(client_id)}`, {
      agent_account_id: agentAccountId,
    });
  }

  const agent = await getAgentAccount(agentAccountId);
  if (!agent || agent.status !== "active" || agent.contributor_status !== "active")
    return fail("invalid_client", "this agent identity is suspended or no longer active", 403);

  if (existing?.revoked_at)
    return fail("invalid_client",
      "this runtime connection has been revoked. The agent identity and its standing still exist, but this credential may no longer act.",
      403);

  if (existing) {
    const merged = [...new Set([...(existing.scopes ?? []), ...scopes])];
    await sb("PATCH", `agent_connections?id=eq.${existing.id}`, {
      scopes: merged,
      agent_account_id: agent.id,
      contributor_id: agent.contributor_id,
    });
  } else {
    existing = (await sb("POST", "agent_connections", {
      client_id,
      scopes,
      human_principal_id: null,
      agent_account_id: agent.id,
      contributor_id: agent.contributor_id,
    }))?.[0];
  }
  if (!existing?.id) return fail("server_error", "could not establish agent connection", 500);

  const access = secret();
  await sb("POST", "oauth_tokens", {
    token_hash: sha256(access), kind: "access", connection_id: existing.id,
    scopes, resource: MCP_RESOURCE,
    expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
  });
  return NextResponse.json(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      scope: scopes.join(" "),
      agent_id: agent.public_id,
    },
    { headers: noStore },
  );
}

export async function POST(req: Request) {
  let p: Record<string, string>;
  try { p = await readParams(req); }
  catch (e: any) { return fail("invalid_request", String(e?.message ?? "invalid body"), e?.status ?? 400); }
  const source = requestSource(req);
  const admission = await enforceLimits("oauth-token", 60, [
    { dimension: "ip", subject: source.sourceHash, limit: 90 },
    { dimension: "network", subject: source.networkHash, limit: 360 },
    { dimension: "client", subject: p.client_id ?? "unknown", limit: 60 },
  ]);
  if (!admission.allowed)
    return NextResponse.json({ error: "temporarily_unavailable", error_description: "Token endpoint rate limit exceeded." },
      { status: 429, headers: { ...noStore, "Retry-After": String(admission.retryAfter) } });
  if (p.grant_type === "client_credentials") {
    // Two serverless invocations presenting the same valid client credential
    // must not race into two legacy identity repairs or two autonomous
    // connections. The database lease is shared across instances.
    const lease = await acquireMutationLease(0, `oauth-token:${p.client_id ?? "unknown"}`, source.requestId);
    if (!lease.acquired)
      return NextResponse.json({ error: "temporarily_unavailable",
        error_description: "Another token request for this client is still active." },
        { status: 503, headers: { ...noStore, "Retry-After": "2" } });
    try {
      return await clientCredentials(p);
    } finally {
      await releaseMutationLease(lease.leaseKey, source.requestId);
    }
  }
  if (p.grant_type === "authorization_code") return authorizationCode(p);
  if (p.grant_type === "refresh_token") return refresh(p);
  return fail("unsupported_grant_type",
    "this server issues tokens for client_credentials, authorization_code and refresh_token.");
}
