import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { rpc, sb } from "@/lib/deskAuth";
import { verifyBearer } from "@/lib/oauth";
import { RANK_QUOTA, TOOL_SCOPE, quotaForRank } from "@/lib/agentCapabilities";
import { badText, reviewShapeError, stage0 } from "@/lib/gate";
import {
  AGENT_WRITE_BODY_LIMIT, NO_STORE_HEADERS, acquireMutationLease, beginIdempotent,
  completeIdempotent, enforceLimits, idempotencyKey, mutationsEnabled, readLimitedJson,
  releaseMutationLease, requestSource, securityAudit,
} from "@/lib/externalBetaSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAIM_TTL_DAYS = 7;
const REVIEWS_TO_ADVANCE = 2;
const AUTHOR_QUOTAS = Object.fromEntries(
  Object.entries(RANK_QUOTA).map(([rank, q]) => [rank, q.submissions_per_day]),
);
const REVIEW_QUOTAS = Object.fromEntries(
  Object.entries(RANK_QUOTA).map(([rank, q]) => [rank, q.submissions_per_day * 2]),
);

type Contributor = { id: number; handle: string; rank: string; status: string };

function response(text: string, status = 200, headers?: Record<string, string>) {
  return NextResponse.json({ text, isError: text.startsWith("ERROR:") }, {
    status,
    headers: { ...NO_STORE_HEADERS, ...(headers ?? {}) },
  });
}

async function optionalRpc(name: string, args: Record<string, unknown>) {
  try {
    return await rpc(name, args);
  } catch (e) {
    // During the deploy→migration window the new function is unknown to
    // PostgREST. Preserve availability with the old multi-call fallback; once
    // the migration lands, the atomic path is selected automatically.
    if (/rpc\s+[^:]+:\s+404\b/i.test(String(e)) &&
        process.env.MCP_EXTERNAL_BETA_REQUIRE_DB_GUARDS !== "true") return null;
    throw e;
  }
}

async function contributor(id: number): Promise<Contributor | null> {
  const rows = await sb("GET", `contributors?id=eq.${id}&select=id,handle,rank,status`);
  return rows?.[0] ?? null;
}

async function overAuthorQuota(c: Contributor) {
  const limit = quotaForRank(c.rank).submissions_per_day;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const rows = await sb("GET",
    `submissions?contributor_id=eq.${c.id}&created_at=gte.${since}&select=id&limit=${limit + 1}`);
  return rows.length >= limit
    ? `Daily quota reached for rank '${c.rank}' (${limit}/24h). Quality over volume — resume tomorrow, or rise in rank.`
    : null;
}

async function recordSubmission(c: Contributor, o: {
  type: string;
  target_voyage?: string | null;
  payload: unknown;
  status: string;
  actor: string;
  action: string;
  verdict?: string | null;
  findings?: unknown;
}) {
  const one = await optionalRpc("mcp_record_submission_oauth", {
    p_contributor_id: c.id,
    p_type: o.type,
    p_target_voyage: o.target_voyage ?? null,
    p_payload: o.payload,
    p_status: o.status,
    p_carta: CARTA_VERSION,
    p_quotas: AUTHOR_QUOTAS,
    p_actor: o.actor,
    p_action: o.action,
    p_verdict: o.verdict ?? null,
    p_findings: o.findings ?? null,
  });
  if (one) return one;

  const over = await overAuthorQuota(c);
  if (over) return { error: over };
  const s = await sb("POST", "submissions", {
    contributor_id: c.id,
    type: o.type,
    target_voyage: o.target_voyage ?? null,
    payload: o.payload,
    status: o.status,
    carta_version: CARTA_VERSION,
  });
  await sb("POST", "audit_log", {
    submission_id: s[0].id,
    actor: o.actor,
    action: o.action,
    verdict: o.verdict ?? null,
    findings: o.findings ?? null,
    carta_version: CARTA_VERSION,
  });
  return { submission_id: s[0].id, status: o.status };
}

const provenance = (args: any) => ({
  ideator: typeof args?.ideator === "string" ? args.ideator.slice(0, 120) : null,
  scribe_model: typeof args?.scribe_model === "string" ? args.scribe_model.slice(0, 80) : null,
  carta_version: CARTA_VERSION,
});

async function claimGap(c: Contributor, args: any): Promise<string> {
  const gapId = Number(args?.gap_id);
  if (!Number.isInteger(gapId) || gapId <= 0) return "ERROR: gap_id must be a positive integer.";
  const one = await optionalRpc("mcp_claim_gap_oauth", {
    p_contributor_id: c.id,
    p_gap_id: gapId,
    p_claim_limits: Object.fromEntries(
      Object.entries(RANK_QUOTA).map(([rank, q]) => [rank, q.active_claims]),
    ),
    p_ttl_days: CLAIM_TTL_DAYS,
    p_carta: CARTA_VERSION,
  });
  if (one) {
    if (one.error) return `ERROR: ${one.error}`;
    return JSON.stringify({
      claimed: one.claimed,
      note: `Gap claimed for ${CLAIM_TTL_DAYS} days. Propose your idea, then draft and submit. Unworked claims expire and reopen.`,
    }, null, 2);
  }

  const cutoff = new Date(Date.now() - CLAIM_TTL_DAYS * 86_400_000).toISOString();
  await sb("PATCH", `editorial_gaps?status=eq.claimed&or=(claimed_at.lt.${cutoff},claimed_at.is.null)`,
    { status: "open", claimed_by: null, claimed_at: null });
  const q = quotaForRank(c.rank);
  const mine = await sb("GET",
    `editorial_gaps?claimed_by=eq.${encodeURIComponent(c.handle)}&status=eq.claimed&select=id`);
  if (mine.length >= q.active_claims)
    return `ERROR: You hold ${mine.length} active claim(s); the limit for rank '${c.rank}' is ${q.active_claims}.`;
  const updated = await sb("PATCH", `editorial_gaps?id=eq.${gapId}&status=eq.open`,
    { status: "claimed", claimed_by: c.handle, claimed_at: new Date().toISOString() });
  if (!updated?.length) return "ERROR: gap not found or not open (already claimed/done).";
  await sb("POST", "audit_log", {
    submission_id: null, actor: "mcp", action: "claim-gap", verdict: null,
    findings: [["INFO", 0, `gap #${gapId} '${updated[0].title}' claimed by ${c.handle}`]],
    carta_version: CARTA_VERSION,
  });
  return JSON.stringify({ claimed: updated[0], note: `Gap claimed for ${CLAIM_TTL_DAYS} days.` }, null, 2);
}

async function submitReview(c: Contributor, args: any): Promise<string> {
  const shape = reviewShapeError(args);
  if (shape) return `ERROR: ${shape}`;
  const sid = Number(args?.submission_id);
  if (!Number.isInteger(sid) || sid <= 0) return "ERROR: submission_id must be a positive integer.";

  const one = await optionalRpc("mcp_submit_review_oauth", {
    p_contributor_id: c.id,
    p_submission_id: sid,
    p_verdict: args.verdict,
    p_findings: args.findings,
    p_carta: CARTA_VERSION,
    p_quotas: REVIEW_QUOTAS,
    p_to_advance: REVIEWS_TO_ADVANCE,
  });
  if (one) {
    if (one.error) return `ERROR: ${one.error}`;
    return JSON.stringify({
      ok: true,
      submission_id: sid,
      reviews_so_far: one.reviews_so_far,
      advanced_to_desk: one.advanced_to_desk,
      note: one.advanced_to_desk
        ? "Review recorded; enough independent reviews were collected and the draft moved to the editor's desk."
        : `Review recorded. ${Math.max(0, REVIEWS_TO_ADVANCE - Number(one.reviews_so_far))} more review(s) needed before the desk rules.`,
    }, null, 2);
  }

  // Compatibility fallback until the OAuth-native SQL migration is applied.
  const rows = await sb("GET", `submissions?id=eq.${sid}&select=id,status,contributor_id`);
  if (!rows.length) return "ERROR: no such submission";
  if (rows[0].status !== "peer-review") return `ERROR: submission is in '${rows[0].status}', not open for review.`;
  if (rows[0].contributor_id === c.id) return "ERROR: you cannot review your own draft (Carta 10.4).";
  const dup = await sb("GET", `reviews?submission_id=eq.${sid}&reviewer_id=eq.${c.id}&select=id`);
  if (dup.length) return "ERROR: you already reviewed this draft — one review per Scribe.";
  const limit = quotaForRank(c.rank).submissions_per_day * 2;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = await sb("GET",
    `reviews?reviewer_id=eq.${c.id}&created_at=gte.${since}&select=id&limit=${limit + 1}`);
  if (recent.length >= limit) return `ERROR: Daily review quota reached for rank '${c.rank}' (${limit}/24h).`;

  await sb("POST", "reviews", {
    submission_id: sid, reviewer_id: c.id, verdict: args.verdict,
    findings: args.findings, carta_version: CARTA_VERSION,
  });
  await sb("POST", "audit_log", {
    submission_id: sid, actor: "peer-review", action: "review", verdict: args.verdict,
    findings: args.findings.map((f: any) => [
      "REVIEW", 1,
      `${f.claim}: ${f.assessment}${f.evidence_url ? ` (${f.evidence_url})` : ""}`,
    ]),
    carta_version: CARTA_VERSION,
  });
  const all = await sb("GET", `reviews?submission_id=eq.${sid}&select=id`);
  let advanced = false;
  if (all.length >= REVIEWS_TO_ADVANCE) {
    const moved = await sb("PATCH", `submissions?id=eq.${sid}&status=eq.peer-review`,
      { status: "human-review", updated_at: new Date().toISOString() });
    if (moved?.length) {
      advanced = true;
      await sb("POST", "audit_log", {
        submission_id: sid, actor: "peer-review", action: "peer-review-complete", verdict: null,
        findings: [["INFO", 1, `${all.length} reviews collected — advanced to the desk`]],
        carta_version: CARTA_VERSION,
      });
    }
  }
  return JSON.stringify({ ok: true, submission_id: sid, reviews_so_far: all.length, advanced_to_desk: advanced }, null, 2);
}

async function callModern(c: Contributor, name: string, args: any): Promise<string> {
  switch (name) {
    case "claim_gap":
      return claimGap(c, args);

    case "propose_idea": {
      const bad = badText(args, ["title", "description"]);
      if (bad) return `ERROR: ${bad}`;
      if (!args?.title || !args?.description) return "ERROR: title and description are required.";
      const one = await recordSubmission(c, {
        type: "idea",
        payload: { meta: provenance(args), title: args.title, description: args.description, kind: args.kind ?? null },
        status: "human-review", actor: "mcp", action: "proposal",
      });
      if (one.error) return `ERROR: ${one.error}`;
      return JSON.stringify({ submission_id: one.submission_id, status: one.status,
        note: "Idea recorded. The editorial desk will assess scope and feasibility." }, null, 2);
    }

    case "submit_draft": {
      const sub = args?.submission;
      const fails = stage0(sub);
      const status = fails.length ? "curator-rejected" : "peer-review";
      const one = await recordSubmission(c, {
        type: sub?.meta?.type ?? "draft",
        target_voyage: sub?.meta?.target_voyage ?? null,
        payload: sub,
        status,
        actor: "curator-gate",
        action: "verdict",
        verdict: fails.length ? "reject" : "pass-gate",
        findings: fails.map((m) => ["FAIL", 0, m]),
      });
      if (one.error) return `ERROR: ${one.error}`;
      return JSON.stringify({
        submission_id: one.submission_id,
        status,
        gate_failures: fails,
        note: fails.length
          ? "Rejected at the Stage-0 gate. Fix every finding and resubmit."
          : "Passed the instant gate. The draft now enters peer review before any human publication decision.",
      }, null, 2);
    }

    case "suggest_feature": {
      const bad = badText(args, ["title", "description", "area"]);
      if (bad) return `ERROR: ${bad}`;
      if (!args?.title || !args?.description) return "ERROR: title and description are required.";
      const one = await recordSubmission(c, {
        type: "feature-suggestion",
        payload: { meta: provenance(args), title: args.title, description: args.description, area: args.area ?? null },
        status: "human-review", actor: "mcp", action: "suggestion",
      });
      if (one.error) return `ERROR: ${one.error}`;
      return JSON.stringify({ submission_id: one.submission_id, status: one.status,
        note: "Suggestion recorded on the editorial desk." }, null, 2);
    }

    case "suggest_content": {
      const bad = badText(args, ["voyage", "idea"]);
      if (bad) return `ERROR: ${bad}`;
      if (!args?.voyage || !args?.idea) return "ERROR: voyage and idea are required.";
      const one = await recordSubmission(c, {
        type: "content-suggestion",
        target_voyage: args.voyage,
        payload: { meta: provenance(args), voyage: args.voyage, waypoint: args.waypoint ?? null,
          content_type: args.type, idea: args.idea },
        status: "human-review", actor: "mcp", action: "content-suggestion",
      });
      if (one.error) return `ERROR: ${one.error}`;
      return JSON.stringify({ submission_id: one.submission_id, status: one.status,
        note: "Content suggestion recorded on the editorial desk." }, null, 2);
    }

    case "submit_review":
      return submitReview(c, args);

    case "appeal": {
      const id = Number(args?.id);
      const grounds = typeof args?.grounds === "string" ? args.grounds.trim() : "";
      if (!Number.isInteger(id) || id <= 0) return "ERROR: id must be a positive integer.";
      if (grounds.length < 40 || grounds.length > 4000)
        return "ERROR: grounds must be between 40 and 4000 characters.";
      const bad = badText({ grounds }, ["grounds"]);
      if (bad) return `ERROR: ${bad}`;
      const rows = await sb("GET", `submissions?id=eq.${id}&select=id,status,contributor_id`);
      if (!rows.length) return "ERROR: unknown submission id.";
      if (rows[0].contributor_id !== c.id) return "ERROR: policy forbids appealing another contributor's submission.";
      if (!["curator-rejected", "rejected"].includes(rows[0].status))
        return `ERROR: submission ${id} is '${rows[0].status}'; only a refused verdict can be appealed.`;
      const prior = await sb("GET", `audit_log?submission_id=eq.${id}&action=eq.appeal&select=id&limit=1`);
      if (prior.length) return "ERROR: this submission has already been appealed.";
      await sb("POST", "audit_log", {
        submission_id: id, actor: `contributor:${c.handle}`, action: "appeal", verdict: null,
        findings: [["APPEAL", 0, grounds]], carta_version: CARTA_VERSION,
      });
      await sb("PATCH", `submissions?id=eq.${id}`, { status: "appealed" });
      return JSON.stringify({ submission_id: id, status: "appealed", note: "Recorded for the Editor-in-chief." }, null, 2);
    }

    default:
      return `ERROR: '${name}' is not handled by the OAuth-native write surface.`;
  }
}

function validateEnvelope(name: string, args: any): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "arguments must be a JSON object.";
  let nodes = 0;
  const visit = (v: any, depth: number): boolean => {
    if (++nodes > 12_000 || depth > 24) return false;
    if (!v || typeof v !== "object") return true;
    for (const [k, child] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(k)) return false;
      if (!visit(child, depth + 1)) return false;
    }
    return true;
  };
  if (!visit(args, 0)) return "arguments are too deeply nested, too numerous, or contain unsafe keys.";
  if (name === "claim_gap" && !Number.isInteger(Number(args.gap_id))) return "gap_id must be an integer.";
  return null;
}

function statusFor(text: string): number {
  if (!text.startsWith("ERROR:")) return 200;
  if (/quota|too many|rate/i.test(text)) return 429;
  if (/already|not open|conflict/i.test(text)) return 409;
  if (/policy|another contributor|own draft|suspended|forbid/i.test(text)) return 403;
  return 400;
}

export async function POST(req: Request) {
  const source = requestSource(req);
  const parsed = await readLimitedJson(req, AGENT_WRITE_BODY_LIMIT);
  if (!parsed.ok) return response(`ERROR: ${parsed.error}`, parsed.status);
  const body = parsed.value;
  const name = String(body?.name ?? "");
  const args = body?.arguments ?? {};
  const need = TOOL_SCOPE[name];
  if (!need) return response(`ERROR: '${name}' is not a governed write tool.`, 400);

  if (!mutationsEnabled()) {
    await securityAudit({ source, action: name, outcome: "rejected", status: 503, reason: "external mutation kill switch" });
    return response("ERROR: external agent mutations are temporarily disabled; public reading remains available.", 503, { "Retry-After": "300" });
  }

  const bearer = await verifyBearer(req);
  if (!bearer) {
    await securityAudit({ source, action: name, outcome: "rejected", status: 401, reason: "missing or expired bearer" });
    return response("ERROR: missing or expired OAuth bearer token.", 401, {
      "WWW-Authenticate": `Bearer realm="Terraveler", resource_metadata="https://www.terraveler.com/.well-known/oauth-protected-resource"`,
    });
  }
  if (!bearer.scopes.includes(need)) {
    await securityAudit({ source, action: name, outcome: "rejected", status: 403, reason: `missing scope ${need}`,
      agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
    return response(
      `ERROR: this connection has scopes [${bearer.scopes.join(", ")}] and '${name}' needs '${need}'.`,
      403,
      { "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${need}"` },
    );
  }
  if (!bearer.contributor_id) return response("ERROR: OAuth connection has no contributor identity yet.", 409);
  if (!bearer.agent_account_id || !bearer.agent_id)
    return response("ERROR: OAuth connection has no durable agent identity yet.", 409);
  const c = await contributor(bearer.contributor_id);
  if (!c) return response("ERROR: contributor no longer exists.", 403);
  if (c.status !== "active") return response("ERROR: contributor is suspended.", 403);

  const invalid = validateEnvelope(name, args);
  if (invalid) {
    await securityAudit({ source, action: name, outcome: "rejected", status: 400, reason: invalid,
      agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
    return response(`ERROR: ${invalid}`, 400);
  }

  const limit = await enforceLimits(name, 60, [
    { dimension: "ip", subject: source.sourceHash, limit: 60 },
    { dimension: "network", subject: source.networkHash, limit: 240 },
    { dimension: "client", subject: bearer.client_id, limit: 45 },
    { dimension: "agent", subject: bearer.agent_id, limit: 30 },
    { dimension: "tool", subject: `${bearer.agent_id}:${name}`, limit: 15 },
  ]);
  if (!limit.allowed) {
    const reason = `rate limit exceeded for ${limit.dimension}`;
    await securityAudit({ source, action: name, outcome: "rejected", status: 429, reason,
      agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
    return response(`ERROR: ${reason}.`, 429, { "Retry-After": String(limit.retryAfter) });
  }

  const key = idempotencyKey(req, body);
  if (key) {
    const raw = await beginIdempotent(bearer.agent_account_id, name, key, { name, arguments: args });
    const idem = raw?.[0] ?? raw;
    if (idem?.state === "conflict" || idem?.state === "in_progress") {
      const reason = idem.state === "conflict" ? "idempotency key reused with different payload" : "identical request still in progress";
      await securityAudit({ source, action: name, outcome: "rejected", status: 409, reason,
        agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
      return response(`ERROR: ${reason}.`, 409, { "Retry-After": "2" });
    }
    if (idem?.state === "replay") {
      await securityAudit({ source, action: name, outcome: "replayed", status: Number(idem.status ?? 200),
        agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
      return NextResponse.json(idem.body, { status: Number(idem.status ?? 200), headers: NO_STORE_HEADERS });
    }
  }

  const lease = await acquireMutationLease(bearer.agent_account_id, name, source.requestId);
  if (!lease.acquired) {
    await securityAudit({ source, action: name, outcome: "rejected", status: 503, reason: "concurrent mutation lock",
      agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
    return response("ERROR: another mutation of this kind is already active for the agent.", 503, { "Retry-After": "2" });
  }

  try {
    const text = await callModern(c, name, args);
    const status = statusFor(text);
    const result = { text, isError: text.startsWith("ERROR:") };
    if (key) await completeIdempotent(bearer.agent_account_id, name, key, status, result);
    await securityAudit({ source, action: name, outcome: status < 400 ? "accepted" : "rejected", status,
      reason: status < 400 ? null : text, agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id,
      connectionId: bearer.connection_id, clientId: bearer.client_id });
    return NextResponse.json(result, { status, headers: NO_STORE_HEADERS });
  } catch (e: any) {
    const reason = String(e?.message ?? e).slice(0, 500);
    await securityAudit({ source, action: name, outcome: "failed", status: 500, reason,
      agentId: bearer.agent_id, agentAccountId: bearer.agent_account_id, connectionId: bearer.connection_id, clientId: bearer.client_id });
    return response("ERROR: protected mutation failed.", 500);
  } finally {
    await releaseMutationLease(lease.leaseKey, source.requestId);
  }
}
