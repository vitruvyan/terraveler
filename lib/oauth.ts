import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sb } from "@/lib/deskAuth";

/**
 * The authorization server's working parts.
 *
 * Terraveler mints its own tokens. The identity provider authenticates the
 * human once, at the consent step, and takes no further part — so a token is
 * bound to a Terraveler contributor, a Terraveler scope and one agent
 * connection, and nothing here depends on a feature flag on someone else's
 * project.
 *
 * Every secret is stored as a sha256 and compared in constant time, for the
 * same reason the api_key was: a table of live credentials is a table worth
 * stealing, and a comparison that returns early is a comparison that can be
 * measured.
 */

export const SCOPES = ["contribute", "review", "appeal"] as const;
export type Scope = (typeof SCOPES)[number];

/** Ten minutes is the ceiling RFC 6749 suggests for a code; one is plenty. */
export const CODE_TTL_S = 300;
/** Short, because a leaked access token is only as bad as its lifetime. */
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 60 * 60 * 24 * 60;
/**
 * How long after a rotation a re-presented refresh token is a retry rather
 * than a theft. Concurrent refreshes and flaky networks are ordinary client
 * behaviour; detonating a connection over one would punish correctness. Ten
 * seconds is what the widely-deployed implementations settle on.
 */
export const REUSE_GRACE_MS = 10_000;

/** The one resource tokens from this server may be spent at. */
export const MCP_RESOURCE = "https://www.terraveler.com/api/mcp";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256, and only S256: `plain` is in the spec and protects nothing. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return constantTimeEqual(computed, challenge);
}

export function parseScopes(raw: unknown): Scope[] {
  const asked = String(raw ?? "").split(/[\s+]+/).filter(Boolean);
  const kept = asked.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  // Asking for nothing means asking to contribute; asking for something we do
  // not grant is dropped rather than refused, per RFC 6749 §3.3, and the token
  // response says what was actually granted.
  return kept.length ? [...new Set(kept)] : ["contribute"];
}

/**
 * A redirect URI must match a registered one exactly.
 *
 * Not by prefix and not by pattern: "starts with" is how an open redirect
 * becomes a code-stealing redirect, and every real client registers the exact
 * URI it will use.
 */
export function redirectAllowed(registered: string[], given: string): boolean {
  return registered.some((u) => constantTimeEqual(u, given));
}

export type TokenPair = { access_token: string; refresh_token: string; expires_in: number };

export async function issueTokens(
  connectionId: number, scopes: Scope[], resource: string = MCP_RESOURCE,
): Promise<TokenPair> {
  const access = secret();
  const refresh = secret();
  const now = Date.now();
  await sb("POST", "oauth_tokens", [
    {
      token_hash: sha256(access), kind: "access", connection_id: connectionId,
      scopes, resource, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString(),
    },
    {
      token_hash: sha256(refresh), kind: "refresh", connection_id: connectionId,
      scopes, resource, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString(),
    },
  ]);
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S };
}

export type Bearer = {
  connection_id: number;
  contributor_id: number | null;
  handle: string | null;
  scopes: Scope[];
  /** Null for an agent that authorised itself. Not missing data — a statement. */
  human_principal_id: number | null;
};

/**
 * Who is calling, if anyone.
 *
 * Returns null for an absent, unknown, expired or revoked token — the caller
 * decides whether that is a refusal or simply an anonymous read, because most
 * of this atlas is readable by anyone and demanding a login to see it would be
 * the opposite of the point.
 */
export async function verifyBearer(req: Request): Promise<Bearer | null> {
  const raw = req.headers.get("authorization") ?? "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const rows = await sb(
    "GET",
    `oauth_tokens?token_hash=eq.${sha256(m[1].trim())}&kind=eq.access&select=` +
      `scopes,expires_at,revoked_at,connection_id,resource`,
  );
  const tok = rows?.[0];
  if (!tok || tok.revoked_at || new Date(tok.expires_at).getTime() < Date.now()) return null;
  // Audience. A token minted for another MCP server must not be spendable here,
  // which is the whole reason the spec makes `resource` mandatory.
  if (tok.resource && tok.resource.replace(/\/+$/, "") !== MCP_RESOURCE) return null;

  const conns = await sb(
    "GET",
    `agent_connections?id=eq.${tok.connection_id}&select=` +
      `id,revoked_at,human_principal_id,contributor_id,contributors(handle)`,
  );
  const conn = conns?.[0];
  if (!conn || conn.revoked_at) return null;

  // Best effort: a failed timestamp must not fail a request.
  sb("PATCH", `agent_connections?id=eq.${conn.id}`, {
    last_used_at: new Date().toISOString(),
  }).catch(() => {});

  return {
    connection_id: conn.id,
    contributor_id: conn.contributor_id ?? null,
    handle: conn.contributors?.handle ?? null,
    scopes: tok.scopes ?? [],
    human_principal_id: conn.human_principal_id ?? null,
  };
}

/**
 * 403, not 401, when the token is good and the scope is not.
 *
 * A client that reads 401 concludes it has lost its authorisation and starts
 * again from discovery; what it actually needs is to ask for one more scope.
 * RFC 6750 has a name for that and clients act on it.
 */
export function insufficientScope(need: Scope, held: Scope[]) {
  return new Response(
    JSON.stringify({
      error: "insufficient_scope",
      message:
        `You are authorised for ${held.join(", ") || "nothing"} and this tool needs ` +
        `'${need}'. Your authorisation is intact — ask your human to approve the extra ` +
        `scope rather than starting again.`,
      required_scopes: [...new Set([...held, need])],
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate":
          `Bearer realm="Terraveler", error="insufficient_scope", scope="${need}", ` +
          `resource_metadata="https://www.terraveler.com/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

/**
 * The 401 that starts the whole dance.
 *
 * RFC 9728: the WWW-Authenticate header names the metadata document, and a
 * compliant client follows it, registers itself, opens a browser and comes
 * back with a token — without the human ever being handed a secret. A bare 401
 * would leave it guessing.
 */
export function unauthorized(scope: Scope, detail?: string) {
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      message:
        detail ??
        "This tool writes to the atlas, so it needs your human to authorise it once. " +
          "Your client should now discover the authorization server and open a browser; " +
          "if it cannot, see https://www.terraveler.com/connect.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate":
          `Bearer realm="Terraveler", scope="${scope}", ` +
          `resource_metadata="https://www.terraveler.com/.well-known/oauth-protected-resource"`,
      },
    },
  );
}
