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

/** Create an agent identity and the contributor row that owns its standing. */
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
      // Random handle collisions are extraordinarily unlikely; retry cleanly.
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
    await sb("DELETE", `contributors?id=eq.${contributor.id}`).catch(() => {});
    throw error;
  }
}

/**
 * Optional human↔agent association. It records consent/provenance, not identity:
 * unlinking must never delete the agent or transfer its standing.
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

export type ConnectionIdentity = {
  connectionId: number;
  agentAccountId?: number | null;
  contributorId?: number | null;
  humanPrincipalId?: number | null;
  displayName?: string | null;
  operator?: string | null;
};

/**
 * Give one connection an independent agent identity. This is the migration
 * seam used by both bearer bootstrap and browser authorisation: old contributor
 * standing is wrapped rather than copied or reset.
 */
export async function ensureAgentForConnection(c: ConnectionIdentity): Promise<AgentIdentity> {
  if (c.agentAccountId) {
    const existing = await readAgent(c.agentAccountId);
    if (existing) {
      if (c.humanPrincipalId) await linkHumanToAgent(c.humanPrincipalId, existing.id);
      return hydrate(existing);
    }
  }

  if (c.contributorId) {
    const existing = await sb("GET",
      `agent_accounts?contributor_id=eq.${c.contributorId}` +
      `&select=id,public_id,contributor_id,display_name,operator,enrollment,status&limit=1`);
    let agent = existing?.[0] as AgentAccount | undefined;
    if (!agent) {
      const rows = await sb("GET", `contributors?id=eq.${c.contributorId}&select=handle`);
      agent = (await sb("POST", "agent_accounts", {
        public_id: publicId(),
        contributor_id: c.contributorId,
        display_name: c.displayName ?? rows?.[0]?.handle ?? null,
        operator: c.operator ?? null,
        enrollment: "legacy-import",
        status: "active",
      }))?.[0];
    }
    if (!agent) throw new Error("could not upgrade contributor to agent identity");
    await sb("PATCH", `agent_connections?id=eq.${c.connectionId}`, {
      agent_account_id: agent.id,
      contributor_id: agent.contributor_id,
    });
    if (c.humanPrincipalId) await linkHumanToAgent(c.humanPrincipalId, agent.id);
    return hydrate(agent);
  }

  const agent = await createAgentAccount({
    displayName: c.displayName ?? null,
    operator: c.operator ?? null,
    enrollment: c.humanPrincipalId ? "human-assisted" : "self",
  });
  await sb("PATCH", `agent_connections?id=eq.${c.connectionId}`, {
    agent_account_id: agent.id,
    contributor_id: agent.contributor_id,
  });
  if (c.humanPrincipalId) await linkHumanToAgent(c.humanPrincipalId, agent.id);
  return agent;
}

/** Resolve the independent agent behind a bearer connection. */
export async function ensureAgentForBearer(b: Bearer): Promise<AgentIdentity> {
  return ensureAgentForConnection({
    connectionId: b.connection_id,
    agentAccountId: b.agent_account_id,
    contributorId: b.contributor_id,
    humanPrincipalId: b.human_principal_id,
  });
}

export async function getAgentAccount(id: number): Promise<AgentIdentity | null> {
  const agent = await readAgent(id);
  return agent ? hydrate(agent) : null;
}
