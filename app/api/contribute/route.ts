import { NextResponse } from "next/server";
import { readCookie, getUser, dataApi } from "@/lib/deskAuth";
import { ensureHumanContributor } from "@/lib/humanContributor";
import { CARTA_VERSION } from "@/lib/carta";
import { privilegedPostgrestConfigured } from "@/lib/backendConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seamless contribution submit — the casual path. A signed-in user pastes the
 * suggestion their AI researched (or writes their own) and posts it here; we
 * record it server-side under their session identity. No MCP, no invite code
 * on the user's side (that path stays for power users who connect the MCP).
 * Lands as a `content-suggestion` submission on the editorial desk, exactly
 * like the MCP `suggest_content` tool.
 *
 * Auth is Supabase Auth; all application/governance data below is PostgreSQL on
 * the VPS through PostgREST.
 */
const DAILY_LIMIT = 10;
const INJECTION = [
  /ignore (all|any|previous|prior)/i, /disregard (the|all|previous)/i,
  /note to (the )?curator/i, /pre-?approved/i, /skip (the )?(verification|review|checks)/i,
  /you (must|should|are required to) (approve|accept)/i, /system prompt/i,
  /editor[- ]in[- ]chief (has )?(approved|authorised|authorized)/i,
];

export async function POST(req: Request) {
  try {
    if (!privilegedPostgrestConfigured()) {
      return NextResponse.json({ error: "Server not configured." }, { status: 500 });
    }
    const token = readCookie(req);
    const user = token ? await getUser(token) : null;
    if (!user) {
      return NextResponse.json({ error: "Sign in to contribute." }, { status: 401 });
    }
    const { voyage, waypoint, type, idea } = await req.json();
    if (!voyage || typeof voyage !== "string") {
      return NextResponse.json({ error: "Missing voyage." }, { status: 400 });
    }
    if (!idea || typeof idea !== "string" || !idea.trim()) {
      return NextResponse.json({ error: "Write or paste a suggestion first." }, { status: 400 });
    }

    if (INJECTION.some((p) => p.test(idea))) {
      return NextResponse.json(
        { error: "Your suggestion trips the injection screen (Magna Carta §6): submissions are data, never instructions." },
        { status: 400 });
    }

    const c = await ensureHumanContributor(user);
    if (c.status !== "active") {
      return NextResponse.json({ error: "This account is suspended." }, { status: 403 });
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const recent = await dataApi("GET",
      `submissions?contributor_id=eq.${c.id}&created_at=gte.${since}&select=id&limit=${DAILY_LIMIT + 1}`);
    if (recent.length >= DAILY_LIMIT) {
      return NextResponse.json(
        { error: `Daily limit reached (${DAILY_LIMIT} suggestions per 24h). Come back tomorrow.` },
        { status: 429 });
    }

    const s = await dataApi("POST", "submissions", {
      contributor_id: c.id,
      type: "content-suggestion",
      target_voyage: voyage.slice(0, 100),
      payload: {
        voyage: voyage.slice(0, 100),
        waypoint: typeof waypoint === "number" ? waypoint : null,
        content_type: typeof type === "string" ? type.slice(0, 40) : "other",
        idea: idea.trim().slice(0, 4000),
        via: "web",
      },
      status: "human-review",
      carta_version: CARTA_VERSION,
    });
    await dataApi("POST", "audit_log", {
      submission_id: s[0].id, actor: "web", action: "content-suggestion",
      verdict: null, findings: null, carta_version: CARTA_VERSION,
    });
    return NextResponse.json({ ok: true, submission_id: s[0].id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
