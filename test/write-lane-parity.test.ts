import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TOOL_SCOPE, LEGACY_ONLY_TOOLS, RANK_QUOTA } from "../lib/agentCapabilities";

/**
 * Phase 5 write-authority audit: cross-lane contract tests.
 *
 * app/api/mcp/route.ts (legacy 2025 protocol + handle/api_key compatibility)
 * and app/api/agent/write/route.ts (the live path for every modern OAuth
 * agent, proxied to by middleware.ts's modernWrite()) are two independent
 * implementations of the same mutation policy. They are allowed to differ in
 * TRANSPORT — how a caller authenticates, how a response is shaped for an
 * older client — and must not differ in POLICY: what a self-review is, when
 * an appeal is spent, how many reviews advance a draft, what a rank may do
 * per day.
 *
 * The goal here is not byte-identical responses (see the module's own
 * audit report for why: the legacy lane's error text is often more
 * elaborate, which is a UX difference, not a policy one). The goal is that
 * the same input produces the same DECISION on both lanes.
 */

const mcp = () => readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
const write = () => readFile(new URL("../app/api/agent/write/route.ts", import.meta.url), "utf8");

test("both lanes block a reviewer from reviewing their own draft", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  assert.match(a, /contributor_id === a\.ok!\.id\)\s*return "ERROR: you cannot review your own draft/);
  assert.match(b, /contributor_id === c\.id\)\s*return "ERROR: you cannot review your own draft/);
});

test("both lanes require exactly REVIEWS_TO_ADVANCE reviews before a draft reaches the desk, and agree on the number", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  const na = a.match(/const REVIEWS_TO_ADVANCE = (\d+);/);
  const nb = b.match(/const REVIEWS_TO_ADVANCE = (\d+);/);
  assert.ok(na && nb, "REVIEWS_TO_ADVANCE not found in one of the two lanes");
  assert.equal(na![1], nb![1], "the two lanes must require the same number of reviews to advance a draft");
});

test("both lanes refuse a second appeal on the same submission", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  assert.match(a, /audit_log\?submission_id=eq\.\$\{id\}&action=eq\.appeal/);
  assert.match(b, /audit_log\?submission_id=eq\.\$\{id\}&action=eq\.appeal/);
});

test("both lanes let only the submission's own author appeal it", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  assert.match(a, /s\.contributor_id !== a\.ok!\.id\)\s*\n\s*return "ERROR: a submission may be appealed only by the contributor/);
  assert.match(b, /rows\[0\]\.contributor_id !== c\.id\)\s*return "ERROR: policy forbids appealing another contributor's submission\."/);
});

test("both lanes refuse an appeal on any status but a refused verdict — changes-requested included", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  // mcp/route.ts calls this out with a dedicated, more explicit message;
  // write/route.ts folds it into the generic "not appealable" check. Both
  // are required to actually refuse it -- see the two assertions below --
  // the wording difference is exactly the kind of thing this audit
  // classifies INTENTIONAL_COMPATIBILITY_DIFFERENCE, not drift.
  assert.match(a, /s\.status === "changes-requested"\)/, "mcp/route.ts's dedicated changes-requested guard went missing");
  const appealable = /\["curator-rejected", "rejected"\]/;
  assert.match(a, appealable);
  assert.match(b, appealable);
});

test("both lanes read the same rank quota table (by value, not by a second literal)", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  const importsFrom = (src: string, name: string) =>
    new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/lib/agentCapabilities"`).test(src);
  assert.ok(importsFrom(a, "RANK_QUOTA"), "app/api/mcp/route.ts must import RANK_QUOTA");
  assert.ok(importsFrom(b, "RANK_QUOTA"), "app/api/agent/write/route.ts must import RANK_QUOTA");
  // Both derive their own local shape from the one import rather than
  // retyping numbers -- AUTHOR_QUOTAS maps straight through, QUOTA renames
  // fields. Neither may declare a rank's numbers as a fresh literal.
  for (const rank of Object.keys(RANK_QUOTA)) {
    assert.equal(new RegExp(`"?${rank}"?:\\s*\\{\\s*submissions?_?[Pp]er_?[Dd]ay:\\s*\\d+`).test(a), false,
      `app/api/mcp/route.ts must not re-literal the ${rank} quota`);
  }
});

test("register and rotate_key stay legacy-only on both sides of the boundary", async () => {
  const w = await write();
  assert.deepEqual([...LEGACY_ONLY_TOOLS].sort(), ["register", "rotate_key"]);
  // The OAuth-native write route must never gain a case for either — TOOL_SCOPE
  // has no entry for them, so POST() 400s before callModern() is ever reached,
  // and callModern() itself must not independently invent a path to them.
  assert.equal("register" in TOOL_SCOPE, false);
  assert.equal("rotate_key" in TOOL_SCOPE, false);
  assert.equal(w.includes('case "register"'), false,
    "the OAuth-native write route must not grow its own register handler");
  assert.equal(w.includes('case "rotate_key"'), false,
    "the OAuth-native write route must not grow its own rotate_key handler");
});

test("claim TTL agrees between the lane that reaps stale claims and the one that also claims them", async () => {
  const [a, b] = await Promise.all([mcp(), write()]);
  const ta = a.match(/const CLAIM_TTL_DAYS = (\d+);/);
  const tb = b.match(/const CLAIM_TTL_DAYS = (\d+);/);
  assert.ok(ta && tb);
  assert.equal(ta![1], tb![1]);
});
