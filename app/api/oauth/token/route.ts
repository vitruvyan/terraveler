import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";
import {
  ACCESS_TTL_S, issueTokens, parseScopes, pkceMatches, sha256, redirectAllowed,
} from "@/lib/oauth";

/**
 * The token endpoint: authorization_code and refresh_token.
 *
 * Two properties matter more than the rest.
 *
 * A code is single use, and redeeming it sets `consumed_at` rather than
 * deleting the row — so presenting it twice is *detected* as a replay instead
 * of merely failing, and the second attempt revokes what the first was given.
 * A stolen code that has already been spent should cost the thief, not the
 * owner.
 *
 * A refresh token rotates. The old one is marked as rotated to the new, and a
 * rotated token presented again means one of the two holders is not the
 * client, so the whole connection is revoked. That is deliberately harsher
 * than returning 401: the alternative is a thief refreshing forever alongside
 * the legitimate holder, which nobody would notice.
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

async function revokeConnection(connectionId: number, why: string) {
  await sb("PATCH", `oauth_tokens?connection_id=eq.${connectionId}&revoked_at=is.null`,
    { revoked_at: new Date().toISOString() });
  await sb("POST", "audit_log", {
    submission_id: null, actor: "oauth", action: "revoke", verdict: "replay-detected",
    findings: [["SECURITY", 0, why]], carta_version: null,
  }).catch(() => {});
}

export async function POST(req: Request) {
  const p = await readParams(req);
  const grant = p.grant_type;

  if (grant === "authorization_code") {
    const { code, code_verifier, client_id, redirect_uri } = p;
    if (!code || !code_verifier || !client_id || !redirect_uri)
      return fail("invalid_request", "code, code_verifier, client_id and redirect_uri are required");

    const rows = await sb("GET", `oauth_codes?code_hash=eq.${sha256(code)}&select=*`);
    const row = rows?.[0];
    if (!row) return fail("invalid_grant", "unknown or expired authorization code");

    if (row.consumed_at) {
      // Someone is presenting a code that was already spent. Whoever they are,
      // the code is compromised, and so is everything it bought.
      await revokeConnection(row.connection_id,
        `authorization code replayed for client ${row.client_id}; connection revoked`);
      return fail("invalid_grant",
        "this authorization code has already been redeemed. It has been treated as " +
        "compromised and the connection it created is revoked — authorise again.");
    }
    if (new Date(row.expires_at).getTime() < Date.now())
      return fail("invalid_grant", "authorization code expired — start again");
    if (row.client_id !== client_id)
      return fail("invalid_grant", "this code was issued to a different client");
    if (!redirectAllowed([row.redirect_uri], redirect_uri))
      return fail("invalid_grant", "redirect_uri does not match the one the code was issued for");
    if (!pkceMatches(code_verifier, row.code_challenge))
      return fail("invalid_grant", "PKCE verification failed");

    await sb("PATCH", `oauth_codes?code_hash=eq.${sha256(code)}`,
      { consumed_at: new Date().toISOString() });
    const tokens = await issueTokens(row.connection_id, row.scopes);
    return NextResponse.json(
      { ...tokens, token_type: "Bearer", scope: (row.scopes ?? []).join(" ") },
      { headers: noStore },
    );
  }

  if (grant === "refresh_token") {
    const { refresh_token, client_id } = p;
    if (!refresh_token) return fail("invalid_request", "refresh_token is required");
    const rows = await sb("GET",
      `oauth_tokens?token_hash=eq.${sha256(refresh_token)}&kind=eq.refresh&select=*`);
    const tok = rows?.[0];
    if (!tok) return fail("invalid_grant", "unknown refresh token");

    if (tok.rotated_to) {
      await revokeConnection(tok.connection_id,
        `rotated refresh token presented again for client ${client_id ?? "unknown"}; ` +
        `two holders means one is not the client, so the connection is revoked`);
      return fail("invalid_grant",
        "this refresh token was already exchanged. Two holders means one of them is not " +
        "you, so every token on this connection has been revoked. Authorise again.");
    }
    if (tok.revoked_at) return fail("invalid_grant", "this token has been revoked");
    if (new Date(tok.expires_at).getTime() < Date.now())
      return fail("invalid_grant", "refresh token expired — authorise again");

    const scopes = parseScopes((p.scope || (tok.scopes ?? []).join(" ")));
    const narrowed = scopes.filter((s) => (tok.scopes ?? []).includes(s));
    const tokens = await issueTokens(tok.connection_id, narrowed.length ? narrowed : tok.scopes);
    const fresh = await sb("GET",
      `oauth_tokens?token_hash=eq.${sha256(tokens.refresh_token)}&select=id`);
    await sb("PATCH", `oauth_tokens?id=eq.${tok.id}`,
      { rotated_to: fresh?.[0]?.id ?? null, revoked_at: new Date().toISOString() });

    return NextResponse.json(
      { ...tokens, token_type: "Bearer", scope: (narrowed.length ? narrowed : tok.scopes).join(" "),
        expires_in: ACCESS_TTL_S },
      { headers: noStore },
    );
  }

  return fail("unsupported_grant_type",
    "this server issues tokens for authorization_code and refresh_token only");
}
