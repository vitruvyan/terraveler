import { dataApi } from "@/lib/deskAuth";

export type HumanAccount = { sub: string; email: string | null };
export type HumanContributor = {
  id: number;
  handle: string;
  rank: string;
  status: string;
  humanPrincipalId: number;
};

/**
 * Resolve the standing-bearing contributor that belongs to a human account.
 * Agent contributors are never selected through a human-agent association.
 */
export async function ensureHumanContributor(user: HumanAccount): Promise<HumanContributor> {
  let principals = await dataApi(
    "GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user.sub)}&select=id`,
  );
  if (!principals.length) {
    principals = await dataApi("POST", "human_principals", {
      auth_sub: user.sub,
      email: user.email,
    });
  }
  const humanPrincipalId = Number(principals[0].id);

  const existing = await dataApi(
    "GET",
    `contributors?human_principal_id=eq.${humanPrincipalId}` +
      `&select=id,handle,rank,status&limit=1`,
  );
  if (existing.length) {
    return { ...existing[0], humanPrincipalId };
  }

  const base = (user.email || `human-${user.sub.slice(0, 8)}`).slice(0, 80);
  const byHandle = await dataApi(
    "GET",
    `contributors?handle=eq.${encodeURIComponent(base)}` +
      `&select=id,handle,rank,status,human_principal_id&limit=1`,
  );

  // Preserve contributors made by the pre-Chartroom web path, but never adopt
  // a contributor already rooted in another human account or an agent.
  if (byHandle.length && byHandle[0].human_principal_id == null) {
    const agents = await dataApi(
      "GET",
      `agent_accounts?contributor_id=eq.${byHandle[0].id}&select=id&limit=1`,
    );
    if (!agents.length) {
      const linked = await dataApi(
        "PATCH",
        `contributors?id=eq.${byHandle[0].id}&human_principal_id=is.null`,
        { human_principal_id: humanPrincipalId },
      );
      if (linked.length) return { ...linked[0], humanPrincipalId };
    }
  }

  const handle = byHandle.length ? `${base}-${user.sub.slice(0, 6)}` : base;
  const made = await dataApi("POST", "contributors", {
    handle,
    human_principal_id: humanPrincipalId,
  });
  return { ...made[0], humanPrincipalId };
}
