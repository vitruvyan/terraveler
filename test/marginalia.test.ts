import { test } from "node:test";
import assert from "node:assert/strict";
import { notesForVoyage } from "../lib/marginalia";
import type { EvidenceBasis } from "../lib/evidence";
import type { Navigator, Voyage, Waypoint } from "../lib/types";

const nav = { id: 1, name: "James Cook" } as Navigator;

function voyage(basis: EvidenceBasis, extra: Partial<Voyage> = {}): Voyage {
  return {
    id: 1,
    navigator_id: 1,
    slug: "t",
    title: "T",
    evidence_basis: basis,
    what_was_lost: "The archive burned in 1755.",
    ...extra,
  } as Voyage;
}

function wp(seq: number, o: Partial<Waypoint> = {}): Waypoint {
  return {
    seq,
    place_historical: `P${seq}`,
    confidence: "certain",
    diary_excerpt: "a quote",
    ...o,
  } as Waypoint;
}

const flat = (m: Map<number, ReturnType<typeof notesForVoyage> extends Map<number, infer T> ? T : never>) =>
  [...m.values()].flat();

test("an explanation that holds for the whole voyage is asked once, not on every stage", () => {
  // The bug this pins: "Why is this position reconstructed?" fired on 23 of
  // Cook's stages with an identical answer each time.
  const wps = Array.from({ length: 25 }, (_, i) =>
    wp(i + 1, { confidence: "reconstructed" }),
  );
  const notes = flat(notesForVoyage(voyage("contemporary-journal"), nav, wps));
  const conf = notes.filter((n) => n.question.startsWith("Why is this position"));
  assert.equal(conf.length, 1, "one airing per confidence level, not one per stage");
});

test("approximate and reconstructed each get their own airing — the reasons differ", () => {
  const wps = [
    wp(1, { confidence: "approximate" }),
    wp(2, { confidence: "approximate" }),
    wp(3, { confidence: "reconstructed" }),
  ];
  const notes = flat(notesForVoyage(voyage("contemporary-journal"), nav, wps));
  const qs = notes.map((n) => n.question);
  assert.deepEqual(qs, ["Why is this position approximate?", "Why is this position reconstructed?"]);
});

test("an empty stage is asked about on every stage — each is a different passage to find", () => {
  const wps = [wp(1, { diary_excerpt: null }), wp(2, { diary_excerpt: null })];
  const notes = flat(notesForVoyage(voyage("contemporary-journal"), nav, wps));
  assert.equal(notes.filter((n) => n.contribute).length, 2);
});

test("only a journal-tier voyage attributes the surviving record to the traveller", () => {
  // Cortés is read through Bernal Díaz; Columbus survives only as Las Casas's
  // abstract. "Columbus's own account exists" is the overstatement that
  // evidence_basis was added to prevent — and an earlier version said it.
  const journal = flat(
    notesForVoyage(voyage("contemporary-journal"), nav, [wp(1, { diary_excerpt: null })]),
  );
  assert.match(journal[0].answer, /James Cook's own account exists/);

  const testimony = flat(
    notesForVoyage(voyage("contemporary-testimony"), nav, [wp(1, { diary_excerpt: null })]),
  );
  assert.doesNotMatch(
    testimony[0].answer,
    /James Cook's own account/,
    "testimony must not be attributed to the traveller",
  );
  assert.match(testimony[0].answer, /The surviving account/);
});

test("a voyage whose records were destroyed is never asked to go looking", () => {
  for (const basis of ["later-chronicle", "reconstructed"] as const) {
    const notes = flat(notesForVoyage(voyage(basis), nav, [wp(1, { diary_excerpt: null })]));
    assert.equal(notes[0].contribute, undefined, basis);
    assert.match(notes[0].question, /Why does nothing survive/);
    assert.match(notes[0].answer, /archive burned/, "the answer is what was lost");
  }
});

test("a probe is not described as having a diary anyone could find", () => {
  const probe = voyage("contemporary-journal", { kind: "space" });
  const notes = flat(notesForVoyage(probe, nav, [wp(1, { diary_excerpt: null, confidence: "approximate" })]));
  const empty = notes.find((n) => n.contribute);
  assert.ok(empty);
  assert.match(empty.answer, /mission record/);
  assert.doesNotMatch(empty.answer, /James Cook's own account/);
  const conf = notes.find((n) => n.question.startsWith("Why is this position"));
  assert.match(conf!.answer, /trajectory data/);
  assert.doesNotMatch(conf!.answer, /chronometer/, "no age-of-sail longitude story on a probe");
});

test("a fully documented, certain voyage gets no marginalia at all", () => {
  // Apollo 11: every stage quoted, every position certain. The layer should
  // disappear rather than manufacture something to say.
  const notes = flat(notesForVoyage(voyage("contemporary-journal"), nav, [wp(1), wp(2), wp(3)]));
  assert.deepEqual(notes, []);
});

test("no more than two notes on a stage, and never two dead ends at once", () => {
  const wps = [wp(1, { diary_excerpt: null, confidence: "reconstructed", date_note: "disputed" })];
  const notes = notesForVoyage(voyage("later-chronicle"), nav, wps).get(1) ?? [];
  assert.ok(notes.length <= 2, `got ${notes.length}`);
  assert.ok(notes.filter((n) => n.kind === "gap").length <= 1);
});

test("every note carries a citation", () => {
  const wps = [wp(1, { diary_excerpt: null, confidence: "approximate" }), wp(2)];
  for (const n of flat(notesForVoyage(voyage("contemporary-journal"), nav, wps))) {
    assert.ok(n.citation.trim().length > 0, n.question);
  }
});
