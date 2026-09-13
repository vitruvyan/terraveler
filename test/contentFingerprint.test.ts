import { test } from "node:test";
import assert from "node:assert/strict";
import { contentFingerprint, DuplicateSubmissionError, isUniqueViolation } from "../lib/contentFingerprint";

/**
 * Duplicate-submission integrity (Phase 5).
 *
 * The fingerprint is the whole mechanism: everything downstream (the
 * unique index, the RPCs, the TS fallbacks) just asks Postgres "does this
 * value already exist". What matters here is narrower and easier to get
 * wrong silently — that the SAME content always produces the SAME value
 * regardless of idempotency key, request id, model, Carta version or
 * whitespace, and that content which actually changed does not.
 */

test("identical content fingerprints identically", () => {
  const a = contentFingerprint("idea", { title: "Add Magellan", description: "A voyage.", kind: null });
  const b = contentFingerprint("idea", { title: "Add Magellan", description: "A voyage.", kind: null });
  assert.equal(a, b);
});

test("key order does not change the fingerprint", () => {
  const a = contentFingerprint("idea", { title: "T", description: "D", kind: null });
  const b = contentFingerprint("idea", { kind: null, description: "D", title: "T" });
  assert.equal(a, b);
});

test("whitespace-only differences fingerprint identically", () => {
  const a = contentFingerprint("idea", { title: "Add  Magellan", description: "A   voyage.\n\nMore.", kind: null });
  const b = contentFingerprint("idea", { title: " Add Magellan ", description: "A voyage. More.", kind: null });
  assert.equal(a, b);
});

test("real content changes the fingerprint", () => {
  const a = contentFingerprint("idea", { title: "Add Magellan", description: "A voyage.", kind: null });
  const b = contentFingerprint("idea", { title: "Add Magellan", description: "A different voyage.", kind: null });
  assert.notEqual(a, b);
});

test("ideator, scribe_model, carta_version and request_id never affect the fingerprint", () => {
  const base = contentFingerprint("feature-suggestion",
    { meta: { carta_version: "0.7" }, title: "T", description: "D", area: null });
  const withProvenance = contentFingerprint("feature-suggestion", {
    meta: { ideator: "someone", scribe_model: "claude-opus-5", carta_version: "0.8", request_id: "abc-123" },
    title: "T", description: "D", area: null,
  });
  assert.equal(base, withProvenance,
    "two submissions differing only in who/what/when/under-which-Carta-version drafted them must fingerprint the same");
});

test("submission type segregates the fingerprint space", () => {
  const payload = { title: "T", description: "D" };
  assert.notEqual(contentFingerprint("idea", payload), contentFingerprint("feature-suggestion", payload),
    "an idea and a feature-suggestion with the same-shaped payload must never collide");
});

test("nested payload fields are canonicalised at every depth", () => {
  const a = contentFingerprint("draft", { meta: { type: "voyage" }, voyage: { title: "X", waypoints: [{ seq: 1 }] } });
  const b = contentFingerprint("draft", { voyage: { waypoints: [{ seq: 1 }], title: "X" }, meta: { type: "voyage" } });
  assert.equal(a, b);
});

test("DuplicateSubmissionError names the existing submission when known", () => {
  const withId = new DuplicateSubmissionError(42);
  assert.match(withId.message, /^DUPLICATE_SUBMISSION:/);
  assert.match(withId.message, /#42\b/);
  const withoutId = new DuplicateSubmissionError(null);
  assert.match(withoutId.message, /^DUPLICATE_SUBMISSION:/);
});

test("isUniqueViolation recognises Postgres's 23505 and nothing else", () => {
  assert.equal(isUniqueViolation(new Error("backend 409: {\"code\":\"23505\",\"message\":\"duplicate key\"}")), true);
  assert.equal(isUniqueViolation(new Error("backend 400: {\"code\":\"22P02\"}")), false);
  assert.equal(isUniqueViolation(new Error("network timeout")), false);
});
