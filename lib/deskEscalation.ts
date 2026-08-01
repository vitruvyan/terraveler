/** Shared between /api/desk/overview (the count) and app/desk/page.tsx (the
 *  per-submission badge), so the two can't drift on what "escalated" means —
 *  see Ship's Officers §8, brake 2: the Curator's `escalate` findings are the
 *  one signal designed to deserve human attention, and until this existed
 *  they were shown nowhere. */

/** A submission whose next move belongs to the DESK — which is what the
 *  escalation count claims the editor's attention for. 'appealed' is
 *  intentionally excluded (an appeal is its own alarm, counted separately),
 *  and so is 'changes-requested': a draft can carry both a FAIL and an
 *  ESCALATE finding in the same pass, land in changes-requested, and then
 *  the next move is the contributor's — counting it would ring the alarm
 *  for work that is not waiting on the editor at all. */
export const PENDING_STATUSES = ["submitted", "peer-review", "human-review"];

/** True if a Findings array (scripts/desk_review.py: Findings.rows, each row
 *  [level, 0, "where: what"]) carries an ESCALATE-level entry. The Curator
 *  writes the level upper-case (f.escalate -> self.add("ESCALATE", ...));
 *  matched case-insensitively since nothing else in the schema promises the
 *  case. */
export function hasEscalateFinding(findings: unknown): boolean {
  if (!Array.isArray(findings)) return false;
  return findings.some((f) => Array.isArray(f) && typeof f[0] === "string" && f[0].toLowerCase() === "escalate");
}
