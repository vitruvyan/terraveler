import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_ORDER,
  evidenceBasisOf,
  evidenceCopy,
  isEvidenceBasis,
  noExcerptCopy,
} from "../lib/evidence";
import type { Voyage } from "../lib/types";

/**
 * The atlas's first tests, and they guard the one thing here that is an
 * editorial promise rather than a rendering detail.
 *
 * A stage with no excerpt used to read the same on every voyage: "help us find
 * one". On Cook that is true. On a voyage whose records burned there is
 * nothing to find, and repeating the invitation on every stage would be a
 * small falsehood told at scale. None of the six published voyages is yet a
 * `later-chronicle`, so this branch has no production coverage — which is
 * exactly why it is worth pinning down before one arrives.
 */

test("only voyages with a surviving record invite the reader to go looking", () => {
  for (const basis of ["contemporary-journal", "contemporary-testimony"] as const) {
    assert.equal(noExcerptCopy(basis).invitesContribution, true, basis);
  }
  for (const basis of ["later-chronicle", "reconstructed"] as const) {
    assert.equal(
      noExcerptCopy(basis).invitesContribution,
      false,
      `${basis} must not ask a reader to search for a document that does not exist`,
    );
  }
});

test("every tier has copy, and no sentence ends in punctuation the page appends", () => {
  for (const basis of EVIDENCE_ORDER) {
    const c = evidenceCopy(basis);
    assert.ok(c.label.length > 0, `${basis} label`);
    assert.ok(c.blurb.length > 20, `${basis} blurb`);
    // The log page appends "." or " — help us find one." itself.
    assert.ok(!/[.]$/.test(c.noExcerpt), `${basis} noExcerpt must not end in a full stop`);
  }
});

test("an unclassified voyage keeps the original wording rather than claiming a journal", () => {
  const gap = noExcerptCopy(null);
  assert.match(gap.text, /No verified journal excerpt/);
  assert.equal(gap.invitesContribution, true);
});

test("a value the database does not recognise is not trusted as a basis", () => {
  for (const bad of ["journal", "", "CONTEMPORARY-JOURNAL", null, undefined, 7]) {
    assert.equal(isEvidenceBasis(bad), false, JSON.stringify(bad));
    assert.equal(evidenceBasisOf({ evidence_basis: bad } as unknown as Voyage), null);
  }
  assert.equal(
    evidenceBasisOf({ evidence_basis: "later-chronicle" } as unknown as Voyage),
    "later-chronicle",
  );
});

test("the tiers match the check constraint in supabase/evidence_basis.sql", async () => {
  const sql = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../supabase/evidence_basis.sql", import.meta.url), "utf8"),
  );
  for (const basis of EVIDENCE_ORDER) {
    assert.ok(sql.includes(`'${basis}'`), `${basis} missing from the migration's check constraint`);
  }
});
