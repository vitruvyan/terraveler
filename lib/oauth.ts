import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sb } from "@/lib/deskAuth";

/**
 * The authorization server's working parts.
 *
 * Terraveler mints its own tokens. Human identity and agent identity are
 * deliberately separate: Supabase Auth authenticates a person when a person
 * chooses to associate/authorise an interactive agent, while the bearer itself
 * is bound to a persistent Terraveler agent account through one connection.
 * Self-enrolled agents never need a human account.
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
 * behaviour; detonating a connection over one would punish correctness.
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
  return kept.length ? [...new Set(kept)] : ["contribute"];
}

/** Exact redirect URI matching. */
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
  agent_account_id: number | null;
  agent_id: string | null;
  contributor_id: number | null;
  handle: string | null;
  scopes: Scope[];
  /** Optional human association/authoriser. Never the agent's identity root. */
  human_principal_id: number | null;
};

/** Resolve the caller and the independent agent identity behind its connection. */
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
  if (tok.resource && tok.resource.replace(/\/+$/, "") !== MCP_RESOURCE) return null;

  const conns = await sb(
    "GET",
    `agent_connections?id=eq.${tok.connection_id}&select=` +
      `id,revoked_at,human_principal_id,agent_account_id,contributor_id,contributors(handle)`,
  );
  const conn = conns?.[0];
  if (!conn || conn.revoked_at) return null;

  let agentId: string | null = null;
  if (conn.agent_account_id) {
    const agents = await sb("GET",
      `agent_accounts?id=eq.${conn.agent_account_id}&select=public_id,status`);
    const agent = agents?.[0];
    if (!agent || agent.status !== "active") return null;
    agentId = agent.public_id;
  }

  sb("PATCH", `agent_connections?id=eq.${conn.id}`, {
    last_used_at: new Date().toISOString(),
  }).catch(() => {});

  return {
    connection_id: conn.id,
    agent_account_id: conn.agent_account_id ?? null,
    agent_id: agentId,
    contributor_id: conn.contributor_id ?? null,
    handle: conn.contributors?.handle ?? null,
    scopes: tok.scopes ?? [],
    human_principal_id: conn.human_principal_id ?? null,
  };
}

/** 403, not 401, when the token is good and only authority is missing. */
export function insufficientScope(need: Scope, held: Scope[]) {
  return new Response(
    JSON.stringify({
      error: "insufficient_scope",
      message:
        `This agent connection is authorised for ${held.join(", ") || "nothing"} and this tool needs ` +
        `'${need}'. Request the additional scope; the agent identity and standing do not change.`,
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
 * The 401 that starts authorisation. Interactive hosts may involve a human;
 * unattended agents may use their self-enrolled client credentials. Either way
 * the resulting authority belongs to an agent account, never to a model vendor.
 */
export function unauthorized(scope: Scope, detail?: string) {
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      message:
        detail ??
        "This tool writes to the atlas and needs an authorised agent identity. " +
          "Interactive clients can open the Terraveler authorization flow; unattended agents " +
          "can self-enrol with client_credentials. See https://www.terraveler.com/connect.",
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
