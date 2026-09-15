import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { requireEditor, sb } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANKS = ["cabin-boy", "deckhand", "navigator", "captain", "admiral"];
const INTERNAL_PREFIX = "terraveler-";

/**
 * Humans and agents, distinguished by the one column that already draws the
 * line: contributors.human_principal_id. A contributor with one is a
 * human's own standing; a contributor without one is an agent's — modern
 * (agent_accounts-backed) or legacy (handle+api_key, pre-OAuth) alike. No
 * new table: this reads the identity model that already exists
 * (supabase/agent_identity.sql, supabase/oauth.sql) instead of duplicating
 * it under a second name.
 */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const [standing, contributors, humanPrincipals, agentAccounts, links] = await Promise.all([
      sb("GET", "contributor_standing?select=*"),
      sb("GET", "contributors?select=id,handle,status,api_key_hash,human_principal_id,created_at"),
      sb("GET", "human_principals?select=id,email,display_name,created_at"),
      sb("GET", "agent_accounts?select=id,public_id,display_name,operator,voyager_name,enrollment,status,contributor_id,created_at"),
      sb("GET", "human_agent_links?revoked_at=is.null&select=human_principal_id,agent_account_id,relation,created_at"),
    ]);

    const standingById = new Map<number, any>(standing.map((s: any) => [s.id, s]));
    const agentByContributorId = new Map<number, any>(agentAccounts.map((a: any) => [a.contributor_id, a]));
    const linksByAgentAccount = new Map<number, any[]>();
    const linksByHuman = new Map<number, any[]>();
    for (const l of links) {
      if (!linksByAgentAccount.has(l.agent_account_id)) linksByAgentAccount.set(l.agent_account_id, []);
      linksByAgentAccount.get(l.agent_account_id)!.push(l);
      if (!linksByHuman.has(l.human_principal_id)) linksByHuman.set(l.human_principal_id, []);
      linksByHuman.get(l.human_principal_id)!.push(l);
    }
    const humanById = new Map<number, any>(humanPrincipals.map((h: any) => [h.id, h]));

    function standingSummary(c: any) {
      const s: any = standingById.get(c.id) ?? {};
      return {
        contributor_id: c.id, handle: c.handle, rank: c.rank ?? s.rank ?? null, status: c.status,
        has_key: Boolean(c.api_key_hash), created_at: c.created_at,
        approvals: s.approvals ?? 0, rejections: s.rejections ?? 0,
        passed_curator: s.passed_curator ?? 0, reviews_given: s.reviews_given ?? 0,
      };
    }

    const humans = humanPrincipals.map((h: any) => {
      const own = contributors.find((c: any) => c.human_principal_id === h.id);
      const linkedAgents = (linksByHuman.get(h.id) ?? []).map((l: any) => {
        const aa = agentAccounts.find((a: any) => a.id === l.agent_account_id);
        const ac = aa ? contributors.find((c: any) => c.id === aa.contributor_id) : null;
        return aa ? {
          agent_account_id: aa.id, public_id: aa.public_id,
          display_name: aa.display_name ?? aa.voyager_name ?? ac?.handle,
          agent_status: aa.status, relation: l.relation, linked_at: l.created_at,
          contributor: ac ? standingSummary(ac) : null,
        } : null;
      }).filter(Boolean);
      return {
        principal_id: h.id, email: h.email, display_name: h.display_name, created_at: h.created_at,
        contributor: own ? standingSummary(own) : null,
        agents: linkedAgents,
      };
    });

    const agents = contributors
      .filter((c: any) => c.human_principal_id === null)
      .map((c: any) => {
        const aa = agentByContributorId.get(c.id);
        const linkedHumans = aa ? (linksByAgentAccount.get(aa.id) ?? []).map((l: any) => {
          const hp: any = humanById.get(l.human_principal_id);
          return hp ? {
            principal_id: hp.id, email: hp.email, display_name: hp.display_name,
            relation: l.relation, linked_at: l.created_at,
          } : null;
        }).filter(Boolean) : [];
        return {
          contributor: standingSummary(c),
          agent_account: aa ? {
            agent_account_id: aa.id, public_id: aa.public_id, display_name: aa.display_name,
            operator: aa.operator, voyager_name: aa.voyager_name, enrollment: aa.enrollment,
            agent_status: aa.status, created_at: aa.created_at,
          } : null,
          is_internal: c.handle.startsWith(INTERNAL_PREFIX),
          humans: linkedHumans,
        };
      });

    return NextResponse.json({ humans, agents });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

/**
 * Admin actions. suspend | reactivate | set-rank | rotate-key operate on a
 * contributor — human or agent, same action, same accountability, since an
 * agent's standing already lives in its own dedicated contributor row and
 * never the human it happens to be linked to (supabase/agent_identity.sql).
 * revoke-link is the one action that has no equivalent yet: today only the
 * human themselves can end an association (app/api/account/agents/unlink);
 * this gives the editor the same power from the desk side.
 */
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  try {
    if (action === "revoke-link") {
      const humanPrincipalId = Number(body.human_principal_id);
      const agentAccountId = Number(body.agent_account_id);
      if (!humanPrincipalId || !agentAccountId) {
        return NextResponse.json({ error: "human_principal_id and agent_account_id required" }, { status: 400 });
      }
      await sb("PATCH",
        `human_agent_links?human_principal_id=eq.${humanPrincipalId}` +
        `&agent_account_id=eq.${agentAccountId}&relation=eq.associated&revoked_at=is.null`,
        { revoked_at: new Date().toISOString() });
      await sb("POST", "audit_log", {
        submission_id: null,
        actor: "editor-in-chief",
        action: "users-revoke-link",
        verdict: null,
        findings: [["INFO", 5, `association between human #${humanPrincipalId} and agent account #${agentAccountId} revoked from the desk`]],
        carta_version: CARTA_VERSION,
      });
      return NextResponse.json({ ok: true, detail: "association revoked" });
    }

    const cid = Number(body.contributor_id);
    if (!cid || !action) {
      return NextResponse.json({ error: "contributor_id and action required" }, { status: 400 });
    }
    const rows = await sb("GET", `contributors?id=eq.${cid}&select=id,handle`);
    if (!rows.length) return NextResponse.json({ error: "no such contributor" }, { status: 404 });
    const handle = rows[0].handle;

    let detail = "";
    let newKey: string | undefined;
    switch (action) {
      case "suspend":
        await sb("PATCH", `contributors?id=eq.${cid}`, { status: "suspended" });
        detail = `'${handle}' suspended`;
        break;
      case "reactivate":
        await sb("PATCH", `contributors?id=eq.${cid}`, { status: "active" });
        detail = `'${handle}' reactivated`;
        break;
      case "set-rank":
        if (!RANKS.includes(String(body.rank))) {
          return NextResponse.json({ error: `rank must be one of: ${RANKS.join(", ")}` }, { status: 400 });
        }
        await sb("PATCH", `contributors?id=eq.${cid}`, { rank: body.rank });
        detail = `'${handle}' rank set to ${body.rank}`;
        break;
      case "rotate-key":
        newKey = randomBytes(24).toString("hex");
        await sb("PATCH", `contributors?id=eq.${cid}`, {
          api_key_hash: createHash("sha256").update(newKey).digest("hex"),
        });
        detail = `'${handle}' api_key rotated`;
        break;
      default:
        return NextResponse.json({ error: "action must be suspend | reactivate | set-rank | rotate-key | revoke-link" }, { status: 400 });
    }

    await sb("POST", "audit_log", {
      submission_id: null,
      actor: "editor-in-chief",
      action: `users-${action}`,
      verdict: null,
      findings: [["INFO", 5, detail]],
      carta_version: CARTA_VERSION,
    });
    return NextResponse.json({ ok: true, detail, ...(newKey ? { api_key: newKey } : {}) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
