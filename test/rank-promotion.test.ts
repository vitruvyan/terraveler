import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ENTRY_RANK, rankForSignal } from "../lib/rankPromotion";
import RANK_THRESHOLDS from "../vocab/rank_thresholds.json";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("ENTRY_RANK is cabin-boy, matching scripts/desk_checks.py's ENTRY_RANK and contributors' DB default", () => {
  assert.equal(ENTRY_RANK, "cabin-boy");
});

test("the 5-level scale is ordered and strictly increasing (a higher tier's minimums are never lower)", () => {
  const ranks = RANK_THRESHOLDS.ranks.map((t) => t.rank);
  assert.deepEqual(ranks, ["cabin-boy", "deckhand", "navigator", "captain", "admiral"]);
  for (let i = 1; i < RANK_THRESHOLDS.ranks.length; i++) {
    const prev = RANK_THRESHOLDS.ranks[i - 1], cur = RANK_THRESHOLDS.ranks[i];
    assert.ok(cur.min_accepted > prev.min_accepted, `${cur.rank}.min_accepted must exceed ${prev.rank}'s`);
    assert.ok(cur.min_reviews > prev.min_reviews, `${cur.rank}.min_reviews must exceed ${prev.rank}'s`);
  }
});

test("a human with zero history stays cabin-boy", () => {
  assert.equal(
    rankForSignal({ accepted: 0, rejections: 0, reviewsGiven: 0, abandonedClaims: 0 }),
    "cabin-boy",
  );
});

// Real production numbers (see the PR description for how these were read):
// human #1 (dbaldoni@gmail.com)'s one linked contributor today, 'claude-desktop'
// (contributor #9), stands at 3 accepted, 0 rejections, 1 review given, 0
// abandoned claims per contributor_standing as of this branch.
test("real data: human #1's aggregate (3 accepted, 0 rejections, 1 review, 0 abandoned) reaches deckhand", () => {
  assert.equal(
    rankForSignal({ accepted: 3, rejections: 0, reviewsGiven: 1, abandonedClaims: 0 }),
    "deckhand",
  );
});

test("deckhand's bar mirrors scripts/desk_checks.py's independent-trust anchors exactly (1 accepted OR 3 reviews)", () => {
  const deckhand = RANK_THRESHOLDS.ranks.find((t) => t.rank === "deckhand")!;
  assert.equal(deckhand.min_accepted, 1, "mirrors MIN_ACCEPTED_SUBMISSIONS_FOR_TRUST");
  assert.equal(deckhand.min_reviews, 3, "mirrors SUSPICIOUS_REVIEWER_PRIOR_REVIEWS");
  assert.equal(rankForSignal({ accepted: 1, rejections: 0, reviewsGiven: 0, abandonedClaims: 0 }), "deckhand");
  assert.equal(rankForSignal({ accepted: 0, rejections: 0, reviewsGiven: 3, abandonedClaims: 0 }), "deckhand");
  assert.equal(rankForSignal({ accepted: 0, rejections: 0, reviewsGiven: 2, abandonedClaims: 0 }), "cabin-boy");
});

test("volume alone reaches the higher tiers", () => {
  assert.equal(rankForSignal({ accepted: 5, rejections: 0, reviewsGiven: 0, abandonedClaims: 0 }), "navigator");
  assert.equal(rankForSignal({ accepted: 15, rejections: 0, reviewsGiven: 0, abandonedClaims: 0 }), "captain");
  assert.equal(rankForSignal({ accepted: 40, rejections: 0, reviewsGiven: 0, abandonedClaims: 0 }), "admiral");
  assert.equal(rankForSignal({ accepted: 0, rejections: 0, reviewsGiven: 75, abandonedClaims: 0 }), "admiral");
});

// "Standing buys capacity, never exemption" — a negative pattern caps the
// rank at cabin-boy no matter how much volume comes with it.
test("a negative pattern (rejections >= 3 and > accepted) caps rank at cabin-boy despite high volume", () => {
  assert.equal(
    rankForSignal({ accepted: 30, rejections: 40, reviewsGiven: 60, abandonedClaims: 0 }),
    "cabin-boy",
  );
});

test("rejections alone, without outnumbering accepted work, do not trigger the cap", () => {
  // 3 rejections but also 10 accepted: rejections (3) is not > accepted (10).
  assert.equal(
    rankForSignal({ accepted: 10, rejections: 3, reviewsGiven: 0, abandonedClaims: 0 }),
    "navigator",
  );
});

test("abandoned claims alone (>= 3) cap the rank regardless of accepted volume", () => {
  assert.equal(
    rankForSignal({ accepted: 50, rejections: 0, reviewsGiven: 0, abandonedClaims: 3 }),
    "cabin-boy",
  );
});

test("the negative-signal floor mirrors scripts/desk_checks.py's MIN_REJECTIONS_FOR_NEGATIVE_SIGNAL / MIN_ABANDONED_CLAIMS_FOR_NEGATIVE_SIGNAL", async () => {
  const checks = await read("../scripts/desk_checks.py");
  assert.match(checks, /_VOCAB_RANK_THRESHOLDS\["negative_signal"\]\["min_rejections"\]/);
  assert.match(checks, /_VOCAB_RANK_THRESHOLDS\["negative_signal"\]\["min_abandoned_claims"\]/);
  assert.equal(RANK_THRESHOLDS.negative_signal.min_rejections, 3);
  assert.equal(RANK_THRESHOLDS.negative_signal.min_abandoned_claims, 3);
});

// --- wiring: every trigger point the design calls for actually calls in ---

test("linking (or reactivating) a human-agent association recalculates the human's rank", async () => {
  const src = await read("../lib/agentIdentity.ts");
  assert.match(src, /import \{ recalcHumanRank \} from "@\/lib\/rankPromotion";/);
  const fn = src.slice(src.indexOf("export async function linkHumanToAgent"));
  const occurrences = (fn.match(/recalcHumanRank\(humanPrincipalId\)/g) || []).length;
  assert.equal(occurrences, 2, "both the reactivate branch and the new-link branch must recalc");
});

test("a recorded verdict (approved/rejected, not changes-requested) recalculates the author's human's rank", async () => {
  const src = await read("../lib/deskVerdict.ts");
  assert.match(src, /import \{ maybeRecalcRankForContributor \} from "@\/lib\/rankPromotion";/);
  assert.match(src, /status === "approved" \|\| status === "rejected"/);
  assert.match(src, /maybeRecalcRankForContributor\(Number\(rows\[0\]\.contributor_id\)\)/);
});

test("every review-recording path (both submit_review lanes, RPC and fallback) recalculates the reviewer's human's rank", async () => {
  const mcpRoute = await read("../app/api/mcp/route.ts");
  const agentWrite = await read("../app/api/agent/write/route.ts");
  for (const src of [mcpRoute, agentWrite]) {
    assert.match(src, /import \{ maybeRecalcRankForContributor \} from "@\/lib\/rankPromotion";/);
  }
  // mcp/route.ts: RPC fast path (resolved by handle) and the TS fallback (a.ok!.id).
  const submitReview = mcpRoute.slice(
    mcpRoute.indexOf('case "submit_review"'),
    mcpRoute.indexOf('case "get_submission_status"'),
  );
  assert.match(submitReview, /maybeRecalcRankForContributor\(Number\(reviewer\[0\]\.id\)\)/);
  assert.match(submitReview, /maybeRecalcRankForContributor\(a\.ok!\.id\)/);
  // agent/write/route.ts: OAuth RPC path and the TS fallback (c.id known directly in both).
  const occurrences = (agentWrite.match(/maybeRecalcRankForContributor\(c\.id\)/g) || []).length;
  assert.equal(occurrences, 2, "both the OAuth RPC path and the fallback insert path must recalc");
});

test("an agent with no linked human is never even queried — maybeRecalcRankForContributor returns before any human lookup", async () => {
  const src = await read("../lib/rankPromotion.ts");
  const fn = src.slice(src.indexOf("export async function maybeRecalcRankForContributor"));
  const agentLookup = fn.indexOf("agent_accounts?contributor_id=eq.");
  const earlyReturn = fn.indexOf("if (!accounts.length) return;");
  const humanLookup = fn.indexOf("human_agent_links?agent_account_id=eq.");
  assert.ok(agentLookup >= 0 && earlyReturn > agentLookup && humanLookup > earlyReturn,
    "must check for an agent_accounts row and return before ever querying human_agent_links");
});

test("recalcHumanRank never writes when the human has no active linked contributor", async () => {
  const src = await read("../lib/rankPromotion.ts");
  const fn = src.slice(src.indexOf("export async function recalcHumanRank"));
  const guard = fn.indexOf("if (!contributorIds.length) return null;");
  const write = fn.indexOf('sb("PATCH"');
  assert.ok(guard >= 0 && write > guard, "the empty-contributor guard must precede the write");
});

test("set-rank, the manual editor override, is untouched", async () => {
  const src = await read("../app/api/desk/users/route.ts");
  assert.match(src, /case "set-rank":/);
  assert.doesNotMatch(src, /rankPromotion/, "the manual desk override must not be wired to the automatic calculator");
});
