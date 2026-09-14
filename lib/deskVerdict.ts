/**
 * The editor's verdict on a submission — extracted from
 * app/api/desk/verdict/route.ts so the Telegram webhook can rule on an
 * escalated submission through the exact same Carta §10.4 dossier guard
 * and §5 appeal-ruling trail, rather than a second copy of both that could
 * quietly drift from this one. See that route for the guard's own history
 * (it used to fire only on literal status 'peer-review' and could be
 * walked around).
 */
import { sb } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";

const STATUS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  changes: "changes-requested",
};

const NO_DOSSIER_TYPES = ["idea", "feature-suggestion", "content-suggestion"];

export type VerdictResult =
  | { ok: true; submission: any }
  | { ok: false; error: string; status: number; reviews?: number; refutations?: number };

export async function resolveVerdict(
  submissionId: number,
  verdict: string,
  opts: { note?: string; override?: string; origin?: string } = {},
): Promise<VerdictResult> {
  const status = STATUS[verdict];
  if (!status) return { ok: false, error: "verdict must be approve|reject|changes", status: 400 };

  const rows = await sb("GET", `submissions?id=eq.${submissionId}&select=status,type`);
  if (!rows.length) return { ok: false, error: "no such submission", status: 404 };
  const from = String(rows[0].status);

  let dossier: any[] = [];
  let refutes = 0;
  if (verdict === "approve" && !NO_DOSSIER_TYPES.includes(String(rows[0].type))) {
    dossier = await sb("GET", `reviews?submission_id=eq.${submissionId}&select=verdict`);
    refutes = dossier.filter((r: any) => r.verdict === "refute").length;
    if (!opts.override && (dossier.length < 2 || refutes > 0)) {
      return {
        ok: false, status: 409,
        error: `the dossier is not clean: ${dossier.length} review(s) recorded, ` +
          `${refutes} refuting. Carta 10.4 has the editor ruling with the ` +
          `reviewers' dossier in hand. Approve anyway with an override reason — ` +
          `it will be recorded as an override, because that is what it is.`,
        reviews: dossier.length, refutations: refutes,
      };
    }
  }

  const updated = await sb("PATCH", `submissions?id=eq.${submissionId}`, {
    status, updated_at: new Date().toISOString(),
  });

  // An override is recorded beside the verdict, not instead of it: the trail
  // has to show that a step was skipped and on whose say-so.
  const findings: unknown[] = [];
  if (opts.note) findings.push(["INFO", 4, String(opts.note)]);
  if (opts.override && verdict === "approve") {
    findings.push(["OVERRIDE", 0,
      `approved from '${from}' with a dossier of ${dossier.length} review(s), ` +
      `${refutes} refuting. Reason: ${String(opts.override).slice(0, 500)}`]);
  }
  if (opts.origin) findings.push(["INFO", 4, `recorded via ${opts.origin}`]);

  // Carta §5: an appeal reaches the Editor-in-chief alone. Nothing before
  // this recorded that a verdict on an 'appealed' submission *was* the
  // answer to that appeal rather than an ordinary first ruling.
  if (from === "appealed") {
    const priorAppeals = await sb("GET",
      `audit_log?submission_id=eq.${submissionId}&action=eq.appeal&select=created_at&order=id.desc&limit=1`);
    const filedOn = priorAppeals[0]?.created_at ? String(priorAppeals[0].created_at).slice(0, 10) : "unknown date";
    findings.push(["APPEAL-RULING", 0, `answers the appeal filed ${filedOn}`]);
  }

  await sb("POST", "audit_log", {
    submission_id: submissionId,
    actor: "editor-in-chief",
    action: "verdict",
    verdict: verdict === "changes" ? "changes-requested" : verdict,
    findings: findings.length ? findings : null,
    carta_version: CARTA_VERSION,
  });

  return { ok: true, submission: updated[0] };
}
