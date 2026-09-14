import { NextResponse } from "next/server";
import { requireEditor, sb, rpc, editorEmail } from "@/lib/deskAuth";
import { CARTA_VERSION } from "@/lib/carta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Source governance queue: what the human editor can act on, and what is
 * already settled. Two calls fixed a real production bug on the way here —
 * this route used to read raw SUPABASE_URL/SUPABASE_SERVICE_KEY directly
 * (empty on Vercel; the canonical names are POSTGREST_URL/
 * POSTGREST_SERVICE_KEY via lib/backendConfig, which sb()/rpc() already use)
 * and never queried source_proposals at all — an agent could suggest a
 * source and it would sit at status='submitted', invisible here, forever.
 */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  try {
    const pending = await sb("GET",
      "source_proposals?status=eq.submitted&select=id,target_url,proposed_by_actor_type," +
      "proposed_by_actor_id,endpoint_id,source_proposal_intents(voyage,waypoint,region,person,reason)");

    const resolved = await sb("GET",
      "source_policy_decisions?order=timestamp.desc&limit=20&select=id,decision_outcome,trust_mode," +
      "rights_class,reason,timestamp,proposal_id,endpoint_id," +
      "source_endpoints(host_pattern),source_proposals(target_url)");

    const endpoints = await sb("GET",
      "source_endpoints?status=in.(needs_human_review,quarantined)&select=id,host_pattern,match_type,status,trust_mode,last_verified_at");

    const drifts = await sb("GET",
      "source_drift_evaluations?drift_detected=eq.true&select=id,reverification_id,subject_type,subject_id,drift_class,drift_codes,old_material_fingerprint,new_material_fingerprint,recommended_action,created_at&order=created_at.desc&limit=20");

    return NextResponse.json({
      success: true,
      queue: {
        pending_proposals: pending,
        recent_decisions: resolved,
        review_required_endpoints: endpoints,
        recent_material_drifts: drifts,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to query governance queue: ${e.message}` }, { status: 500 });
  }
}

const RIGHTS_CLASSES = ["public_domain", "creative_commons", "mixed", "in_copyright", "unknown"];
const TRUST_MODES = ["domain_trusted", "collection_trusted", "item_verified", "link_only"];

/**
 * Resolve one pending source proposal. The minimal counterpart to the
 * automated Archivist investigation the original design named but that was
 * never built: a human reads the proposal's own stated reason and rules
 * directly, the same authority §2 already gives the Editor-in-chief over a
 * submission. mcp_resolve_source_proposal.sql owns the atomicity (one
 * append-only source_policy_decisions row, the proposal resolved with it).
 */
export async function POST(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { proposal_id, decision, trust_mode, rights_class, reason } = await req.json().catch(() => ({}));
  if (!proposal_id || !["approve", "reject"].includes(String(decision))) {
    return NextResponse.json({ error: "proposal_id and decision (approve|reject) required" }, { status: 400 });
  }
  if (!reason || !String(reason).trim()) {
    return NextResponse.json({ error: "reason is required — this becomes the permanent record of why" }, { status: 400 });
  }
  if (!RIGHTS_CLASSES.includes(String(rights_class))) {
    return NextResponse.json({ error: `rights_class must be one of ${RIGHTS_CLASSES.join(", ")}` }, { status: 400 });
  }
  if (decision === "approve" && !TRUST_MODES.includes(String(trust_mode))) {
    return NextResponse.json({ error: `trust_mode must be one of ${TRUST_MODES.join(", ")} to approve` }, { status: 400 });
  }

  try {
    const editors = await sb("GET", `human_principals?email=eq.${encodeURIComponent(editorEmail())}&select=id`);
    const editorId = editors[0]?.id;
    if (!editorId) {
      return NextResponse.json({ error: "no human_principals row for the editor — cannot attribute the decision" }, { status: 500 });
    }

    const result = await rpc("mcp_resolve_source_proposal", {
      p_proposal_id: Number(proposal_id),
      p_decision: String(decision),
      p_trust_mode: decision === "approve" ? String(trust_mode) : null,
      p_rights_class: String(rights_class),
      p_reason: String(reason).slice(0, 2000),
      p_decided_by_actor_type: "human",
      p_decided_by_actor_id: editorId,
      p_carta_version: CARTA_VERSION,
    });
    if (result?.error) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
