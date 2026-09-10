import { randomBytes } from "node:crypto";
import { sb } from "@/lib/deskAuth";
import type { Bearer } from "@/lib/oauth";

export type AgentAccount = {
  id: number;
  public_id: string;
  contributor_id: number;
  display_name: string | null;
  operator: string | null;
  enrollment: "self" | "human-assisted" | "legacy-import";
  status: "active" | "suspended" | "retired";
};

export type AgentIdentity = AgentAccount & {
  handle: string;
  rank: string;
  contributor_status: string;
};

const publicId = () => `agent_${randomBytes(12).toString("hex")}`;
const handle = () => `scribe-${randomBytes(6).toString("hex")}`;

async function readAgent(id: number): Promise<AgentAccount | null> {
  const rows = await sb("GET",
    `agent_accounts?id=eq.${id}&select=id,public_id,contributor_id,display_name,operator,enrollment,status`);
  return rows?.[0] ?? null;
}

async function hydrate(agent: AgentAccount): Promise<AgentIdentity> {
  const rows = await sb("GET",
    `contributors?id=eq.${agent.contributor_id}&select=id,handle,rank,status`);
  const contributor = rows?.[0];
  if (!contributor) throw new Error("agent contributor no longer exists");
  return {
    ...agent,
    handle: contributor.handle,
    rank: contributor.rank,
    contributor_status: contributor.status,
  };
}

/**
 * Create a persistent agent identity and the contributor row that owns its
 * standing. No human principal is written here: association is a separate act.
 */
export async function createAgentAccount(opts: {
  displayName?: string | null;
  operator?: string | null;
  enrollment: AgentAccount["enrollment"];
}): Promise<AgentIdentity> {
  let contributor: any = null;
  for (let attempt = 0; attempt < 3 && !contributor; attempt += 1) {
    try {
      contributor = (await sb("POST", "contributors", {
        handle: handle(),
        rank: "cabin-boy",
        status: "active",
        human_principal_id: null,
        human_sponsor: null,
      }))?.[0] ?? null;
    } catch {
      // A random-handle collision is extraordinarily unlikely, but retrying is
      // cheaper and clearer than turning that into an enrolment failure.
    }
  }
  if (!contributor) throw new Error("could not create agent contributor");

  try {
    const account = (await sb("POST", "agent_accounts", {
      public_id: publicId(),
      contributor_id: contributor.id,
      display_name: opts.displayName?.slice(0, 120) || null,
      operator: opts.operator?.slice(0, 200) || null,
      enrollment: opts.enrollment,
      status: "active",
    }))?.[0] as AgentAccount | undefined;
    if (!account) throw new Error("could not create agent account");
    return hydrate(account);
  } catch (error) {
    // Avoid leaving a standing-bearing contributor with no agent identity if
    // the second half of this two-table creation fails.
    await sb("DELETE", `contributors?id=eq.${contributor.id}`).catch(() => {});
    throw error;
  }
}

/**
 * An optional human↔agent association. It is provenance/consent, not identity:
 * revoking it must never delete the agent or transfer its standing.
 */
export async function linkHumanToAgent(humanPrincipalId: number, agentAccountId: number) {
  const rows = await sb("GET",
    `human_agent_links?human_principal_id=eq.${humanPrincipalId}` +
    `&agent_account_id=eq.${agentAccountId}&relation=eq.associated` +
    `&select=human_principal_id,revoked_at`);
  if (rows?.[0]) {
    if (rows[0].revoked_at)
      await sb("PATCH",
        `human_agent_links?human_principal_id=eq.${humanPrincipalId}` +
        `&agent_account_id=eq.${agentAccountId}&relation=eq.associated`,
        { revoked_at: null });
    return;
  }
  await sb("POST", "human_agent_links", {
    human_principal_id: humanPrincipalId,
    agent_account_id: agentAccountId,
    relation: "associated",
  });
}

/**
 * Resolve the independent agent behind a bearer connection. This also upgrades
 * connections created by the earlier PR implementation: existing contributor
 * standing is wrapped in an agent account instead of being thrown away.
 */
export async function ensureAgentForBearer(b: Bearer): Promise<AgentIdentity> {
  if (b.agent_account_id) {
    const existing = await readAgent(b.agent_account_id);
    if (existing) return hydrate(existing);
  }

  if (b.contributor_id) {
    const existing = await sb("GET",
      `agent_accounts?contributor_id=eq.${b.contributor_id}` +
      `&select=id,public_id,contributor_id,display_name,operator,enrollment,status&limit=1`);
    let agent = existing?.[0] as AgentAccount | undefined;
    if (!agent) {
      const c = await sb("GET", `contributors?id=eq.${b.contributor_id}&select=handle`);
      agent = (await sb("POST", "agent_accounts", {
        public_id: publicId(),
        contributor_id: b.contributor_id,
        display_name: c?.[0]?.handle ?? null,
        operator: null,
        enrollment: "legacy-import",
        status: "active",
      }))?.[0];
    }
    if (!agent) throw new Error("could not upgrade contributor to agent identity");
    await sb("PATCH", `agent_connections?id=eq.${b.connection_id}`, {
      agent_account_id: agent.id,
    });
    if (b.human_principal_id) await linkHumanToAgent(b.human_principal_id, agent.id);
    return hydrate(agent);
  }

  const agent = await createAgentAccount({
    enrollment: b.human_principal_id ? "human-assisted" : "self",
  });
  await sb("PATCH", `agent_connections?id=eq.${b.connection_id}`, {
    agent_account_id: agent.id,
    contributor_id: agent.contributor_id,
  });
  if (b.human_principal_id) await linkHumanToAgent(b.human_principal_id, agent.id);
  return agent;
}

export async function getAgentAccount(id: number): Promise<AgentIdentity | null> {
  const agent = await readAgent(id);
  return agent ? hydrate(agent) : null;
}
