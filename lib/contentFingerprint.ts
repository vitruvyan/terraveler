import { createHash } from "node:crypto";

/**
 * Duplicate-submission integrity (Phase 5).
 *
 * The Idempotency-Key protects a RETRY: same key, same request, same answer.
 * It says nothing about two DIFFERENT requests that happen to carry the same
 * editorial content — an agent that wants a second bite only has to change
 * the key. This is the other half: a fingerprint of what was actually
 * proposed, stable across idempotency keys, timestamps, request ids, the
 * model or runtime that drafted it, and whitespace-only formatting noise.
 *
 * Deliberately NOT semantic similarity. Two ideas that say the same thing in
 * different words are not caught, and are not supposed to be — that
 * judgement belongs to a human or the Curator's mechanical checks, never to
 * an LLM sitting in the authority path that decides whether a submission is
 * allowed to exist.
 */

/**
 * Keys stripped wherever they appear in the payload, at any nesting depth.
 * Each describes HOW or WHEN something was submitted, never WHAT was
 * submitted — see lib/oauth.ts-style provenance() in app/api/mcp/route.ts,
 * the one place all three are ever written. Leaving any of them in the
 * fingerprint would let identical content escape detection just because a
 * different model, a different Carta version in force that day, or the raw
 * text of a request id happened to differ.
 */
const VOLATILE_KEYS = new Set(["ideator", "scribe_model", "carta_version", "request_id"]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === "string") {
    // Formatting noise, not content: collapse whitespace runs and trim the
    // ends. This reaches every string field uniformly, quotations included —
    // that is intentional, not an oversight: Carta 3.4's verbatim
    // requirement is enforced against the real source by the Curator's own
    // check (ingest/verbatim.py), never by this fingerprint, which exists
    // only to answer "is this the same submission", not "is this the exact
    // same bytes".
    return value.replace(/\s+/g, " ").trim();
  }
  return value;
}

/**
 * A deterministic fingerprint of a submission's canonical content.
 *
 * `type` is mixed into the hash so an idea and a draft can never collide
 * merely by having similarly-shaped payloads — duplication is scoped within
 * one submission type, never across types.
 */
export function contentFingerprint(type: string, payload: unknown): string {
  const canonical = canonicalize(payload);
  return createHash("sha256").update(`${type}\n${JSON.stringify(canonical)}`).digest("hex");
}

export class DuplicateSubmissionError extends Error {
  constructor(public readonly existingSubmissionId: number | null) {
    super(existingSubmissionId
      ? `DUPLICATE_SUBMISSION: identical content already exists as submission #${existingSubmissionId}`
      : "DUPLICATE_SUBMISSION: identical content already exists");
    this.name = "DuplicateSubmissionError";
  }
}

/** True for a PostgREST error body/message carrying Postgres's unique_violation code. */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b23505\b/.test(message);
}
