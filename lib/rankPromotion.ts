import { sb } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";
import RANK_THRESHOLDS from "@/vocab/rank_thresholds.json";

/**
 * Human-anchored rank promotion.
 *
 * Reputation belongs to the human, never to the single agent/bot/model that
 * happens to be speaking for it. `contributors.rank` had no automatic path
 * upward at all before this — the only way to change it was an editor
 * setting it by hand from the desk (app/api/desk/users/route.ts's
 * 'set-rank', which this leaves untouched as the manual escape hatch).
 *
 * This answers a DIFFERENT, WIDER question than scripts/desk_checks.py's
 * reviewer_is_established()/reviewer_has_negative_signal(): those ask "is
 * this one reviewer, on this one dossier, right now" trustworthy; this asks
 * "what has this human, across every agent it has ever linked, earned" —
 * evaluated far less often (only at the trigger points below, never per
 * request) and written down rather than answered fresh each time. The two
 * share a vocabulary file (vocab/rank_thresholds.json) for the one concept
 * they do have in common — a negative pattern is a negative pattern — but
 * stay separate functions on purpose, so neither's escalation reasoning
 * reads as a rank calculation in disguise.
 *
 * An agent never linked to a human (no row in human_agent_links with
 * revoked_at is null) is not this module's business at all: it contributes
 * under its own name and stays at ENTRY_RANK forever, which is correct — no
 * human answers for it. Nothing here is even queried for such a contributor;
 * see maybeRecalcRankForContributor's early return.
 */

type RankTier = { rank: string; min_accepted: number; min_reviews: number };

const NEGATIVE_SIGNAL = (RANK_THRESHOLDS as any).negative_signal as {
  min_rejections: number;
  min_abandoned_claims: number;
};
// Ascending order — cabin-boy first, admiral last — exactly as
// vocab/rank_thresholds.json lists them and as contributors_rank_check
// (the DB enum) orders them. The scale is monotonic by construction: every
// tier's minimums are >= the previous tier's, so meeting a higher tier's bar
// always meets every lower tier's too.
const TIERS = (RANK_THRESHOLDS as any).ranks as RankTier[];
export const ENTRY_RANK = TIERS[0].rank;

export type AggregateSignal = {
  accepted: number;
  rejections: number;
  reviewsGiven: number;
  abandonedClaims: number;
};

/**
 * The pure rule: an aggregate history in, a rank out. No I/O, so this is the
 * part a test can pin directly, the same way lib/agentCapabilities.ts's
 * quotaForRank() is pinned.
 *
 * "Standing buys capacity, never exemption" (Carta 7, and
 * reviewer_has_negative_signal's own docstring): a negative pattern caps the
 * rank at ENTRY_RANK regardless of volume, checked before any tier is
 * considered, so no amount of accepted work or reviewing can outrun it.
 */
export function rankForSignal(signal: AggregateSignal): string {
  const { accepted, rejections, reviewsGiven, abandonedClaims } = signal;
  const negative =
    (rejections >= NEGATIVE_SIGNAL.min_rejections && rejections > accepted) ||
    abandonedClaims >= NEGATIVE_SIGNAL.min_abandoned_claims;
  if (negative) return ENTRY_RANK;

  let rank = ENTRY_RANK;
  for (const tier of TIERS) {
    if (accepted >= tier.min_accepted || reviewsGiven >= tier.min_reviews) rank = tier.rank;
  }
  return rank;
}

/**
 * Every contributor_id reachable from a human_principal_id through an ACTIVE
 * human_agent_links row — the traversal the design settled on: agent ->
 * agent_accounts -> contributor. A human's own directly-owned contributor
 * row (contributors.human_principal_id set with no agent_accounts row of its
 * own — see lib/humanContributor.ts) is deliberately not walked here: it is
 * a separate identity the design did not fold into this traversal, and nothing
 * in this module invents a second path to it.
 */
async function linkedContributorIds(humanPrincipalId: number): Promise<number[]> {
  const links = await sb("GET",
    `human_agent_links?human_principal_id=eq.${humanPrincipalId}&revoked_at=is.null&select=agent_account_id`);
  if (!links.length) return [];
  const agentAccountIds: number[] = [...new Set<number>(links.map((l: any) => Number(l.agent_account_id)))];
  const accounts = await sb("GET",
    `agent_accounts?id=in.(${agentAccountIds.join(",")})&select=contributor_id`);
  return [...new Set<number>(accounts.map((a: any) => Number(a.contributor_id)))];
}

/**
 * The aggregate itself, summed across every linked contributor rather than
 * read fresh per one: reuses contributor_standing (approvals, rejections,
 * reviews_given, abandoned_claims), the same view app/api/desk/users/route.ts
 * already reads for a contributor's own standing — no new counting query,
 * only a sum across the rows that view already knows how to produce.
 */
async function aggregateSignal(contributorIds: number[]): Promise<AggregateSignal> {
  const rows = await sb("GET",
    `contributor_standing?id=in.(${contributorIds.join(",")})` +
    `&select=id,approvals,rejections,reviews_given,abandoned_claims`);
  const sum = (key: string) => rows.reduce((total: number, r: any) => total + Number(r[key] ?? 0), 0);
  return {
    accepted: sum("approvals"),
    rejections: sum("rejections"),
    reviewsGiven: sum("reviews_given"),
    abandonedClaims: sum("abandoned_claims"),
  };
}

export type RecalcResult = { rank: string; contributorIds: number[]; signal: AggregateSignal };

/**
 * Recompute and WRITE a human's rank across every contributor it currently
 * has linked. Called only at the trigger points that change what the
 * aggregate could be — a link created/reactivated, a verdict recorded, a
 * review recorded — never per request: contributors.rank stays a stable
 * value the quota checks (lib/agentCapabilities.ts's quotaForRank) can keep
 * reading directly, exactly as they do today.
 *
 * Returns null, and touches nothing, when the human has no active linked
 * contributor at all — this is the guarantee that an unlinked agent's volume
 * never even causes a calculation, let alone a promotion.
 */
export async function recalcHumanRank(humanPrincipalId: number): Promise<RecalcResult | null> {
  const contributorIds = await linkedContributorIds(humanPrincipalId);
  if (!contributorIds.length) return null;

  const signal = await aggregateSignal(contributorIds);
  const rank = rankForSignal(signal);

  await sb("PATCH", `contributors?id=in.(${contributorIds.join(",")})`, { rank });
  await sb("POST", "audit_log", {
    submission_id: null,
    actor: "rank-promotion",
    action: "human-rank-recalc",
    verdict: null,
    findings: [["INFO", 0,
      `human #${humanPrincipalId}: rank recalculated to '${rank}' across contributor(s) ` +
      `${contributorIds.join(", ")} — accepted=${signal.accepted} rejections=${signal.rejections} ` +
      `reviews_given=${signal.reviewsGiven} abandoned_claims=${signal.abandonedClaims}`]],
    carta_version: CARTA_VERSION,
  });

  return { rank, contributorIds, signal };
}

/**
 * The entry point every write-side trigger calls: given a contributor who
 * just did something (submitted, was ruled on, reviewed), find the human(s)
 * it is linked to, if any, and recalculate their rank. A contributor with no
 * agent_accounts row, or an agent_account with no active human_agent_links
 * row, returns immediately — no query beyond the two that establish that,
 * and no rank is touched. Errors are logged and swallowed: rank promotion is
 * a side effect of the event that triggered it, and must never be the reason
 * a submission's verdict or a review fails to record.
 */
export async function maybeRecalcRankForContributor(contributorId: number): Promise<void> {
  try {
    const accounts = await sb("GET",
      `agent_accounts?contributor_id=eq.${contributorId}&select=id&limit=1`);
    if (!accounts.length) return;
    const links = await sb("GET",
      `human_agent_links?agent_account_id=eq.${accounts[0].id}&revoked_at=is.null&select=human_principal_id`);
    const humanIds: number[] = [...new Set<number>(links.map((l: any) => Number(l.human_principal_id)))];
    for (const humanId of humanIds) await recalcHumanRank(humanId);
  } catch (e) {
    console.error(`rank promotion: recalc for contributor #${contributorId} failed`, e);
  }
}
