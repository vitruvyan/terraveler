import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARTA_VERSION = "0.1";
const STATUS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  changes: "changes-requested",
};

export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { submission_id, verdict, note } = await req.json().catch(() => ({}));
  const status = STATUS[String(verdict)];
  if (!submission_id || !status) {
    return NextResponse.json({ error: "submission_id and verdict (approve|reject|changes) required" }, { status: 400 });
  }
  try {
    const updated = await sb("PATCH", `submissions?id=eq.${Number(submission_id)}`, {
      status, updated_at: new Date().toISOString(),
    });
    if (!updated?.length) return NextResponse.json({ error: "no such submission" }, { status: 404 });
    await sb("POST", "audit_log", {
      submission_id: Number(submission_id),
      actor: "editor-in-chief",
      action: "verdict",
      verdict: verdict === "changes" ? "changes-requested" : String(verdict),
      findings: note ? [["INFO", 4, String(note)]] : null,
      carta_version: CARTA_VERSION,
    });
    return NextResponse.json({ ok: true, submission: updated[0] });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
