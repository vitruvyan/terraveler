import { NextResponse } from "next/server";
import { readCookie, getUserEmail } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seamless contribution submit — the casual path. A signed-in user pastes the
 * suggestion their AI researched (or writes their own) and posts it here; we
 * record it server-side under their session identity. No MCP, no invite code
 * on the user's side (that path stays for power users who connect the MCP).
 * Lands as a `content-suggestion` submission on the editorial desk, exactly
 * like the MCP `suggest_content` tool.
 */
const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const CARTA_VERSION = "0.1";

async function sb(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "" : "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`backend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const DAILY_LIMIT = 10;
const INJECTION = [
  /ignore (all|any|previous|prior)/i, /disregard (the|all|previous)/i,
  /note to (the )?curator/i, /pre-?approved/i, /skip (the )?(verification|review|checks)/i,
  /you (must|should|are required to) (approve|accept)/i, /system prompt/i,
  /editor[- ]in[- ]chief (has )?(approved|authorised|authorized)/i,
];

async function contributor(handle: string): Promise<{ id: number; status: string }> {
  const rows = await sb("GET", `contributors?handle=eq.${encodeURIComponent(handle)}&select=id,status`);
  if (rows.length) return rows[0];
  const made = await sb("POST", "contributors", { handle });
  return { id: made[0].id, status: made[0].status ?? "active" };
}

export async function POST(req: Request) {
  try {
    if (!SB_URL || !SB_KEY) {
      return NextResponse.json({ error: "Server not configured." }, { status: 500 });
    }
    const token = readCookie(req);
    const email = token ? await getUserEmail(token) : null;
    if (!email) {
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

    const c = await contributor(email);
    if (c.status !== "active") {
      return NextResponse.json({ error: "This account is suspended." }, { status: 403 });
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const recent = await sb("GET",
      `submissions?contributor_id=eq.${c.id}&created_at=gte.${since}&select=id&limit=${DAILY_LIMIT + 1}`);
    if (recent.length >= DAILY_LIMIT) {
      return NextResponse.json(
        { error: `Daily limit reached (${DAILY_LIMIT} suggestions per 24h). Come back tomorrow.` },
        { status: 429 });
    }

    const s = await sb("POST", "submissions", {
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
    await sb("POST", "audit_log", {
      submission_id: s[0].id, actor: "web", action: "content-suggestion",
      verdict: null, findings: null, carta_version: CARTA_VERSION,
    });
    return NextResponse.json({ ok: true, submission_id: s[0].id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
