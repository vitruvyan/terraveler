import { NextResponse } from "next/server";
import { editorEmail, requireEditor, sb } from "@/lib/deskAuth";
import { PROMPT_KEYS, type PromptKey } from "@/lib/promptRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every version of every prompt, newest first — the desk's own history for
 *  a surface that used to have none beyond git blame on a template literal. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const rows = await sb("GET",
      "agent_prompts?order=prompt_key.asc,version.desc&select=id,prompt_key,version,body,notes,created_at,created_by");
    return NextResponse.json({ versions: rows });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

/** Adds a new version — never edits or removes one (agent_prompts is
 *  append-only at the database level too; this would fail the same way even
 *  without this check). version = the current max for that key + 1, decided
 *  server-side so two edits can't collide on the same number. */
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { prompt_key, body, notes } = await req.json().catch(() => ({}));
  if (!(PROMPT_KEYS as readonly string[]).includes(prompt_key)) {
    return NextResponse.json({ error: `prompt_key must be one of ${PROMPT_KEYS.join(", ")}` }, { status: 400 });
  }
  if (!body || !String(body).trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  try {
    const current = await sb("GET",
      `agent_prompts?prompt_key=eq.${prompt_key}&select=version&order=version.desc&limit=1`);
    const nextVersion = (current[0]?.version ?? 0) + 1;

    const inserted = await sb("POST", "agent_prompts", {
      prompt_key: prompt_key as PromptKey,
      version: nextVersion,
      body: String(body),
      notes: notes ? String(notes).slice(0, 2000) : null,
      created_by: editorEmail() || null,
    });
    return NextResponse.json({ ok: true, version: inserted[0] });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
