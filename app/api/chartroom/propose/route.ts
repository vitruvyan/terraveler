import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { dataApi, getUser, readCookie } from "@/lib/deskAuth";
import { ensureHumanContributor } from "@/lib/humanContributor";
import { DuplicateSubmissionError, contentFingerprint, isUniqueViolation } from "@/lib/contentFingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A human proposing a new idea directly — the submission-side counterpart
 * to what suggest_source/propose_idea already do for an agent over MCP.
 * The Chartroom's own proposal wizard (components/ChartroomBoard.tsx)
 * shipped as a UX draft that only ever copied the text to the clipboard,
 * by design, with a note that direct submission would be "wired to the
 * governed proposal endpoint" once approved — this is that endpoint. Same
 * type ("idea"), same status ("human-review", ideas skip peer review per
 * lib/gate.ts's NO_DOSSIER_TYPES), same audit trail shape as the MCP path,
 * so a human's proposal and an agent's proposal are indistinguishable to
 * the desk from here on.
 */

async function signedInHuman(req: Request) {
  const token = readCookie(req);
  const user = token ? await getUser(token) : null;
  return user ? ensureHumanContributor(user) : null;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  try {
    const contributor = await signedInHuman(req);
    if (!contributor) {
      return NextResponse.json({ error: "Sign in to propose an idea." }, { status: 401 });
    }
    if (contributor.status !== "active") {
      return NextResponse.json({ error: "This contributor is suspended." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const title = cleanText(body?.title, 180);
    const description = cleanText(body?.why, 4000);
    const kind = cleanText(body?.category, 40) || null;
    const context = cleanText(body?.context, 1000) || null;
    const evidence = cleanText(body?.evidence, 1000) || null;

    if (title.length < 4) {
      return NextResponse.json({ error: "Give the proposal a short, concrete title." }, { status: 400 });
    }
    if (description.length < 10) {
      return NextResponse.json({ error: "Explain why this belongs in the atlas." }, { status: 400 });
    }

    const payload = { title, description, kind, context, evidence };
    // Fingerprinted on the same fields propose_idea uses (title/description/kind)
    // so a human and an agent proposing the identical idea are caught by the
    // same duplicate check, not two independent ones.
    const fp = contentFingerprint("idea", { title, description, kind });

    let rows;
    try {
      rows = await dataApi("POST", "submissions", {
        contributor_id: contributor.id,
        type: "idea",
        target_voyage: null,
        payload,
        status: "human-review",
        content_fingerprint: fp,
        carta_version: CARTA_VERSION,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await dataApi(
        "GET",
        `submissions?contributor_id=eq.${contributor.id}` +
          `&content_fingerprint=eq.${encodeURIComponent(fp)}` +
          `&status=not.in.(rejected,curator-rejected)&select=id&limit=1`,
      );
      throw new DuplicateSubmissionError(existing?.[0]?.id ?? null);
    }

    const submissionId = Number(rows[0].id);
    await dataApi("POST", "audit_log", {
      submission_id: submissionId,
      actor: `contributor:${contributor.handle}`,
      action: "proposal",
      verdict: null,
      findings: null,
      carta_version: CARTA_VERSION,
    });

    return NextResponse.json({ ok: true, submission_id: submissionId, status: "human-review" });
  } catch (error: any) {
    if (error instanceof DuplicateSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
