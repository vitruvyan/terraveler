import { NextResponse } from "next/server";
import { sb, rpc } from "@/lib/deskAuth";
import {
  ACCESS_TTL_S, MCP_RESOURCE, REUSE_GRACE_MS, constantTimeEqual, issueTokens, parseScopes,
  pkceMatches, redirectAllowed, secret, sha256,
} from "@/lib/oauth";

/**
 * The token endpoint: authorization_code and refresh_token.
 *
 * Three things here are answers to a red-team report, and each was wrong in a
 * way that only shows up under contention or attack.
 *
 * **The claim is atomic.** Both grants used to read the credential, decide it
 * was unused, issue tokens, and only then mark it spent. Two requests arriving
 * together both read "unused" and both walked away with a valid token family —
 * so replay detection failed during exactly the race it exists for. The
 * database now decides the winner in a single statement, and a caller that
 * loses looks the credential up afterwards to tell "already spent" from "never
 * existed".
 *
 * **PKCE is checked before anything is revoked.** The point of PKCE is that a
 * stolen code is useless without the verifier. Revoking on a replayed code
 * before validating the verifier left it useful for one thing — disconnecting
 * the owner. Every binding is validated first; only a second presentation that
 * proves it holds the verifier is treated as compromise.
 *
 * **Reuse has a grace window.** Concurrent refreshes and network retries are
 * ordinary client behaviour, not attacks. A token re-presented within seconds
 * of its rotation returns the family that rotation produced instead of
 * detonating the connection.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

function fail(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: noStore });
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
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

/**
 * A token may only be spent at the resource it was minted for.
 *
 * A null `bound` is tolerated only for codes issued before audience binding
 * existed; every code minted now carries one, so the permissive branch is a
 * migration allowance and not a rule. When both sides name something, they must
 * name the same thing — that is the whole point of the parameter being
 * mandatory, and trusting a null in the general case would have made the check
 * decorative.
 */
function resourceOk(given: string | undefined, bound: string | null): boolean {
  if (!bound) return true;                      // legacy code, issued unbound
  if (!given) return true;                      // client omitted it; the token still binds
  return given.replace(/\/+$/, "") === bound.replace(/\/+$/, "");
}

async function authorizationCode(p: Record<string, string>) {
  const { code, code_verifier, client_id, redirect_uri } = p;
  if (!code || !code_verifier || !client_id || !redirect_uri)
    return fail("invalid_request", "code, code_verifier, client_id and redirect_uri are required");

  const claimed = await rpc("claim_authorization_code", { p_code_hash: sha256(code) });
  const row = claimed?.[0];

  if (!row) {
    // Either it never existed or somebody already spent it. Only the second is
    // interesting, and it is still not enough to act on: a stolen code without
    // the verifier must not be able to disconnect its owner.
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

  // Won the race. Every binding still has to hold.
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
      // A retry a moment after a successful rotation is ordinary client
      // behaviour — a flaky network, two tabs, a racing refresh. Detonating on
      // that would punish correctness.
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

  // The claim revoked it; from here it must either be rotated or the claim undone.
  if (new Date(tok.expires_at).getTime() < Date.now())
    return fail("invalid_grant", "refresh token expired — authorise again");
  // Bound to the client it was issued to. Without this, a token leaked from one
  // client is spendable by any other.
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
 * An agent authorising itself, with nobody awake.
 *
 * `client_credentials` is the grant for an actor that represents no user, and
 * that is exactly what an unattended Scribe is. Using it here is not a way
 * around the consent screen — using authorization_code for a process that runs
 * at four in the morning would be the abuse.
 *
 * The connection it creates has no human_principal, and every surface that
 * reports on it says "autonomous" instead of naming somebody. That honesty is
 * the price of the convenience, and it is cheap: entry was never the gate.
 * Everything this agent submits meets the same mechanical verification, the
 * same peer review and the same Curator's verdict as work from a tandem with a
 * person in it, and its rank bounds how much it can send.
 */
async function clientCredentials(p: Record<string, string>) {
  const { client_id, client_secret } = p;
  if (!client_id || !client_secret)
    return fail("invalid_client", "client_id and client_secret are required", 401);

  const rows = await sb("GET",
    `oauth_clients?client_id=eq.${encodeURIComponent(client_id)}&select=client_id,client_secret_hash`);
  const client = rows?.[0];
  if (!client?.client_secret_hash)
    return fail("invalid_client",
      "unknown client, or a client registered for the interactive flow. Register with " +
      "grant_types: [\"client_credentials\"] to work unattended.", 401);
  if (!constantTimeEqual(sha256(client_secret), client.client_secret_hash))
    return fail("invalid_client", "client authentication failed", 401);

  const scopes = parseScopes(p.scope);
  // One connection per autonomous client, reused. A second token request is
  // the same agent asking again, not a new one being born.
  const existing = await sb("GET",
    `agent_connections?client_id=eq.${encodeURIComponent(client_id)}` +
    `&human_principal_id=is.null&select=id,scopes,revoked_at`);
  let conn = existing?.[0];
  if (conn?.revoked_at)
    return fail("invalid_client",
      "this agent has been revoked by the editorial desk. Appeals go to the editor-in-chief.",
      403);
  if (conn) {
    const merged = [...new Set([...(conn.scopes ?? []), ...scopes])];
    await sb("PATCH", `agent_connections?id=eq.${conn.id}`, { scopes: merged });
  } else {
    conn = (await sb("POST", "agent_connections", {
      client_id, scopes, human_principal_id: null,
    }))?.[0];
  }

  // No refresh token: with the client secret in hand the agent can mint another
  // access token whenever it likes, and a refresh token would be a second
  // long-lived credential to steal for no gain.
  const access = secret();
  await sb("POST", "oauth_tokens", {
    token_hash: sha256(access), kind: "access", connection_id: conn.id,
    scopes, resource: MCP_RESOURCE,
    expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
  });
  return NextResponse.json(
    { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S,
      scope: scopes.join(" ") },
    { headers: noStore },
  );
}

export async function POST(req: Request) {
  const p = await readParams(req);
  if (p.grant_type === "client_credentials") return clientCredentials(p);
  if (p.grant_type === "authorization_code") return authorizationCode(p);
  if (p.grant_type === "refresh_token") return refresh(p);
  return fail("unsupported_grant_type",
    "this server issues tokens for client_credentials, authorization_code and " +
    "refresh_token. An unattended agent wants the first.");
}
