/** Shared between /api/desk/overview (the count) and app/desk/page.tsx (the
 *  per-submission badge), so the two can't drift on what "escalated" means —
 *  see Ship's Officers §8, brake 2: the Curator's `escalate` findings are the
 *  one signal designed to deserve human attention, and until this existed
 *  they were shown nowhere. */

/** A submission still awaiting a verdict — not yet approved, rejected, or
 *  answered on appeal. Matches the statuses the desk itself will show verdict
 *  buttons for (app/desk/page.tsx), plus 'appealed' is intentionally excluded
 *  here: an appeal is its own alarm, counted separately. */
export const PENDING_STATUSES = ["submitted", "peer-review", "human-review", "changes-requested"];

/** True if a Findings array (scripts/desk_review.py: Findings.rows, each row
 *  [level, 0, "where: what"]) carries an ESCALATE-level entry. The Curator
 *  writes the level upper-case (f.escalate -> self.add("ESCALATE", ...));
 *  matched case-insensitively since nothing else in the schema promises the
 *  case. */
export function hasEscalateFinding(findings: unknown): boolean {
  if (!Array.isArray(findings)) return false;
  return findings.some((f) => Array.isArray(f) && typeof f[0] === "string" && f[0].toLowerCase() === "escalate");
}
