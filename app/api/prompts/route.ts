import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";
import { PROMPT_KEYS, type PromptMap } from "@/lib/promptRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The current text of every agent-facing prompt — public, unauthenticated,
 * on purpose: these are exactly the words already shown, unauthenticated, on
 * the atlas and Chartroom pages today, just no longer baked into the
 * JavaScript bundle. A browser fetches this once per page load; the actual
 * composition (which prompt gets the compatibility preamble prepended, which
 * placeholder gets which value) stays client-side in lib/promptRegistry.ts,
 * this route only ever answers "what is current."
 */
export async function GET() {
  try {
    const rows = await sb("GET", "agent_prompts_current?select=prompt_key,version,body");
    const prompts = {} as PromptMap;
    for (const row of rows as { prompt_key: string; version: number; body: string }[]) {
      if ((PROMPT_KEYS as readonly string[]).includes(row.prompt_key)) {
        (prompts as any)[row.prompt_key] = { version: row.version, body: row.body };
      }
    }
    return NextResponse.json(
      { prompts },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
