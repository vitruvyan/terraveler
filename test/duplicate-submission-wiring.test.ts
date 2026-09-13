import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

/**
 * Structural pins for Phase 5's duplicate-submission integrity. The live
 * behaviour is verified against the real database (see the session's live
 * results); these exist so the wiring cannot silently regress — e.g. a
 * future edit to recordSubmission() that stops computing or passing the
 * fingerprint would break none of the existing tests, only this one.
 */

test("the live OAuth write path computes a fingerprint before either insert path", async () => {
  const route = await read("../app/api/agent/write/route.ts");
  assert.match(route, /import \{ DuplicateSubmissionError, contentFingerprint, isUniqueViolation \} from "@\/lib\/contentFingerprint"/);
  const fnStart = route.indexOf("async function recordSubmission(c: Contributor");
  assert.ok(fnStart > 0, "recordSubmission not found");
  const fn = route.slice(fnStart, route.indexOf("\nasync function callModern"));
  const fpAt = fn.indexOf("contentFingerprint(o.type, o.payload)");
  assert.ok(fpAt > 0, "fingerprint must be computed inside recordSubmission");
  const rpcAt = fn.indexOf("optionalRpc(\"mcp_record_submission_oauth\"");
  const fallbackInsertAt = fn.indexOf("sb(\"POST\", \"submissions\"");
  assert.ok(fpAt < rpcAt && fpAt < fallbackInsertAt,
    "the fingerprint must be computed once, before either the RPC or the manual insert, so both paths agree");
  assert.match(fn, /p_content_fingerprint:\s*fp/, "the RPC must receive the fingerprint");
  assert.match(fn, /content_fingerprint:\s*fp/, "the manual insert must carry the fingerprint too");
});

test("a unique-violation on the manual insert becomes a DUPLICATE_SUBMISSION error, not an unhandled throw", async () => {
  const route = await read("../app/api/agent/write/route.ts");
  const fnStart = route.indexOf("async function recordSubmission(c: Contributor");
  const fn = route.slice(fnStart, route.indexOf("\nasync function callModern"));
  assert.match(fn, /isUniqueViolation\(e\)/);
  assert.match(fn, /new DuplicateSubmissionError\(/);
});

test("cross-author duplicates are surfaced, never used to block the write", async () => {
  const route = await read("../app/api/agent/write/route.ts");
  assert.match(route, /async function crossAuthorDuplicates/);
  const fnStart = route.indexOf("async function crossAuthorDuplicates");
  const fn = route.slice(fnStart, route.indexOf("\nasync function recordSubmission"));
  assert.match(fn, /contributor_id=neq\./, "cross-author detection must exclude the caller's own submissions");
  // Every tool response must echo cross_author_duplicates from the successful
  // result, never gate on it -- there is no branch anywhere that turns a
  // non-empty cross_author_duplicates into an ERROR return.
  for (const tool of ["propose_idea", "submit_draft", "suggest_feature", "suggest_content"]) {
    const caseStart = route.indexOf(`case "${tool}":`);
    assert.ok(caseStart > 0, `${tool} case not found`);
    const nextCase = route.indexOf("\n    case ", caseStart + 10);
    const block = route.slice(caseStart, nextCase > 0 ? nextCase : caseStart + 2000);
    assert.match(block, /cross_author_duplicates:\s*one\.cross_author_duplicates/,
      `${tool} must echo cross_author_duplicates in its response`);
  }
});

test("the legacy lane gets the identical duplicate guard, not a second implementation", async () => {
  const route = await read("../app/api/mcp/route.ts");
  assert.match(route, /import \{ DuplicateSubmissionError, contentFingerprint, isUniqueViolation \} from "@\/lib\/contentFingerprint"/);
  assert.match(route, /async function insertSubmission/);
  assert.match(route, /async function crossAuthorDuplicates/);
  assert.match(route, /p_content_fingerprint:\s*o\.contentFingerprint/,
    "the legacy RPC call must also carry a fingerprint");
});

test("the migration's unique index excludes rejected and curator-rejected, so a past rejection cannot permanently lock a resubmission", async () => {
  const migration = await read("../supabase/submission_content_fingerprint.sql");
  assert.match(migration, /create unique index submissions_author_fingerprint_key/);
  assert.match(migration, /where content_fingerprint is not null\s*\n\s*and status not in \('rejected', 'curator-rejected'\)/);
});

test("both duplicate-guard RPCs share one exception-driven shape, not a pre-check-then-insert race", async () => {
  const sql = await read("../supabase/mcp_record_submission_duplicate_guard.sql");
  const bodies = sql.split("create or replace function");
  assert.equal(bodies.length - 1, 2, "expected exactly two functions in this migration");
  for (const body of bodies.slice(1)) {
    assert.match(body, /exception when unique_violation then/,
      "duplicate detection must be the database catching a real constraint violation, not an application-level SELECT-then-INSERT that a concurrent request can race");
    assert.match(body, /DUPLICATE_SUBMISSION/);
    assert.match(body, /cross_author_duplicates/);
  }
});
