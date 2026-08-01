import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  changes: "changes-requested",
};

export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { submission_id, verdict, note, override } = await req.json().catch(() => ({}));
  const status = STATUS[String(verdict)];
  if (!submission_id || !status) {
    return NextResponse.json({ error: "submission_id and verdict (approve|reject|changes) required" }, { status: 400 });
  }
  try {
    const id = Number(submission_id);
    const rows = await sb("GET", `submissions?id=eq.${id}&select=status,type`);
    if (!rows.length) return NextResponse.json({ error: "no such submission" }, { status: 404 });
    const from = String(rows[0].status);

    // Carta §10.4: a draft that passes the gate enters peer review, where other
    // Scribes attempt to refute it, and "the editor rules with the reviewers'
    // dossier in hand". The first version of this guard fired only when the
    // status was literally 'peer-review' — so approving from 'human-review',
    // or after a 'changes' round, walked around it, and a draft with two
    // reviews stuck in 'peer-review' by a failed advance was refused for a
    // dossier it had. The guard now looks at the dossier itself, wherever the
    // draft stands: fewer than two reviews, or any unanswered refutation,
    // needs an explicit override. Ideas and suggestions never enter peer
    // review (they go straight to human-review), so they are exempt — the
    // dossier rule is about work that will be published, not about intent.
    //
    // The editor is still final authority (§2) and may overrule. What changes
    // is that overruling is a deliberate act with a reason attached, rather
    // than the invisible default.
    const NO_DOSSIER_TYPES = ["idea", "feature-suggestion", "content-suggestion"];
    let dossier: any[] = [];
    let refutes = 0;
    if (verdict === "approve" && !NO_DOSSIER_TYPES.includes(String(rows[0].type))) {
      dossier = await sb("GET", `reviews?submission_id=eq.${id}&select=verdict`);
      refutes = dossier.filter((r: any) => r.verdict === "refute").length;
      if (!override && (dossier.length < 2 || refutes > 0)) {
        return NextResponse.json({
          error: `the dossier is not clean: ${dossier.length} review(s) recorded, ` +
            `${refutes} refuting. Carta 10.4 has the editor ruling with the ` +
            `reviewers' dossier in hand. Approve anyway by resending with override ` +
            `and a reason — it will be recorded as an override, because that is ` +
            `what it is.`,
          submission_id: id, status: from,
          reviews: dossier.length, refutations: refutes,
        }, { status: 409 });
      }
    }

    const updated = await sb("PATCH", `submissions?id=eq.${id}`, {
      status, updated_at: new Date().toISOString(),
    });
    // An override is recorded beside the verdict, not instead of it: the trail
    // has to show that a step was skipped and on whose say-so.
    const findings: unknown[] = [];
    if (note) findings.push(["INFO", 4, String(note)]);
    if (override && verdict === "approve")
      findings.push(["OVERRIDE", 0,
        `approved from '${from}' with a dossier of ${dossier.length} review(s), ` +
        `${refutes} refuting. Reason: ${String(override).slice(0, 500)}`]);
    // Carta §5: an appeal reaches the Editor-in-chief alone (Ship's Officers
    // §4.1 forbids the Curator this one thing). Nothing before this recorded
    // that a verdict on an 'appealed' submission *was* the answer to that
    // appeal rather than an ordinary first ruling — so the trail could not
    // show the appeal was ever answered, only that a verdict happened to
    // land after one was filed.
    if (from === "appealed") {
      const priorAppeals = await sb("GET",
        `audit_log?submission_id=eq.${id}&action=eq.appeal&select=created_at&order=id.desc&limit=1`);
      const filedOn = priorAppeals[0]?.created_at ? String(priorAppeals[0].created_at).slice(0, 10) : "unknown date";
      findings.push(["APPEAL-RULING", 0, `answers the appeal filed ${filedOn}`]);
    }
    await sb("POST", "audit_log", {
      submission_id: Number(submission_id),
      actor: "editor-in-chief",
      action: "verdict",
      verdict: verdict === "changes" ? "changes-requested" : String(verdict),
      findings: findings.length ? findings : null,
      carta_version: CARTA_VERSION,
    });
    return NextResponse.json({ ok: true, submission: updated[0] });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
