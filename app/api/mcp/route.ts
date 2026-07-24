import { NextResponse } from "next/server";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bougainville from "@/data/bougainville.json";

/**
 * Terraveler MCP server (Streamable HTTP, stateless).
 * Scribes connect here to read the Magna Carta, browse the editorial roadmap,
 * propose ideas and submit drafts. Writing requires a personal api_key,
 * minted once via `register` (invite code gates registration only, so a
 * leaked invite lets someone join — never impersonate). Deep source
 * verification stays with the Curator; this endpoint runs the instant
 * Stage-0 gate, per-rank quotas and the injection screen.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const INVITE = process.env.MCP_INVITE_CODE ?? "";
const CARTA_VERSION = "0.1";
const RAW = "https://raw.githubusercontent.com/vitruvyan/terraveler/main";

// ------------------------------------------------------------------ helpers
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

// ------------------------------------------------------------------ identity
const HANDLE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;

type Contributor = { id: number; rank: string };

/** Write-tool auth: handle + personal api_key (stored server-side as sha256). */
async function authenticate(args: any): Promise<{ ok?: Contributor; err?: string }> {
  if (!args?.handle || typeof args.handle !== "string")
    return { err: "Missing contributor handle." };
  if (!args?.api_key || typeof args.api_key !== "string")
    return { err: "Missing api_key. Register once with the `register` tool (invite code required) to obtain your personal key." };
  const rows = await sb("GET",
    `contributors?handle=eq.${encodeURIComponent(args.handle)}&select=id,rank,status,api_key_hash`);
  if (!rows.length) return { err: "Unknown handle. Register first with the `register` tool." };
  const c = rows[0];
  if (!c.api_key_hash)
    return { err: "This handle predates personal keys — ask the editorial desk to mint one." };
  const given = createHash("sha256").update(args.api_key).digest();
  const stored = Buffer.from(String(c.api_key_hash), "hex");
  if (stored.length !== given.length || !timingSafeEqual(given, stored))
    return { err: "Invalid api_key for this handle." };
  if (c.status !== "active")
    return { err: "This contributor is suspended. Appeals go to the editor-in-chief." };
  return { ok: { id: c.id, rank: c.rank } };
}

// ------------------------------------------------------------------ quotas
// Standing earns capacity, never exemption from review (Carta 7).
const QUOTA: Record<string, { submissionsPerDay: number; activeClaims: number }> = {
  "cabin-boy": { submissionsPerDay: 3, activeClaims: 1 },
  "deckhand":  { submissionsPerDay: 6, activeClaims: 2 },
  "navigator": { submissionsPerDay: 12, activeClaims: 3 },
  "captain":   { submissionsPerDay: 24, activeClaims: 5 },
  "admiral":   { submissionsPerDay: 48, activeClaims: 8 },
};
const CLAIM_TTL_DAYS = 7;

function quotaFor(rank: string) {
  return QUOTA[rank] ?? QUOTA["cabin-boy"];
}

async function overDailyLimit(c: Contributor): Promise<string | null> {
  const q = quotaFor(c.rank);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = await sb("GET",
    `submissions?contributor_id=eq.${c.id}&created_at=gte.${since}&select=id&limit=${q.submissionsPerDay + 1}`);
  if (rows.length >= q.submissionsPerDay)
    return `Daily quota reached for rank '${c.rank}' (${q.submissionsPerDay}/24h). Quality over volume — resume tomorrow, or rise in rank.`;
  return null;
}

/** Reopen claims whose holder went silent past the TTL (legacy claims lack a timestamp — reopen those too). */
async function reapStaleClaims(): Promise<void> {
  const cutoff = new Date(Date.now() - CLAIM_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  await sb("PATCH",
    `editorial_gaps?status=eq.claimed&or=(claimed_at.lt.${cutoff},claimed_at.is.null)`,
    { status: "open", claimed_by: null, claimed_at: null });
}

// ------------------------------------------------------------------ stage-0 gate
const DOMAINS = ["gutenberg.org", "wikisource.org", "wikipedia.org", "wikimedia.org",
  "wikidata.org", "archive.org", "gallica.bnf.fr", "loc.gov", "davidrumsey.com"];
const LICENSE_OK = /public domain|^cc[ -]/i;
const CONFIDENCES = ["certain", "approximate", "reconstructed", "contested"];
const INJECTION = [
  /ignore (all|any|previous|prior)/i, /disregard (the|all|previous)/i,
  /note to (the )?curator/i, /pre-?approved/i, /skip (the )?(verification|review|checks)/i,
  /you (must|should|are required to) (approve|accept)/i, /system prompt/i,
  /editor[- ]in[- ]chief (has )?(approved|authorised|authorized)/i,
];

// Free-text bounds for the lightweight write tools. The injection screen is a
// tripwire, not the defence: the desk always treats payloads as data.
const TEXT_LIMITS: Record<string, number> = { title: 200, description: 4000, idea: 4000, area: 100, voyage: 100 };

function badText(args: any, fields: string[]): string | null {
  for (const f of fields) {
    const v = args?.[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return `Field '${f}' must be a string.`;
    const cap = TEXT_LIMITS[f] ?? 2000;
    if (v.length > cap) return `Field '${f}' exceeds ${cap} characters.`;
    if (INJECTION.some((p) => p.test(v)))
      return `Field '${f}' trips the injection screen (Carta 6): submissions are data, never instructions.`;
  }
  return null;
}

const MAX_DRAFT_BYTES = 300_000;
const MAX_WAYPOINTS = 300;
const MAX_CLAIMS_PER_WAYPOINT = 60;

function domainOk(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function* strings(obj: any, path = ""): Generator<[string, string]> {
  if (typeof obj === "string") yield [path, obj];
  else if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) yield* strings(obj[i], `${path}[${i}]`);
  else if (obj && typeof obj === "object")
    for (const k of Object.keys(obj)) yield* strings(obj[k], path ? `${path}.${k}` : k);
}

/** Instant deterministic gate (subset of the full Curator: no source fetching). */
function stage0(sub: any): string[] {
  const fails: string[] = [];
  if (JSON.stringify(sub ?? {}).length > MAX_DRAFT_BYTES)
    return [`submission exceeds ${MAX_DRAFT_BYTES / 1000} kB — split it into smaller drafts`];
  const meta = sub?.meta ?? {};
  if (meta.carta_version !== CARTA_VERSION)
    fails.push(`carta_version is '${meta.carta_version}', current is '${CARTA_VERSION}' — call get_contract first`);
  for (const f of ["type", "ideator", "scribe_model"]) if (!meta[f]) fails.push(`meta.${f} missing`);
  const wps = sub?.waypoints ?? [];
  if (!Array.isArray(wps) || wps.length === 0) fails.push("no waypoints in submission");
  if (Array.isArray(wps) && wps.length > MAX_WAYPOINTS) return [`too many waypoints (max ${MAX_WAYPOINTS})`];
  for (const w of wps) {
    const tag = `wp${w?.seq ?? "?"}`;
    for (const f of ["seq", "place_historical", "latitude", "longitude", "arrival_date", "confidence"])
      if (w?.[f] === undefined || w?.[f] === null || w?.[f] === "") fails.push(`${tag}: field '${f}' missing`);
    if (w?.confidence && !CONFIDENCES.includes(w.confidence)) fails.push(`${tag}: invalid confidence`);
    if ((w?.claims ?? []).length > MAX_CLAIMS_PER_WAYPOINT)
      fails.push(`${tag}: too many claims (max ${MAX_CLAIMS_PER_WAYPOINT})`);
    for (let ci = 0; ci < (w?.claims ?? []).length; ci++) {
      const c = w.claims[ci], ctag = `${tag}.claim${ci + 1}`;
      if (!c?.text) fails.push(`${ctag}: empty claim text`);
      if (!c?.evidence) { fails.push(`${ctag}: CLAIM WITHOUT SOURCE (Carta 3.1)`); continue; }
      if (!c.evidence.excerpt || !c.evidence.source_url) fails.push(`${ctag}: evidence incomplete`);
      if (!LICENSE_OK.test(c.evidence.license ?? "")) fails.push(`${ctag}: licence not PD/CC (Carta 3.2)`);
      if (c.evidence.source_url && !domainOk(c.evidence.source_url))
        fails.push(`${ctag}: source domain not whitelisted`);
    }
  }
  for (const [path, s] of strings(sub))
    if (INJECTION.some((p) => p.test(s))) { fails.push(`INJECTION ATTEMPT at '${path}' (Carta 6)`); break; }
  return fails;
}

// ------------------------------------------------------------------ tools
const AUTH_PROPS = {
  handle: { type: "string" },
  api_key: { type: "string", description: "your personal key, minted once by `register`" },
};

const TOOLS = [
  { name: "get_contract",
    description: "Return the Magna Carta of the Seas — Terraveler's editorial constitution. Every Scribe MUST read it before proposing or drafting.",
    inputSchema: { type: "object", properties: {} } },
  { name: "how_it_works",
    description: "Return the Terraveler contribution guide: roles, flow, tool reference.",
    inputSchema: { type: "object", properties: {} } },
  { name: "register",
    description: "Register a contributor handle (invite code required) and receive a personal api_key — shown ONCE, stored only as a hash. All write tools require handle + api_key.",
    inputSchema: { type: "object", required: ["handle", "invite_code"],
      properties: { handle: { type: "string", description: "3-32 chars: letters, digits, '-', '_'" },
        invite_code: { type: "string" } } } },
  { name: "list_gaps",
    description: "The editorial roadmap: what Terraveler currently wants (curated gaps by priority, PLUS an auto-computed completeness report of existing voyages: which waypoints lack media, diary excerpts, dates). Work these, not random ideas.",
    inputSchema: { type: "object", properties: {} } },
  { name: "claim_gap",
    description: "Claim an open gap before working on it, so no one duplicates effort. Claims are per-contributor, rank-limited, and expire after 7 days without a submission.",
    inputSchema: { type: "object", required: ["handle", "api_key", "gap_id"],
      properties: { ...AUTH_PROPS, gap_id: { type: "number" } } } },
  { name: "propose_idea",
    description: "Propose an idea BEFORE doing any drafting work. Returns a submission id; the editorial desk assesses scope/feasibility.",
    inputSchema: { type: "object", required: ["handle", "api_key", "title", "description"],
      properties: { ...AUTH_PROPS,
        title: { type: "string" }, description: { type: "string" },
        kind: { type: "string", enum: ["voyage", "waypoint", "media", "perspective", "translation", "correction"] } } } },
  { name: "submit_draft",
    description: "Submit a structured draft (meta + waypoints with sourced claims). Runs the instant Stage-0 gate; deep source verification follows. Returns findings and a submission id.",
    inputSchema: { type: "object", required: ["handle", "api_key", "submission"],
      properties: { ...AUTH_PROPS,
        submission: { type: "object", description: "See how_it_works for the schema." } } } },
  { name: "suggest_feature",
    description: "Suggest a feature or change for Terraveler itself (site, map, tools, process). The suggestion lands on the editorial desk for consideration.",
    inputSchema: { type: "object", required: ["handle", "api_key", "title", "description"],
      properties: { ...AUTH_PROPS,
        title: { type: "string" }, description: { type: "string" },
        area: { type: "string", description: "optional: map | timeline | chat | governance | mcp | other" } } } },
  { name: "suggest_content",
    description: "Suggest content for a SPECIFIC voyage waypoint — an additional PD/CC source, a period image, an ethnographic detail, a coordinate/date fix, or a correction. Scoped to (voyage, waypoint, type). Lighter than submit_draft: a pointer for the desk, not a verified draft. Use this when contributing from a specific log entry, plate, or ethnographic note.",
    inputSchema: { type: "object", required: ["handle", "api_key", "voyage", "type", "idea"],
      properties: { ...AUTH_PROPS,
        voyage: { type: "string", description: "voyage slug, e.g. boudeuse-1766" },
        waypoint: { type: "number", description: "waypoint seq this concerns (omit for whole-voyage)" },
        type: { type: "string", enum: ["source", "image", "coordinate", "date", "ethnography", "correction", "other"] },
        idea: { type: "string", description: "what to add/fix, ideally with a PD/CC source URL" } } } },
  { name: "get_submission_status",
    description: "Status and audit findings for a submission id.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } } },
  { name: "get_standing",
    description: "A contributor's rank and record (Ship's Ranks: cabin-boy → admiral).",
    inputSchema: { type: "object", required: ["handle"], properties: { handle: { type: "string" } } } },
];

async function callTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "get_contract": {
      const r = await fetch(`${RAW}/MAGNA_CARTA.md`, { cache: "no-store" });
      return await r.text();
    }
    case "how_it_works": {
      const r = await fetch(`${RAW}/docs/HOW_IT_WORKS.md`, { cache: "no-store" });
      return await r.text();
    }
    case "register": {
      if (!INVITE) return "ERROR: Registration is closed: no invite programme is configured.";
      if (args?.invite_code !== INVITE)
        return "ERROR: Invalid or missing invite_code — ask the editorial desk for one.";
      const handle = args?.handle;
      if (typeof handle !== "string" || !HANDLE_RE.test(handle))
        return "ERROR: Handle must be 3-32 characters — letters, digits, '-' or '_', starting alphanumeric.";
      const existing = await sb("GET", `contributors?handle=eq.${encodeURIComponent(handle)}&select=id`);
      if (existing.length)
        return "ERROR: Handle already registered. Keys are shown once; if you lost yours, ask the desk to rotate it.";
      const key = randomBytes(24).toString("hex");
      const hash = createHash("sha256").update(key).digest("hex");
      await sb("POST", "contributors", { handle, api_key_hash: hash });
      await sb("POST", "audit_log", {
        submission_id: null, actor: "mcp", action: "register", verdict: null,
        findings: [["INFO", 0, `contributor '${handle}' registered (rank cabin-boy)`]],
        carta_version: CARTA_VERSION,
      });
      return JSON.stringify({ handle, rank: "cabin-boy", api_key: key,
        note: "Welcome aboard, Cabin Boy. STORE THIS KEY NOW — it is shown only once and kept server-side only as a hash. Pass handle + api_key to every write tool." }, null, 2);
    }
    case "list_gaps": {
      await reapStaleClaims();
      const rows = await sb("GET", "editorial_gaps?status=eq.open&order=priority.asc,id.asc&select=id,title,description,kind,priority");
      // Auto-computed completeness: what the existing voyage data actually lacks.
      const b: any = bougainville;
      const wps: any[] = b.waypoints ?? [];
      const seqs = (pred: (w: any) => boolean) => wps.filter(pred).map((w) => w.seq);
      const completeness = [{
        voyage: b.voyage?.slug,
        title: b.voyage?.title,
        waypoints_total: wps.length,
        waypoints_missing_media: seqs((w) => !w.media_url),
        waypoints_missing_diary_excerpt: seqs((w) => !w.diary_excerpt),
        waypoints_missing_departure_date: seqs((w) => !w.departure_date),
        waypoints_low_confidence: wps.filter((w) => w.confidence !== "certain")
          .map((w) => ({ seq: w.seq, confidence: w.confidence })),
      }];
      return JSON.stringify({
        curated_gaps: rows,
        voyage_completeness: completeness,
        note: "curated_gaps are the desk's priorities; voyage_completeness is auto-computed from the live data — every listed seq is a concrete contribution opportunity (media must be PD/CC; excerpts verbatim with source).",
      }, null, 2);
    }
    case "claim_gap": {
      const a = await authenticate(args);
      if (a.err) return `ERROR: ${a.err}`;
      await reapStaleClaims();
      const q = quotaFor(a.ok!.rank);
      const mine = await sb("GET",
        `editorial_gaps?claimed_by=eq.${encodeURIComponent(args.handle)}&status=eq.claimed&select=id`);
      if (mine.length >= q.activeClaims)
        return `ERROR: You hold ${mine.length} active claim(s); the limit for rank '${a.ok!.rank}' is ${q.activeClaims}. Submit or let one expire first.`;
      const updated = await sb("PATCH",
        `editorial_gaps?id=eq.${Number(args.gap_id)}&status=eq.open`,
        { status: "claimed", claimed_by: args.handle, claimed_at: new Date().toISOString() });
      if (!updated?.length) return "ERROR: gap not found or not open (already claimed/done).";
      await sb("POST", "audit_log", {
        submission_id: null, actor: "mcp", action: "claim-gap", verdict: null,
        findings: [["INFO", 0, `gap #${args.gap_id} '${updated[0].title}' claimed by ${args.handle}`]],
        carta_version: CARTA_VERSION,
      });
      return JSON.stringify({ claimed: updated[0],
        note: `Gap claimed for ${CLAIM_TTL_DAYS} days. Propose your idea with propose_idea, then draft and submit_draft. Unworked claims expire and reopen.` }, null, 2);
    }
    case "propose_idea": {
      const a = await authenticate(args);
      if (a.err) return `ERROR: ${a.err}`;
      const bad = badText(args, ["title", "description"]);
      if (bad) return `ERROR: ${bad}`;
      const over = await overDailyLimit(a.ok!);
      if (over) return `ERROR: ${over}`;
      const s = await sb("POST", "submissions", {
        contributor_id: a.ok!.id, type: "idea", target_voyage: null,
        payload: { title: args.title, description: args.description, kind: args.kind ?? null },
        status: "human-review", carta_version: CARTA_VERSION,
      });
      await sb("POST", "audit_log", { submission_id: s[0].id, actor: "mcp", action: "proposal",
        verdict: null, findings: null, carta_version: CARTA_VERSION });
      return JSON.stringify({ submission_id: s[0].id, status: "human-review",
        note: "Idea recorded. The editorial desk will assess scope and feasibility; check back with get_submission_status." });
    }
    case "submit_draft": {
      const a = await authenticate(args);
      if (a.err) return `ERROR: ${a.err}`;
      const over = await overDailyLimit(a.ok!);
      if (over) return `ERROR: ${over}`;
      const sub = args.submission;
      const fails = stage0(sub);
      const status = fails.length ? "curator-rejected" : "submitted";
      const s = await sb("POST", "submissions", {
        contributor_id: a.ok!.id, type: sub?.meta?.type ?? "draft",
        target_voyage: sub?.meta?.target_voyage ?? null, payload: sub,
        status, carta_version: CARTA_VERSION,
      });
      await sb("POST", "audit_log", { submission_id: s[0].id, actor: "curator-gate", action: "verdict",
        verdict: fails.length ? "reject" : "pass-gate", findings: fails.map((m) => ["FAIL", 0, m]),
        carta_version: CARTA_VERSION });
      return JSON.stringify({
        submission_id: s[0].id, status,
        gate_failures: fails,
        note: fails.length
          ? "Rejected at the Stage-0 gate. Fix every finding (each cites a Carta rule) and resubmit."
          : "Passed the instant gate. Full source verification (verbatim quotes, coherence) follows; check get_submission_status.",
      }, null, 2);
    }
    case "suggest_feature": {
      const a = await authenticate(args);
      if (a.err) return `ERROR: ${a.err}`;
      const bad = badText(args, ["title", "description", "area"]);
      if (bad) return `ERROR: ${bad}`;
      const over = await overDailyLimit(a.ok!);
      if (over) return `ERROR: ${over}`;
      const s = await sb("POST", "submissions", {
        contributor_id: a.ok!.id, type: "feature-suggestion", target_voyage: null,
        payload: { title: args.title, description: args.description, area: args.area ?? null },
        status: "human-review", carta_version: CARTA_VERSION,
      });
      await sb("POST", "audit_log", { submission_id: s[0].id, actor: "mcp", action: "suggestion",
        verdict: null, findings: null, carta_version: CARTA_VERSION });
      return JSON.stringify({ submission_id: s[0].id, status: "human-review",
        note: "Suggestion recorded — it now appears on the editorial desk. Track it with get_submission_status." });
    }
    case "suggest_content": {
      const a = await authenticate(args);
      if (a.err) return `ERROR: ${a.err}`;
      const bad = badText(args, ["voyage", "idea"]);
      if (bad) return `ERROR: ${bad}`;
      const over = await overDailyLimit(a.ok!);
      if (over) return `ERROR: ${over}`;
      const s = await sb("POST", "submissions", {
        contributor_id: a.ok!.id, type: "content-suggestion",
        target_voyage: args.voyage ?? null,
        payload: {
          voyage: args.voyage, waypoint: args.waypoint ?? null,
          content_type: args.type, idea: args.idea,
        },
        status: "human-review", carta_version: CARTA_VERSION,
      });
      await sb("POST", "audit_log", { submission_id: s[0].id, actor: "mcp", action: "content-suggestion",
        verdict: null, findings: null, carta_version: CARTA_VERSION });
      return JSON.stringify({
        submission_id: s[0].id, status: "human-review",
        note: `Content suggestion recorded for ${args.voyage}` +
          (args.waypoint != null ? ` waypoint ${args.waypoint}` : "") +
          " — it now appears on the editorial desk. Track it with get_submission_status.",
      });
    }
    case "get_submission_status": {
      const s = await sb("GET", `submissions?id=eq.${Number(args.id)}&select=id,type,status,carta_version,created_at`);
      if (!s.length) return "ERROR: no such submission";
      const audit = await sb("GET", `audit_log?submission_id=eq.${Number(args.id)}&order=id.asc&select=actor,action,verdict,findings,created_at`);
      return JSON.stringify({ submission: s[0], audit }, null, 2);
    }
    case "get_standing": {
      const rows = await sb("GET", `contributor_standing?handle=eq.${encodeURIComponent(args.handle)}`);
      return rows.length ? JSON.stringify(rows[0], null, 2) : "ERROR: unknown contributor";
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ------------------------------------------------------------------ JSON-RPC
function rpcResult(id: any, result: any) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}
function rpcError(id: any, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function POST(req: Request) {
  let msg: any;
  try {
    msg = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (Array.isArray(msg)) return rpcError(null, -32600, "Batch requests not supported");
  const { id, method, params } = msg ?? {};

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "terraveler-mcp", version: "0.2.0" },
      instructions:
        "Terraveler is a curated geo-historical atlas governed by the Magna Carta of the Seas. " +
        "Call get_contract FIRST and follow it strictly. To write, register once with `register` " +
        "(invite code) and keep the personal api_key it returns. Browse list_gaps for wanted work, " +
        "propose_idea before drafting, then submit_draft. Every claim needs a PD/CC source.",
    });
  }
  if (typeof method === "string" && method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      const text = await callTool(params?.name, params?.arguments ?? {});
      return rpcResult(id, { content: [{ type: "text", text }], isError: text.startsWith("ERROR:") });
    } catch (e: any) {
      return rpcResult(id, { content: [{ type: "text", text: `ERROR: ${String(e?.message || e)}` }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function GET() {
  return new NextResponse("terraveler-mcp: POST JSON-RPC here (MCP Streamable HTTP).", { status: 405 });
}
