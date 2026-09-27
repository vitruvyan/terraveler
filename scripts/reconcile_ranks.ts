#!/usr/bin/env tsx
/**
 * The Purser's nightly reconciliation (docs/SHIPS_OFFICERS.md §4.3, A1).
 *
 * recalcHumanRank() already runs synchronously at every trigger point that
 * changes what a human's aggregate could be — a verdict, a review, a link
 * created or reactivated (lib/rankPromotion.ts, wired into
 * lib/deskVerdict.ts and lib/agentIdentity.ts). This exists for the drift
 * those triggers cannot see by construction: a standing view definition
 * that changed after the fact, a link touched by something other than the
 * normal flow, or a trigger that failed and was swallowed (rank promotion
 * errors are logged and never allowed to fail the event that caused them —
 * see maybeRecalcRankForContributor's own docstring). It is a pure
 * recompute of already-derived state: safe to run as often as wanted, and
 * every run is its own audit_log row (actor 'rank-promotion'), so a
 * no-op night looks like a no-op night rather than silence.
 *
 * Usage: npx tsx scripts/reconcile_ranks.ts
 * Needs POSTGREST_URL / POSTGREST_SERVICE_KEY in the environment, same as
 * every other script that imports lib/deskAuth's sb().
 *
 * Not yet scheduled anywhere in this repo — add a nightly, off-peak
 * crontab/systemd-timer entry on the host that runs this.
 */
import { sb } from "@/lib/deskAuth";
import { recalcHumanRank } from "@/lib/rankPromotion";

async function main() {
  const links = await sb("GET",
    "human_agent_links?revoked_at=is.null&select=human_principal_id");
  const humanIds = [...new Set<number>(
    (links ?? []).map((l: any) => Number(l.human_principal_id)))];

  console.log(`purser reconciliation: ${humanIds.length} human(s) with an active agent link`);

  let failed = 0;
  for (const id of humanIds) {
    try {
      const result = await recalcHumanRank(id);
      if (result) {
        console.log(`  human #${id}: rank='${result.rank}' ` +
          `accepted=${result.signal.accepted} rejections=${result.signal.rejections} ` +
          `reviews_given=${result.signal.reviewsGiven} abandoned_claims=${result.signal.abandonedClaims}`);
      }
    } catch (e) {
      failed += 1;
      console.error(`  human #${id}: reconciliation failed`, e);
    }
  }

  console.log(`purser reconciliation: done, ${failed} failure(s)`);
  if (failed) process.exitCode = 1;
}

main();
