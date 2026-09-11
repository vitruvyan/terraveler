import { createHash } from "crypto";
import { dataApi } from "@/lib/deskAuth";

export type HumanAccount = { sub: string; email: string | null };
export type HumanContributor = {
  id: number;
  handle: string;
  rank: string;
  status: string;
  humanPrincipalId: number;
};

function privateHumanHandle(sub: string): string {
  const suffix = createHash("sha256").update(sub).digest("hex").slice(0, 10);
  return `traveler-${suffix}`;
}

async function agentContributorIds(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await dataApi(
    "GET",
    `agent_accounts?contributor_id=in.(${ids.join(",")})&select=contributor_id`,
  );
  return new Set(rows.map((row: any) => Number(row.contributor_id)));
}

/**
 * Resolve the standing-bearing contributor that belongs to a human account.
 * Agent contributors are never selected through a legacy human_principal_id or
 * through a human-agent association.
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

  // `contributors.human_principal_id` predates first-class agent accounts. Old
  // OAuth agent contributors may still carry it, so never assume the first row
  // rooted at a human principal is the human's own standing-bearing identity.
  const existing = await dataApi(
    "GET",
    `contributors?human_principal_id=eq.${humanPrincipalId}` +
      `&select=id,handle,rank,status&order=id.asc`,
  );
  if (existing.length) {
    const agentIds = await agentContributorIds(existing.map((row: any) => Number(row.id)));
    const human = existing.find((row: any) => !agentIds.has(Number(row.id)));
    if (human) return { ...human, humanPrincipalId };
  }

  // Preserve contributors created by the pre-Chartroom web contribution path,
  // which used the signed-in email as the public handle. New human identities
  // never expose an email address: they receive a stable pseudonymous handle.
  const legacyHandle = user.email;
  if (legacyHandle) {
    const legacyRows = await dataApi(
      "GET",
      `contributors?handle=eq.${encodeURIComponent(legacyHandle)}` +
        `&select=id,handle,rank,status,human_principal_id&limit=1`,
    );
    if (legacyRows.length && legacyRows[0].human_principal_id == null) {
      const agentIds = await agentContributorIds([Number(legacyRows[0].id)]);
      if (!agentIds.size) {
        const linked = await dataApi(
          "PATCH",
          `contributors?id=eq.${legacyRows[0].id}&human_principal_id=is.null`,
          { human_principal_id: humanPrincipalId },
        );
        if (linked.length) return { ...linked[0], humanPrincipalId };
      }
    }
  }

  const base = privateHumanHandle(user.sub);
  const byHandle = await dataApi(
    "GET",
    `contributors?handle=eq.${encodeURIComponent(base)}` +
      `&select=id,handle,rank,status,human_principal_id&limit=1`,
  );
  if (byHandle.length && byHandle[0].human_principal_id == null) {
    const agentIds = await agentContributorIds([Number(byHandle[0].id)]);
    if (!agentIds.size) {
      const linked = await dataApi(
        "PATCH",
        `contributors?id=eq.${byHandle[0].id}&human_principal_id=is.null`,
        { human_principal_id: humanPrincipalId },
      );
      if (linked.length) return { ...linked[0], humanPrincipalId };
    }
  }

  const handle = byHandle.length ? `${base}-${user.sub.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6)}` : base;
  const made = await dataApi("POST", "contributors", {
    handle,
    human_principal_id: humanPrincipalId,
  });
  return { ...made[0], humanPrincipalId };
}
