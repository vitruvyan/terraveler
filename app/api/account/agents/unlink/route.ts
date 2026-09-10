import { NextResponse } from "next/server";
import { getUser, readCookie, sb } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revokes only the human↔agent relationship. Agent identity, standing,
 * credentials, connections and audit history remain untouched. */
export async function POST(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentAccountId = Number(body?.agent_account_id);
  if (!Number.isInteger(agentAccountId) || agentAccountId <= 0)
    return NextResponse.json({ error: "Invalid agent account." }, { status: 400 });

  const principals = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`);
  const principal = principals?.[0];
  if (!principal?.id) return NextResponse.json({ ok: true });

  await sb("PATCH",
    `human_agent_links?human_principal_id=eq.${principal.id}` +
    `&agent_account_id=eq.${agentAccountId}&relation=eq.associated&revoked_at=is.null`,
    { revoked_at: new Date().toISOString() });

  await sb("POST", "audit_log", {
    submission_id: null,
    actor: `human:${user.email ?? user.sub}`,
    action: "unlink-agent",
    verdict: "revoked-association",
    findings: [["INFO", 0, `revoked optional association with agent account ${agentAccountId}`]],
    carta_version: null,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    note: "Association revoked. The agent identity, standing and its own credentials are unchanged.",
  });
}
