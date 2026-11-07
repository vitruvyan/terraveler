import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import {
  executeEditorAction,
  missingEditorActionMigration,
  parseEditorAction,
} from "@/lib/editorActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: 401 });
  const action = parseEditorAction(await req.json().catch(() => null));
  if (!action)
    return NextResponse.json(
      {
        error:
          "A valid editorial action, target, value, request ID and current title version are required.",
      },
      { status: 400 },
    );
  try {
    const result = await executeEditorAction(action);
    if (result.error) {
      const status =
        result.error === "not-found"
          ? 404
          : ["conflict", "idempotency-conflict"].includes(String(result.error))
            ? 409
            : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (missingEditorActionMigration(error))
      return NextResponse.json(
        {
          error:
            "Editorial changes are not configured yet. Apply supabase/editor_actions.sql to the canonical VPS database before enabling edits.",
          code: "editor-actions-unavailable",
        },
        { status: 503 },
      );
    return NextResponse.json(
      {
        error:
          "Could not record the editorial change. Reload the record before retrying with the same request ID.",
      },
      { status: 503 },
    );
  }
}
