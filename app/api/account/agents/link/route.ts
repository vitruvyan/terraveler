import { NextResponse } from "next/server";
import { getUser, readCookie, rpc, sb } from "@/lib/deskAuth";
import { getAgentAccount, linkHumanToAgent } from "@/lib/agentIdentity";
import { sha256 } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redeem a short-lived token minted BY the agent. This means a human can link
 * an already-existing independent agent without knowing an agent credential and
 * without the human account becoming the root of that agent's identity.
 */
export async function POST(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  if (!user)
    return NextResponse.json({ error: "Sign in as a human first." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const linkToken = typeof body?.link_token === "string" ? body.link_token.trim() : "";
  if (linkToken.length < 20)
    return NextResponse.json({ error: "Paste the complete one-time link token from the agent." }, { status: 400 });

  const claimed = await rpc("claim_agent_link_token", {
    p_token_hash: sha256(linkToken),
    p_purpose: "human-association",
  });
  const agentAccountId = claimed?.[0]?.agent_account_id;
  if (!agentAccountId)
    return NextResponse.json(
      { error: "That link token is unknown, expired, already used or intended for a runtime." },
      { status: 400 },
    );

  const agent = await getAgentAccount(Number(agentAccountId));
  if (!agent || agent.status !== "active" || agent.contributor_status !== "active")
    return NextResponse.json({ error: "That agent is not active." }, { status: 400 });

  const found = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`);
  const principal = found?.[0]
    ?? (await sb("POST", "human_principals", { auth_sub: user.sub, email: user.email }))?.[0];
  if (!principal?.id)
    return NextResponse.json({ error: "Could not resolve your human account." }, { status: 500 });

  await linkHumanToAgent(principal.id, agent.id);
  await sb("POST", "audit_log", {
    submission_id: null,
    actor: `human:${user.email ?? user.sub}`,
    action: "associate-agent",
    verdict: "paired",
    findings: [["INFO", 0, `associated existing agent ${agent.public_id}; standing unchanged`]],
    carta_version: null,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    agent_id: agent.public_id,
    handle: agent.handle,
    display_name: agent.display_name,
    standing: agent.rank,
    note: "The association is now recorded. The agent remains an independent identity and keeps its existing standing.",
  });
}
