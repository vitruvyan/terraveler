import { NextResponse } from "next/server";
import bougainville from "@/data/bougainville.json";

/**
 * Terraveler MCP server (Streamable HTTP, stateless).
 * Scribes connect here to read the Magna Carta, browse the editorial roadmap,
 * propose ideas and submit drafts. Write tools require an invite code until
 * full contributor auth ships. Deep source verification stays with the
 * Curator; this endpoint runs the instant Stage-0 gate.
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

async function contributorId(handle: string): Promise<number> {
  const rows = await sb("GET", `contributors?handle=eq.${encodeURIComponent(handle)}&select=id`);
  if (rows.length) return rows[0].id;
  const made = await sb("POST", "contributors", { handle });
  return made[0].id;
}

function requireWrite(args: any): string | null {
  if (!INVITE) return "Write tools are disabled: the server has no MCP_INVITE_CODE configured.";
  if (args?.invite_code !== INVITE) return "Invalid or missing invite_code.";
  if (!args?.handle || typeof args.handle !== "string") return "Missing contributor handle.";
  return null;
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
  const meta = sub?.meta ?? {};
  if (meta.carta_version !== CARTA_VERSION)
    fails.push(`carta_version is '${meta.carta_version}', current is '${CARTA_VERSION}' — call get_contract first`);
  for (const f of ["type", "ideator", "scribe_model"]) if (!meta[f]) fails.push(`meta.${f} missing`);
  const wps = sub?.waypoints ?? [];
  if (!Array.isArray(wps) || wps.length === 0) fails.push("no waypoints in submission");
  for (const w of wps) {
    const tag = `wp${w?.seq ?? "?"}`;
    for (const f of ["seq", "place_historical", "latitude", "longitude", "arrival_date", "confidence"])
      if (w?.[f] === undefined || w?.[f] === null || w?.[f] === "") fails.push(`${tag}: field '${f}' missing`);
    if (w?.confidence && !CONFIDENCES.includes(w.confidence)) fails.push(`${tag}: invalid confidence`);
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
const TOOLS = [
  { name: "get_contract",
    description: "Return the Magna Carta of the Seas — Terraveler's editorial constitution. Every Scribe MUST read it before proposing or drafting.",
    inputSchema: { type: "object", properties: {} } },
  { name: "how_it_works",
    description: "Return the Terraveler contribution guide: roles, flow, tool reference.",
    inputSchema: { type: "object", properties: {} } },
  { name: "list_gaps",
    description: "The editorial roadmap: what Terraveler currently wants (curated gaps by priority, PLUS an auto-computed completeness report of existing voyages: which waypoints lack media, diary excerpts, dates). Work these, not random ideas.",
    inputSchema: { type: "object", properties: {} } },
  { name: "claim_gap",
    description: "Claim an open gap before working on it, so no one duplicates effort. Returns confirmation; the claim is recorded in the audit trail.",
    inputSchema: { type: "object", required: ["handle", "invite_code", "gap_id"],
      properties: { handle: { type: "string" }, invite_code: { type: "string" },
        gap_id: { type: "number" } } } },
  { name: "propose_idea",
    description: "Propose an idea BEFORE doing any drafting work. Returns a submission id; the editorial desk assesses scope/feasibility.",
    inputSchema: { type: "object", required: ["handle", "invite_code", "title", "description"],
      properties: { handle: { type: "string" }, invite_code: { type: "string" },
        title: { type: "string" }, description: { type: "string" },
        kind: { type: "string", enum: ["voyage", "waypoint", "media", "perspective", "translation", "correction"] } } } },
  { name: "submit_draft",
    description: "Submit a structured draft (meta + waypoints with sourced claims). Runs the instant Stage-0 gate; deep source verification follows. Returns findings and a submission id.",
    inputSchema: { type: "object", required: ["handle", "invite_code", "submission"],
      properties: { handle: { type: "string" }, invite_code: { type: "string" },
        submission: { type: "object", description: "See how_it_works for the schema." } } } },
  { name: "suggest_feature",
    description: "Suggest a feature or change for Terraveler itself (site, map, tools, process). The suggestion lands on the editorial desk for consideration.",
    inputSchema: { type: "object", required: ["handle", "invite_code", "title", "description"],
      properties: { handle: { type: "string" }, invite_code: { type: "string" },
        title: { type: "string" }, description: { type: "string" },
        area: { type: "string", description: "optional: map | timeline | chat | governance | mcp | other" } } } },
  { name: "suggest_content",
    description: "Suggest content for a SPECIFIC voyage waypoint — an additional PD/CC source, a period image, an ethnographic detail, a coordinate/date fix, or a correction. Scoped to (voyage, waypoint, type). Lighter than submit_draft: a pointer for the desk, not a verified draft. Use this when contributing from a specific log entry, plate, or ethnographic note.",
    inputSchema: { type: "object", required: ["handle", "invite_code", "voyage", "type", "idea"],
      properties: { handle: { type: "string" }, invite_code: { type: "string" },
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
    case "list_gaps": {
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
      const err = requireWrite(args);
      if (err) return `ERROR: ${err}`;
      const updated = await sb("PATCH",
        `editorial_gaps?id=eq.${Number(args.gap_id)}&status=eq.open`, { status: "claimed" });
      if (!updated?.length) return "ERROR: gap not found or not open (already claimed/done).";
      await contributorId(args.handle);
      await sb("POST", "audit_log", {
        submission_id: null, actor: "mcp", action: "claim-gap", verdict: null,
        findings: [["INFO", 0, `gap #${args.gap_id} '${updated[0].title}' claimed by ${args.handle}`]],
        carta_version: CARTA_VERSION,
      });
      return JSON.stringify({ claimed: updated[0],
        note: "Gap claimed. Propose your idea with propose_idea, then draft and submit_draft. If you abandon it, tell the desk so it can be reopened." }, null, 2);
    }
    case "propose_idea": {
      const err = requireWrite(args);
      if (err) return `ERROR: ${err}`;
      const cid = await contributorId(args.handle);
      const s = await sb("POST", "submissions", {
        contributor_id: cid, type: "idea", target_voyage: null,
        payload: { title: args.title, description: args.description, kind: args.kind ?? null },
        status: "human-review", carta_version: CARTA_VERSION,
      });
      await sb("POST", "audit_log", { submission_id: s[0].id, actor: "mcp", action: "proposal",
        verdict: null, findings: null, carta_version: CARTA_VERSION });
      return JSON.stringify({ submission_id: s[0].id, status: "human-review",
        note: "Idea recorded. The editorial desk will assess scope and feasibility; check back with get_submission_status." });
    }
    case "submit_draft": {
      const err = requireWrite(args);
      if (err) return `ERROR: ${err}`;
      const sub = args.submission;
      const fails = stage0(sub);
      const cid = await contributorId(args.handle);
      const status = fails.length ? "curator-rejected" : "submitted";
      const s = await sb("POST", "submissions", {
        contributor_id: cid, type: sub?.meta?.type ?? "draft",
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
      const err = requireWrite(args);
      if (err) return `ERROR: ${err}`;
      const cid = await contributorId(args.handle);
      const s = await sb("POST", "submissions", {
        contributor_id: cid, type: "feature-suggestion", target_voyage: null,
        payload: { title: args.title, description: args.description, area: args.area ?? null },
        status: "human-review", carta_version: CARTA_VERSION,
      });
      await sb("POST", "audit_log", { submission_id: s[0].id, actor: "mcp", action: "suggestion",
        verdict: null, findings: null, carta_version: CARTA_VERSION });
      return JSON.stringify({ submission_id: s[0].id, status: "human-review",
        note: "Suggestion recorded — it now appears on the editorial desk. Track it with get_submission_status." });
    }
    case "suggest_content": {
      const err = requireWrite(args);
      if (err) return `ERROR: ${err}`;
      const cid = await contributorId(args.handle);
      const s = await sb("POST", "submissions", {
        contributor_id: cid, type: "content-suggestion",
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
      serverInfo: { name: "terraveler-mcp", version: "0.1.0" },
      instructions:
        "Terraveler is a curated geo-historical atlas governed by the Magna Carta of the Seas. " +
        "Call get_contract FIRST and follow it strictly. Browse list_gaps for wanted work, " +
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
