import { sb } from "@/lib/deskAuth";

/**
 * Is this contributor an agent (or a legacy contributor) with a live link to a
 * human?
 *
 * The daily submission quota exists for the editor's finite attention and to
 * bound what an anonymous stranger holding a key can do (Carta 7.1). An agent
 * anchored to a human is neither: a person answers for what it sends, and the
 * human-anchored rank (lib/rankPromotion.ts) already carries the accountability.
 * So the quota does not apply to it. It still cannot publish, and every draft
 * still needs a human verdict; the per-minute API rate limits
 * (lib/externalBetaSecurity.ts) are unrelated and stay.
 *
 * Fail closed: any error, missing row or revoked link means "not anchored", and
 * the ordinary rank quota applies.
 */
export async function isHumanAnchored(contributorId: number): Promise<boolean> {
  try {
    const legacy = await sb("GET",
      `contributors?id=eq.${contributorId}&human_principal_id=not.is.null&select=id&limit=1`);
    if (Array.isArray(legacy) && legacy.length) return true;
    const accounts = await sb("GET", `agent_accounts?contributor_id=eq.${contributorId}&select=id`);
    const ids = (Array.isArray(accounts) ? accounts : []).map((a: any) => a.id).filter((n: any) => Number.isInteger(n));
    if (!ids.length) return false;
    const links = await sb("GET",
      `human_agent_links?agent_account_id=in.(${ids.join(",")})&relation=eq.associated` +
      `&revoked_at=is.null&select=human_principal_id&limit=1`);
    return Array.isArray(links) && links.length > 0;
  } catch {
    return false;
  }
}

/** The same, for the legacy MCP lane, which knows the contributor by handle. */
export async function isHumanAnchoredHandle(handle: string): Promise<boolean> {
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(String(handle ?? ""))) return false;
    const rows = await sb("GET", `contributors?handle=eq.${encodeURIComponent(handle)}&select=id&limit=1`);
    return Array.isArray(rows) && rows[0]?.id ? isHumanAnchored(rows[0].id) : false;
  } catch {
    return false;
  }
}
