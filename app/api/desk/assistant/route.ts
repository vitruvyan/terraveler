import { NextResponse } from "next/server";
import { requireEditor, dataApi } from "@/lib/deskAuth";
import { ATLAS } from "@/lib/voyages";
import { CARTA_VERSION } from "@/lib/carta";
import { submissionTitle } from "@/lib/deskPresentation";
import {
  askEditorLocalAI,
  editorHistory,
  localAIConfig,
  EditorAIError,
  type EditorContext,
} from "@/lib/editorLocalAI";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok)
    return NextResponse.json(
      { error: auth.error },
      { status: 401, headers: PRIVATE },
    );
  const config = localAIConfig();
  return NextResponse.json(
    {
      configured: !!config,
      provider: config?.provider ?? null,
      model: config?.model ?? null,
      message: config
        ? "Local assistant configured. Connectivity is checked when you send a message."
        : "Local assistant is not configured. Set its server address and model on the backend; no cloud fallback will be used.",
    },
    { headers: PRIVATE },
  );
}

export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok)
    return NextResponse.json(
      { error: auth.error },
      { status: 401, headers: PRIVATE },
    );
  try {
    const raw = await req.text();
    if (raw.length > 20000)
      return NextResponse.json(
        { error: "Message is too long." },
        { status: 400, headers: PRIVATE },
      );
    const body = JSON.parse(raw);
    const question = body?.question;
    const targetType =
      body?.target_type ?? (body?.submission_id != null ? "submission" : null);
    const targetId =
      body?.target_id ??
      (body?.submission_id != null ? String(body.submission_id) : null);
    const id = targetType === "submission" ? Number(targetId) : null;
    const validTarget =
      targetType === "voyage"
        ? typeof targetId === "string" &&
          /^[a-z0-9][a-z0-9-]{0,99}$/.test(targetId)
        : ["submission", "project"].includes(targetType) &&
          typeof targetId === "string" &&
          /^[1-9][0-9]{0,12}$/.test(targetId);
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 4000 ||
      ((targetType != null || targetId != null) && !validTarget)
    )
      return NextResponse.json(
        {
          error:
            "A message and a valid selected content reference are required.",
        },
        { status: 400, headers: PRIVATE },
      );
    const config = localAIConfig();
    if (!config)
      return NextResponse.json(
        {
          error:
            "Local assistant is not configured. No cloud service was called.",
          code: "not_configured",
        },
        { status: 503, headers: PRIVATE },
      );
    let context: EditorContext | null = null;
    if (targetType != null) {
      let row: any;
      let reviews: unknown[] = [];
      if (targetType === "submission") {
        const rows = await dataApi(
          "GET",
          `submissions?id=eq.${targetId}&select=id,type,status,target_voyage,payload&limit=1`,
        );
        row = rows[0];
        if (row)
          reviews = await dataApi(
            "GET",
            `reviews?submission_id=eq.${targetId}&select=verdict,findings&order=id.desc&limit=10`,
          );
      } else if (targetType === "project") {
        const rows = await dataApi(
          "GET",
          `editorial_gaps?id=eq.${targetId}&select=id,title,description,kind,status,claimed_by&limit=1`,
        );
        row = rows[0];
      } else {
        row = ATLAS.find((v) => v.slug === targetId);
      }
      if (!row)
        return NextResponse.json(
          { error: "Selected content was not found." },
          { status: 404, headers: PRIVATE },
        );
      const titles = await dataApi(
        "GET",
        `audit_log?actor=eq.editor-in-chief&action=eq.editorial-title&findings->>target_type=eq.${targetType}&findings->>target_id=eq.${targetId}&select=id,findings&order=id.desc&limit=1`,
      );
      const title =
        typeof titles[0]?.findings?.title === "string"
          ? titles[0].findings.title
          : targetType === "submission"
            ? submissionTitle(row)
            : row.title;
      context = {
        target_type: targetType,
        target_id: targetId,
        title,
        type: row.type ?? row.kind ?? targetType,
        status: row.status ?? "listed-in-atlas",
        payload: row.payload ?? row,
        reviews,
        title_version: Number(titles[0]?.id ?? 0),
      };
    }
    const answer = await askEditorLocalAI(
      question.trim(),
      context,
      config,
      fetch,
      editorHistory(body.history),
    );
    // This records advice, not an executed action. Writes occur only through
    // the separate authenticated editorial action route after an editor click.
    await dataApi("POST", "audit_log", {
      submission_id: id ?? null,
      actor: "editor-local-ai",
      action: "editorial-assistant",
      verdict: null,
      findings: {
        target_type: targetType,
        target_id: targetId,
        question: question.trim(),
        answer: answer.answer,
        proposal: answer.action ?? null,
        model: config.model,
        provider: config.provider,
        executed: false,
      },
      carta_version: CARTA_VERSION,
    });
    return NextResponse.json(answer, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "Invalid message format." },
        { status: 400, headers: PRIVATE },
      );
    const code = error instanceof EditorAIError ? error.code : "unavailable";
    return NextResponse.json(
      {
        error:
          code === "invalid_response"
            ? "The local model returned an invalid action. Nothing was changed."
            : "The local assistant or its editorial record is unavailable. Nothing was changed; no cloud fallback was used.",
        code,
      },
      { status: 502, headers: PRIVATE },
    );
  }
}
