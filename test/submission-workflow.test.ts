import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

function section(route: string, marker: string, endMarker = '\n    case "') {
  const at = route.indexOf(marker);
  assert.ok(at >= 0, `marker not found: ${marker}`);
  const end = route.indexOf(endMarker, at + marker.length);
  return route.slice(at, end >= 0 ? end : at + 6000);
}

test("get_submission_status resolves identity the same way every write tool does", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const status = section(route, 'case "get_submission_status"');
  assert.match(status, /authenticate\(args, bearer\)/,
    "identity for the eligibility projection must come from the same helper claim_gap/submit_review/appeal use");
});

test("submit_review eligibility in get_submission_status mirrors submit_review's own guards", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const status = section(route, 'case "get_submission_status"');
  const submitReview = section(route, 'case "submit_review"');
  // Same three conditions, in both places: open for review, not the author,
  // not already reviewed by this reviewer.
  assert.match(status, /st !== "peer-review"/);
  assert.match(submitReview, /status !== "peer-review"/);
  assert.match(status, /isAuthor/);
  assert.match(submitReview, /contributor_id === a\.ok!\.id/);
  assert.match(status, /reviews\?submission_id=eq\.\$\{s\[0\]\.id\}&reviewer_id=eq\.\$\{me\.id\}/);
  assert.match(submitReview, /reviews\?submission_id=eq\.\$\{sid\}&reviewer_id=eq\.\$\{a\.ok!\.id\}/);
  assert.match(status, /reviewsPerDay\(me\.rank\)/);
  assert.match(submitReview, /reviewsPerDay\(a\.ok!\.rank\)/);
});

test("appeal eligibility in get_submission_status mirrors appeal's own authorship and status guards", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const status = section(route, 'case "get_submission_status"');
  const appealCase = section(route, 'case "appeal"');
  assert.match(appealCase, /s\.contributor_id !== a\.ok!\.id/,
    "appeal itself must remain author-only");
  assert.match(status, /me != null && !isAuthor/,
    "get_submission_status must deny appeal eligibility to an authenticated non-author, not just report status");
  assert.match(status, /\["curator-rejected", "rejected"\]\.includes\(st\)/);
  assert.match(appealCase, /appealable = \["curator-rejected", "rejected"\]/);
});

test("an anonymous caller keeps the same status-only appeal answer as before (no regression in public transparency)", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const status = section(route, 'case "get_submission_status"');
  assert.match(status, /appealAvailable = !appealBlocked\.appeal && \(me == null \|\| isAuthor\)/,
    "an unauthenticated observer must not be blocked by an authorship check it cannot satisfy");
});

test("workflow.allowed_actions never includes an action get_submission_status itself marked blocked", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const status = section(route, 'case "get_submission_status"');
  assert.match(status, /if \(!reviewBlocked\) allowed_actions\.push\("submit_review"\); else blocked_actions\.submit_review = reviewBlocked;/);
  assert.match(status, /if \(appealAvailable\) allowed_actions\.push\("appeal"\); else if \(appealBlocked\.appeal\) blocked_actions\.appeal = appealBlocked\.appeal;/);
});

test("curator-rejected and changes-requested point at submit_draft again, not an in-place resubmit", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const status = section(route, 'case "get_submission_status"');
  assert.match(status, /curator-rejected.*call submit_draft again/s);
  assert.match(status, /changes-requested.*call submit_draft again/s);
});
