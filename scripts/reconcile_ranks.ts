#!/usr/bin/env tsx
/**
 * The Purser's nightly reconciliation (docs/SHIPS_OFFICERS.md §4.3, A1) —
 * CLI entry point. See lib/rankPromotion.ts::reconcileAllHumanRanks for
 * what this actually does and why; app/api/cron/reconcile-ranks/route.ts
 * is the other entry point (Vercel Cron), sharing the same function so the
 * two can't drift on what "reconcile" means.
 *
 * Usage: npx tsx scripts/reconcile_ranks.ts
 * Needs POSTGREST_URL / POSTGREST_SERVICE_KEY in the environment — the
 * Vercel app's own env, not the VPS data-plane .env. Run this from
 * wherever that's configured (a developer machine, CI, or via the Vercel
 * Cron route instead of this script on a host that doesn't have it).
 */
import { reconcileAllHumanRanks } from "@/lib/rankPromotion";

async function main() {
  const summary = await reconcileAllHumanRanks();
  console.log(`purser reconciliation: ${summary.checked} human(s) with an active agent link`);
  for (const r of summary.results) {
    console.log(`  human #${r.humanPrincipalId}: rank='${r.rank}' ` +
      `accepted=${r.signal.accepted} rejections=${r.signal.rejections} ` +
      `reviews_given=${r.signal.reviewsGiven} abandoned_claims=${r.signal.abandonedClaims}`);
  }
  for (const e of summary.errors) {
    console.error(`  human #${e.humanPrincipalId}: reconciliation failed — ${e.message}`);
  }
  console.log(`purser reconciliation: done, ${summary.failed} failure(s)`);
  if (summary.failed) process.exitCode = 1;
}

main();
