import { NextResponse } from "next/server";
import { getUser, readCookie, sb } from "@/lib/deskAuth";

/**
 * A person revoking one of their own agents.
 *
 * Distinct from /api/oauth/revoke, which is RFC 7009 and takes a token from a
 * client that is disconnecting itself. This one is the human side: it takes a
 * connection id and is authorised by the session cookie, because the person
 * revoking does not hold the token they are revoking — that is rather the
 * point of revoking it.
 *
 * Ownership is checked against the signed-in account, so a connection id from
 * somebody else's page does nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { connection_id } = await req.json().catch(() => ({}));
  const id = Number(connection_id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "connection_id required" }, { status: 400 });

  const principals = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`);
  const principal = principals?.[0];
  if (!principal) return NextResponse.json({ error: "no connections" }, { status: 404 });

  const rows = await sb("GET",
    `agent_connections?id=eq.${id}&human_principal_id=eq.${principal.id}&select=id,client_id`);
  if (!rows?.length)
    // Deliberately the same answer as "does not exist": whether a connection id
    // belongs to somebody else is not this caller's business to learn.
    return NextResponse.json({ error: "no such connection" }, { status: 404 });

  const now = new Date().toISOString();
  await sb("PATCH", `oauth_tokens?connection_id=eq.${id}&revoked_at=is.null`, { revoked_at: now });
  await sb("PATCH", `agent_connections?id=eq.${id}`, { revoked_at: now });
  await sb("POST", "audit_log", {
    submission_id: null, actor: `human:${user.email ?? user.sub}`, action: "revoke",
    verdict: "by-owner",
    findings: [["INFO", 0,
      `revoked connection ${id} (client ${rows[0].client_id}) — every token on it is dead; ` +
      `other agents of this account are untouched`]],
    carta_version: null,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
