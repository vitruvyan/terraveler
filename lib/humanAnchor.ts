import { sb } from "@/lib/deskAuth";
import { ANCHORED_MAX_OPEN } from "@/lib/agentCapabilities";

/**
 * The daily submission quota exists for the editor's finite attention and to
 * bound what an anonymous stranger holding a key can do (Carta 7.1). An agent
 * with a LIVE link to a human is not a stranger — a person answers for what it
 * sends, and the human-anchored rank (lib/rankPromotion.ts) carries the
 * accountability — so the daily COUNT is replaced, for it, by the bound that
 * actually protects the editor: how many of that human's drafts are waiting,
 * unjudged, in the queue (ANCHORED_MAX_OPEN, summed over every agent the human
 * has linked). It still cannot publish, every draft still needs a verdict, and
 * the per-minute API rate limits (lib/externalBetaSecurity.ts) are unchanged.
 *
 * What counts as "anchored" is deliberately narrow: a non-revoked
 * human_agent_links row (relation 'associated'). NOT the legacy
 * contributors.human_principal_id column, which identifies a human's OWN
 * contributor row and survives an unlink; and a link is never revived by an
 * agent's own request (lib/agentIdentity.ts::linkHumanToAgent).
 *
 * Fails closed: any error, missing row or revoked link means "not anchored",
 * and the ordinary rank quota applies.
 *
 * Known residual: anyone can sign up, so N throwaway humans each linking an
 * agent get N queues. That is no worse than the N self-enrolled autonomous
 * agents an anonymous stranger can already create (3/day each); tying the
 * exemption to a vetted human is a separate decision.
 */
export type Allowance = { anchored: boolean; open: number; humanIds: number[] };

const NOT_ANCHORED: Allowance = { anchored: false, open: 0, humanIds: [] };

/** The statuses in which a draft is waiting for someone to judge it. */
const OPEN_STATUSES = "peer-review,human-review";

const ids = (rows: unknown, key: string): number[] =>
  (Array.isArray(rows) ? rows : []).map((r: any) => r?.[key]).filter((n: unknown): n is number => Number.isInteger(n));

export async function humanAllowance(contributorId: number): Promise<Allowance> {
  try {
    if (!Number.isInteger(contributorId)) return NOT_ANCHORED;
    const accounts = ids(await sb("GET", `agent_accounts?contributor_id=eq.${contributorId}&select=id`), "id");
    if (!accounts.length) return NOT_ANCHORED;
    const humanIds = ids(await sb("GET",
      `human_agent_links?agent_account_id=in.(${accounts.join(",")})&relation=eq.associated` +
      `&revoked_at=is.null&select=human_principal_id`), "human_principal_id");
    if (!humanIds.length) return NOT_ANCHORED;

    // Every agent this human has linked, and their contributors: the queue is the human's.
    const linked = ids(await sb("GET",
      `human_agent_links?human_principal_id=in.(${[...new Set(humanIds)].join(",")})&relation=eq.associated` +
      `&revoked_at=is.null&select=agent_account_id`), "agent_account_id");
    const contributors = new Set<number>([contributorId]);
    if (linked.length)
      for (const id of ids(await sb("GET", `agent_accounts?id=in.(${linked.join(",")})&select=contributor_id`), "contributor_id"))
        contributors.add(id);
    const open = ids(await sb("GET",
      `submissions?contributor_id=in.(${[...contributors].join(",")})&status=in.(${OPEN_STATUSES})` +
      `&select=id&limit=${ANCHORED_MAX_OPEN + 1}`), "id").length;
    return { anchored: true, open, humanIds: [...new Set(humanIds)] };
  } catch {
    return NOT_ANCHORED;
  }
}

export const openQueueMessage = (open: number) =>
  `${open} of your drafts are already waiting for a verdict (limit ${ANCHORED_MAX_OPEN} per linked human). ` +
  `Resume when some have been judged — the editor's attention is the scarce thing, not your time.`;
