import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { resolveVerdict } from "@/lib/deskVerdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { submission_id, verdict, note, override } = await req.json().catch(() => ({}));
  if (!submission_id || !["approve", "reject", "changes"].includes(String(verdict))) {
    return NextResponse.json({ error: "submission_id and verdict (approve|reject|changes) required" }, { status: 400 });
  }
  try {
    const id = Number(submission_id);
    const result = await resolveVerdict(id, String(verdict), { note, override });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, submission_id: id, reviews: result.reviews, refutations: result.refutations },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, submission: result.submission });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
