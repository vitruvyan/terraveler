import { NextResponse } from "next/server";
import { getUser, readCookie, sb } from "@/lib/deskAuth";

/**
 * Where this person actually is, according to the server.
 *
 * The wizard does not ask anyone to tick a box. A checklist a user can mark
 * complete is a checklist that lies, and the whole reason the first real
 * onboarding was confusing is that at no point could the person see where they
 * were: they added a connector, a login page appeared, and they had to ask
 * someone to read the database before they knew whether it had worked.
 *
 * Every step leaves a trace here, so every step can be observed:
 *
 *   account       a row in human_principals
 *   reached us    a client registered itself (RFC 7591) — not yet attributable
 *   authorised    an agent_connection for this account
 *   named         that connection carries a contributor handle
 *   contributed   a submission under that handle
 *
 * `last_seen` is the important part when nothing is happening. Silence with a
 * timestamp is a diagnosis; silence alone is what sent us hunting through
 * Postgres for an hour.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;

  if (!user) {
    return NextResponse.json({
      step: "account",
      signed_in: false,
      last_seen: null,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const principals = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`);
  const principal = principals?.[0];

  // A client that registered itself in the last hour. It belongs to nobody
  // until consent, so this is reported as a sighting rather than as progress —
  // it is the difference between "your assistant found us" and "you are done".
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await sb("GET",
    `oauth_clients?created_at=gte.${since}&order=created_at.desc&limit=1&select=client_name,created_at`);
  const sighting = recent?.[0] ?? null;

  const connections = principal
    ? await sb("GET",
        `agent_connections?human_principal_id=eq.${principal.id}&revoked_at=is.null` +
        `&order=created_at.desc&select=id,client_id,scopes,contributor_id,last_used_at,` +
        `contributors(handle),oauth_clients(client_name)`)
    : [];

  const live = connections.filter((c: any) => c.contributor_id);
  const named = live[0] ?? null;
  const handle = named?.contributors?.handle ?? null;

  let submissions = 0;
  if (named?.contributor_id) {
    const rows = await sb("GET",
      `submissions?contributor_id=eq.${named.contributor_id}&select=id`);
    submissions = rows?.length ?? 0;
  }

  const step =
    submissions > 0 ? "done"
    : handle ? "contribute"
    : connections.length ? "name"
    : "agent";

  return NextResponse.json({
    step,
    signed_in: true,
    email: user.email,
    agents: connections.map((c: any) => ({
      name: c.oauth_clients?.client_name ?? "An assistant",
      handle: c.contributors?.handle ?? null,
      scopes: c.scopes ?? [],
      used: Boolean(c.last_used_at),
    })),
    handle,
    submissions,
    // What the server last noticed, so a stalled wizard can say something true.
    last_seen: sighting
      ? { what: `${sighting.client_name ?? "an assistant"} registered itself`,
          at: sighting.created_at }
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
