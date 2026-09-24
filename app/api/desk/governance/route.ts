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
 *
 * Visibility-only additions below (no authority change, nothing new is
 * written — the writes still all live in POST, untouched here):
 *
 * 1. source_proposal_intents is embedded without an explicit order, and a
 *    PostgREST embed's row order is not guaranteed without one — a
 *    frontend reading intents[0] could get an arbitrary intent. Ordering a
 *    *top-level* resource is `order=col.dir`; ordering an *embedded* one
 *    needs the relation-qualified form `relation.order=col.dir` (verified
 *    against the local PostgREST instance on a proposal with two intents:
 *    it actually reorders the embed. The `select=...intents(...).
 *    order(id.asc)` nested-call form is silently ignored by this
 *    PostgREST version — same input, unordered output).
 *
 * 2. recent_decisions embeds source_proposals(target_url) via the
 *    proposal_id FK, but source_policy_decisions_subject_check allows only
 *    one of endpoint_id/collection_id/proposal_id non-null, so every
 *    'approve' decision has proposal_id NULL and that embed comes back
 *    empty — the desk falls back to source_endpoints.host_pattern, a
 *    coarser fact ("archive.org" instead of the specific letter that was
 *    approved). mcp_resolve_source_proposal.sql still stamps
 *    evidence_snapshot->>'proposal_id' on both branches (approve and
 *    reject), so it's resolvable without a migration: pull that id where
 *    the embed is empty, batch-fetch source_proposals for the real
 *    target_url, and attach it as resolved_target_url alongside the
 *    existing fields (which are left as they are — nothing removed).
 *
 * 3. A pending proposal can carry a non-null endpoint_id (dedup onto an
 *    aggregator domain already known, e.g. archive.org) with nothing in
 *    the response saying so — the editor can't see they're deciding on an
 *    endpoint that's already active, at what trust_mode, or its last
 *    decision. endpoint_context adds that, keyed by endpoint id, using the
 *    same "batch-fetch then take latest per key" shape already used in
 *    app/api/sources/route.ts for the catalogue page's last-decision
 *    lookup.
 *
 * PR-5 additions (frontend reorg — desk/page.tsx and SourceGovernance.tsx
 * group by endpoint now, not by source table; these are the fields that
 * reorg needs and nothing else changes):
 *
 * 4. all_endpoints — the full source_endpoints roster, not only the
 *    needs_human_review/quarantined subset review_required_endpoints (kept,
 *    unchanged, for the badge that used to be the whole `flagged` tab). A
 *    "one row per endpoint" Dossier has nothing to be a row for otherwise.
 *
 * 5. reverification_evidence — whether source_reverifications or
 *    source_drift_evaluations carry ANY row, regardless of outcome. The
 *    existing `drifts` query below filters drift_detected=eq.true, so a
 *    pass that ran and found nothing looks identical, at that query, to a
 *    pass that never ran. Design law: a zero is a finding, and these two
 *    zeros are different findings.
 *
 * 6. endpoint_dossier — per endpoint (from all_endpoints), every proposal
 *    ever filed against it with every intent those proposals carried, and
 *    every decision ever recorded against it — not bounded by the 20-row
 *    `resolved` window above, which is a recent-activity feed rather than
 *    a per-endpoint history. Same batch-then-group shape as (3).
 */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  try {
    const pending = await sb("GET",
      "source_proposals?status=eq.submitted&select=id,target_url,proposed_by_actor_type," +
      "proposed_by_actor_id,endpoint_id,source_proposal_intents(voyage,waypoint,region,person,reason,suggested_trust_mode,suggested_rights_class)" +
      "&source_proposal_intents.order=id.asc");

    const resolved = await sb("GET",
      "source_policy_decisions?order=timestamp.desc&limit=20&select=id,decision_outcome,trust_mode," +
      "rights_class,reason,timestamp,proposal_id,endpoint_id,evidence_snapshot," +
      "source_endpoints(host_pattern),source_proposals(target_url)");

    // (4) The full roster, for the Dossier's "one row per endpoint" — not
    // only the ones currently flagged. review_required_endpoints below is
    // filtered from this in JS rather than queried separately, so the two
    // can never drift out of step with each other the way two independent
    // queries could.
    const allEndpoints = await sb("GET",
      "source_endpoints?select=id,host_pattern,match_type,status,trust_mode,last_verified_at&order=host_pattern.asc&limit=500");
    const endpoints = (allEndpoints ?? []).filter((e: any) =>
      e.status === "needs_human_review" || e.status === "quarantined");

    const drifts = await sb("GET",
      "source_drift_evaluations?drift_detected=eq.true&select=id,reverification_id,subject_type,subject_id,drift_class,drift_codes,old_material_fingerprint,new_material_fingerprint,recommended_action,created_at&order=created_at.desc&limit=20");

    // (5) Existence, not a count and not filtered by outcome — "has this
    // pipeline ever written a row" is a different question from "did the
    // most recent pass find drift", and the Riverifica section needs to
    // answer the first one honestly before it can say anything about the
    // second.
    const anyReverifications = await sb("GET", "source_reverifications?select=id&limit=1");
    const anyDriftEvaluations = await sb("GET", "source_drift_evaluations?select=id&limit=1");

    // (2) recover target_url for 'approve' decisions, whose embed above is
    // always empty by the subject_check constraint — via the proposal id
    // every decision's evidence_snapshot carries regardless of outcome.
    const missingProposalIds = [...new Set(
      (resolved ?? [])
        .filter((d: any) => !d.source_proposals?.target_url && d.evidence_snapshot?.proposal_id != null)
        .map((d: any) => Number(d.evidence_snapshot.proposal_id)),
    )];
    const resolvedProposals = missingProposalIds.length
      ? await sb("GET", `source_proposals?id=in.(${missingProposalIds.join(",")})&select=id,target_url`)
      : [];
    const targetUrlByProposalId = new Map((resolvedProposals ?? []).map((p: any) => [Number(p.id), p.target_url]));
    const resolvedWithTargetUrl = (resolved ?? []).map((d: any) => ({
      ...d,
      resolved_target_url:
        d.source_proposals?.target_url ??
        targetUrlByProposalId.get(Number(d.evidence_snapshot?.proposal_id)) ??
        null,
    }));

    // (3) Surface the endpoint a pending proposal is deduped onto, if any.
    // Filter on endpoint_id first, not after Number(): Number(null) is 0,
    // which Number.isInteger() happily accepts, so a null endpoint_id
    // (the common case — a brand-new domain) would otherwise leak a
    // spurious id-0 lookup into the batch query below.
    const pendingEndpointIds = [...new Set(
      (pending ?? [])
        .filter((p: any) => p.endpoint_id != null)
        .map((p: any) => Number(p.endpoint_id)),
    )];
    const endpointContext: Record<string, any> = {};
    if (pendingEndpointIds.length) {
      const contextEndpoints = await sb("GET",
        `source_endpoints?id=in.(${pendingEndpointIds.join(",")})&select=id,host_pattern,trust_mode,status`);
      const contextDecisions = await sb("GET",
        `source_policy_decisions?endpoint_id=in.(${pendingEndpointIds.join(",")})&decision_outcome=eq.approve` +
        "&select=id,endpoint_id,decision_outcome,trust_mode,rights_class,reason,timestamp&order=timestamp.desc,id.desc");
      const lastApproveByEndpoint = new Map<number, any>();
      for (const d of contextDecisions ?? []) {
        const endpointId = Number(d.endpoint_id);
        if (!lastApproveByEndpoint.has(endpointId)) lastApproveByEndpoint.set(endpointId, d);
      }
      for (const e of contextEndpoints ?? []) {
        endpointContext[String(e.id)] = {
          host_pattern: e.host_pattern,
          trust_mode: e.trust_mode,
          status: e.status,
          last_decision: lastApproveByEndpoint.get(Number(e.id)) ?? null,
        };
      }
    }

    // (6) The Dossier's own thread per endpoint. Batched the same way (3)
    // batches endpoint_context: gather every id the Dossier will render a
    // row for, then two id=in.() queries rather than one per endpoint.
    const dossierEndpointIds = (allEndpoints ?? []).map((e: any) => Number(e.id));
    const endpointDossier: Record<string, { proposals: any[]; decisions: any[] }> = {};
    for (const id of dossierEndpointIds) endpointDossier[String(id)] = { proposals: [], decisions: [] };
    if (dossierEndpointIds.length) {
      const dossierProposals = await sb("GET",
        `source_proposals?endpoint_id=in.(${dossierEndpointIds.join(",")})&select=id,target_url,status,` +
        "endpoint_id,proposed_by_actor_type,proposed_by_actor_id,source_proposal_intents(voyage,waypoint,region,person,reason,suggested_trust_mode,suggested_rights_class)" +
        "&source_proposal_intents.order=id.asc");
      const dossierDecisions = await sb("GET",
        `source_policy_decisions?endpoint_id=in.(${dossierEndpointIds.join(",")})` +
        "&select=id,decision_outcome,trust_mode,rights_class,reason,timestamp,proposal_id,endpoint_id,evidence_snapshot&order=timestamp.desc");
      for (const p of dossierProposals ?? []) {
        const key = String(p.endpoint_id);
        if (endpointDossier[key]) endpointDossier[key].proposals.push(p);
      }
      for (const d of dossierDecisions ?? []) {
        const key = String(d.endpoint_id);
        if (endpointDossier[key]) endpointDossier[key].decisions.push(d);
      }
    }

    return NextResponse.json({
      success: true,
      queue: {
        pending_proposals: pending,
        recent_decisions: resolvedWithTargetUrl,
        review_required_endpoints: endpoints,
        recent_material_drifts: drifts,
        endpoint_context: endpointContext,
        all_endpoints: allEndpoints,
        endpoint_dossier: endpointDossier,
        reverification_evidence: {
          any_reverifications: (anyReverifications ?? []).length > 0,
          any_drift_evaluations: (anyDriftEvaluations ?? []).length > 0,
        },
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
