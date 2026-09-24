"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/* Source governance: the Sources tab.
 *
 * Built the way the design law asks a record to be asked as a question
 * (SubmissionBrief.tsx): a pending proposal's target_url and stated reason
 * are the record; this derives what is actually being decided from them,
 * and the raw record stays available, not printed by default.
 *
 * Three sections, not four, organised by the editor's own question — "who
 * asked for what, and what was decided" — instead of by which source table
 * happens to hold the row:
 *
 *   A. Da decidere      — pending proposals, exactly as before, now showing
 *                          every intent a proposal carries and the endpoint
 *                          it would dedupe onto, before the click rather
 *                          than after a refused POST.
 *   B. Dossier fonte    — one row per endpoint: the proposals that produced
 *                          it, every intent those proposals carried (even
 *                          the ones no decision ever ruled on), and the
 *                          decision chain in order. The old "flagged" tab's
 *                          badge lives here now, on the endpoint it flags,
 *                          instead of its own tab that was empty every time
 *                          nothing had gone wrong AND every time nothing had
 *                          been checked.
 *   C. Riverifica       — whether the reverification pipeline has produced
 *                          anything at all. Not "no drift detected": that
 *                          reads as "checked, and clean" when the honest
 *                          fact, while source_reverifications carries no
 *                          rows, is "nothing has checked".
 *
 * The former `flagged` and `drift` tabs read source_assessments and
 * source_drift_evaluations, tables that carried zero rows in production
 * while presenting a generic "nothing here" empty state — indistinguishable
 * from "all clear" when the truth was "this pipeline has never run". Design
 * law: a zero is a finding and gets said out loud.
 */

export type SourceIntent = {
  voyage: string | null;
  waypoint: number | null;
  region: string | null;
  person: string | null;
  reason: string | null;
  suggested_trust_mode: string | null;
  suggested_rights_class: string | null;
};

export type PendingProposal = {
  id: number;
  target_url: string;
  proposed_by_actor_type: string;
  proposed_by_actor_id: number;
  endpoint_id: number | null;
  source_proposal_intents: SourceIntent[];
};

/* What the pending proposal's own endpoint_id already carries, if it is
 * deduped onto a domain the desk already has an opinion about — S1c made
 * visible before the verdict instead of after it. */
export type EndpointContext = {
  host_pattern: string;
  trust_mode: string | null;
  status: string;
  last_decision: {
    id: number;
    decision_outcome: string;
    trust_mode: string | null;
    rights_class: string;
    reason: string;
    timestamp: string;
  } | null;
};

export type ResolvedDecision = {
  id: number;
  decision_outcome: string;
  trust_mode: string | null;
  rights_class: string;
  reason: string;
  timestamp: string;
  proposal_id: number | null;
  endpoint_id: number | null;
  source_endpoints: { host_pattern: string } | null;
  source_proposals: { target_url: string } | null;
  /** The specific URL a decision ruled on, recovered even for 'approve'
   *  outcomes (whose proposal_id the subject_check constraint always nulls)
   *  via the evidence_snapshot every decision stamps regardless of outcome. */
  resolved_target_url?: string | null;
};

/* The full endpoint roster — every source the desk has an opinion about,
 * trusted or not, flagged or not — not only the ones currently in trouble.
 * A Dossier that only lists the flagged ones is the old `flagged` tab with
 * new furniture. */
export type DossierEndpoint = {
  id: number;
  host_pattern: string;
  match_type: string;
  status: string;
  trust_mode: string | null;
  last_verified_at: string | null;
};

export type DossierProposal = {
  id: number;
  target_url: string;
  status: string;
  endpoint_id: number | null;
  proposed_by_actor_type?: string;
  proposed_by_actor_id?: number;
  source_proposal_intents: SourceIntent[];
};

export type DossierDecision = {
  id: number;
  decision_outcome: string;
  trust_mode: string | null;
  rights_class: string;
  reason: string;
  timestamp: string;
  proposal_id: number | null;
  endpoint_id: number | null;
  evidence_snapshot?: { proposal_id?: number | null } | null;
};

export type EndpointDossierEntry = { proposals: DossierProposal[]; decisions: DossierDecision[] };

export type MaterialDrift = {
  id: number;
  reverification_id: number;
  subject_type: string;
  subject_id: number;
  drift_class: string;
  drift_codes: string[] | null;
  old_material_fingerprint: string | null;
  new_material_fingerprint: string | null;
  recommended_action: string;
  created_at: string;
};

const TRUST_MODES = [
  { value: "domain_trusted", label: "domain trusted — the whole domain" },
  { value: "collection_trusted", label: "collection trusted — one collection within it" },
  { value: "item_verified", label: "item verified — checked per item at use" },
  { value: "link_only", label: "link only — cite, never ingest" },
];

const RIGHTS_CLASSES = [
  { value: "public_domain", label: "public domain" },
  { value: "creative_commons", label: "creative commons" },
  { value: "mixed", label: "mixed — varies by item" },
  { value: "in_copyright", label: "in copyright" },
  { value: "unknown", label: "unknown" },
];

function host(u: string): string {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
}

/* What is actually being proposed, derived rather than printed: who is
 * asking, for what domain, and why — the agent's own stated reason is
 * prose it wrote, so it reads in the narrator's voice, not the machine's.
 *
 * A proposal can carry more than one intent (several stages, several
 * reasons, one URL) — with PR-4's now-deterministic ordering every one of
 * them is real and none of them is "the" intent, so every one is shown. */
function ProposalBrief({ p, endpointContext }: { p: PendingProposal; endpointContext?: EndpointContext }) {
  const intents = p.source_proposal_intents ?? [];
  return (
    <section className="sb">
      <p className="sb-lede">
        <span className="sb-verb">Proposes trusting</span>{" "}
        <span className="dk-id">{host(p.target_url)}</span>
        {" — suggested by "}
        <span className="dk-id">
          {p.proposed_by_actor_type} #{p.proposed_by_actor_id}
        </span>
        .
      </p>

      {intents.length > 1 && (
        <p className="sb-warn">
          <Icon name="hourglass" size={13} />
          Carries {intents.length} distinct requests — every one of them below, not one
          standing in for all.
        </p>
      )}

      {intents.map((intent, i) => (
        <div key={i} className={intents.length > 1 ? "src-intent" : undefined}>
          {intents.length > 1 && (
            <p className="src-intent-head">request {i + 1} of {intents.length}</p>
          )}
          {intent.reason && <p className="sb-idea">{intent.reason}</p>}
          {(intent.voyage || intent.region || intent.person) && (
            <p className="sb-note">
              Concerns{intent.voyage && <> <span className="dk-id">{intent.voyage}</span></>}
              {intent.waypoint != null && <>, stage <span className="dk-id">{intent.waypoint}</span></>}
              {intent.region && <>, {intent.region}</>}
              {intent.person && <>, {intent.person}</>}.
            </p>
          )}
          {(intent.suggested_trust_mode || intent.suggested_rights_class) && (
            <p className="sb-note">
              Agent suggests
              {intent.suggested_trust_mode && <> <span className="dk-id">{intent.suggested_trust_mode}</span></>}
              {intent.suggested_rights_class && <>, <span className="dk-id">{intent.suggested_rights_class}</span></>}.
            </p>
          )}
        </div>
      ))}

      {/* S1c, made visible before the verdict rather than discoverable
          after one: the proposal is deduped onto a domain the desk already
          has standing on, and approving here with a different trust_mode
          changes that standing for the whole domain, not just this URL. */}
      {endpointContext && (
        <p className="sb-note src-context">
          <span className="dk-id">{endpointContext.host_pattern}</span> is already{" "}
          {endpointContext.trust_mode ? (
            <>active as <span className="dk-id">{endpointContext.trust_mode}</span></>
          ) : (
            <>on file, status <span className="dk-id">{endpointContext.status}</span></>
          )}
          {endpointContext.last_decision && (
            <> since {new Date(endpointContext.last_decision.timestamp).toLocaleDateString()}</>
          )}
          . Approving with a different trust_mode would change it for the entire domain, not
          only this proposal.
        </p>
      )}
    </section>
  );
}

/* The agent that researched and proposed a source already did the work a
 * blank verdict form was asking the editor to redo from a URL and a
 * sentence — that mismatch, not a bug in the resolve call, was why Approve
 * sat disabled: the reason field has no default and the button requires
 * one. Starting the form from what the agent already wrote gives the
 * editor something to confirm or correct instead of type from nothing.
 * Only sound when there is exactly one intent to default from. */
function defaultForm(p: PendingProposal): { trustMode: string; rightsClass: string; reason: string } {
  const intent = p.source_proposal_intents?.length === 1 ? p.source_proposal_intents[0] : undefined;
  return {
    trustMode: intent?.suggested_trust_mode ?? TRUST_MODES[0].value,
    rightsClass: intent?.suggested_rights_class ?? RIGHTS_CLASSES[4].value,
    reason: intent?.reason ?? "",
  };
}

export function PendingSourceProposals({
  proposals,
  busy,
  onResolve,
  endpointContext,
}: {
  proposals: PendingProposal[];
  busy: boolean;
  onResolve?: (id: number, decision: "approve" | "reject", trustMode: string, rightsClass: string, reason: string) => void;
  /** Keyed by endpoint id (as a string, since it arrives from JSON), from
   *  the GET route's own batch lookup. Optional so a caller with nothing to
   *  say about deduped endpoints (or the /specimen fixture) still renders
   *  exactly as it did before this existed. */
  endpointContext?: Record<string, EndpointContext>;
}) {
  const [form, setForm] = useState<Record<number, { trustMode: string; rightsClass: string; reason: string }>>({});

  function set(
    id: number,
    patch: Partial<{ trustMode: string; rightsClass: string; reason: string }>,
    defaults: { trustMode: string; rightsClass: string; reason: string },
  ) {
    setForm((f) => ({ ...f, [id]: { ...defaults, ...f[id], ...patch } }));
  }

  if (proposals.length === 0) {
    return <p className="dk-empty">No source proposals awaiting judgement.</p>;
  }

  return (
    <div className="src-pending">
      {proposals.map((p) => {
        const d = defaultForm(p);
        const f = form[p.id] ?? d;
        const multiIntent = (p.source_proposal_intents?.length ?? 0) > 1;
        const ctx = p.endpoint_id != null ? endpointContext?.[String(p.endpoint_id)] : undefined;
        return (
          <div key={p.id} className="src-card">
            <div className="src-card-head">
              <strong className="src-card-title">#{p.id} · {host(p.target_url)}</strong>
              <a href={p.target_url} target="_blank" rel="noreferrer" className="dk-tab-link">
                {p.target_url}
              </a>
            </div>
            <ProposalBrief p={p} endpointContext={ctx} />

            {multiIntent && (
              <p className="src-refusal">
                This proposal carries {p.source_proposal_intents.length} distinct requests — it
                can&rsquo;t be resolved with a single verdict. Split it into separate proposals,
                one intent each, before this can be approved or rejected here.
              </p>
            )}

            <div className="src-verdict">
              <label className="src-field">
                <span>trust mode</span>
                <select
                  className="desk-input"
                  value={f.trustMode}
                  disabled={multiIntent}
                  onChange={(e) => set(p.id, { trustMode: e.target.value }, d)}
                >
                  {TRUST_MODES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="src-field">
                <span>rights class</span>
                <select
                  className="desk-input"
                  value={f.rightsClass}
                  disabled={multiIntent}
                  onChange={(e) => set(p.id, { rightsClass: e.target.value }, d)}
                >
                  {RIGHTS_CLASSES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <input
                className="desk-input src-reason"
                placeholder="reason (recorded permanently)"
                value={f.reason}
                disabled={multiIntent}
                onChange={(e) => set(p.id, { reason: e.target.value }, d)}
              />
              <button
                className="desk-btn desk-btn-approve"
                disabled={busy || multiIntent || !f.reason.trim()}
                onClick={() => onResolve?.(p.id, "approve", f.trustMode, f.rightsClass, f.reason)}
              >
                Approve
              </button>
              <button
                className="desk-btn desk-btn-reject"
                disabled={busy || multiIntent || !f.reason.trim()}
                onClick={() => onResolve?.(p.id, "reject", f.trustMode, f.rightsClass, f.reason)}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Was a collapsed <details> at the tail of a busier tab, where collapsing it
 * by default made sense — it shared the page with the pending queue that
 * actually needed a decision. Now used two ways: on its own nowhere in the
 * desk any more (the Dossier groups by endpoint instead), and inside the
 * Dossier for the decisions that never got an endpoint at all — a straight
 * reject leaves nothing to hang a per-endpoint row on. */
export function ResolvedSourceDecisions({ decisions }: { decisions: ResolvedDecision[] }) {
  if (decisions.length === 0) return <p className="dk-empty">No decisions recorded yet.</p>;
  return (
    <div className="src-history-list">
      {decisions.map((d) => (
        <div key={d.id} className="src-history-row">
          <span className={`conf-badge ${d.decision_outcome === "approve" ? "is-approve" : "is-reject"}`}>
            {d.decision_outcome}
          </span>
          <span className="dk-id">
            {d.source_endpoints?.host_pattern
              ?? (d.resolved_target_url ? host(d.resolved_target_url) : null)
              ?? (d.source_proposals ? host(d.source_proposals.target_url) : "?")}
          </span>
          {d.trust_mode && <span className="dk-id">{d.trust_mode}</span>}
          <span className="src-history-reason">{d.reason}</span>
          <span className="dk-id">{new Date(d.timestamp).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

/* source_drift_evaluations rows where drift_detected is true — real findings
 * from a pass that ran. Used inside ReverificationStatus below rather than
 * as its own tab: a finding about material drift belongs beside the answer
 * to "is anything even checking", not filed separately from it. */
export function MaterialDrifts({ drifts }: { drifts: MaterialDrift[] }) {
  if (drifts.length === 0) return null;
  return (
    <div className="src-history-list">
      {drifts.map((d) => (
        <div key={d.id} className="src-history-row">
          <span className={`conf-badge ${d.recommended_action === "KEEP_ACTIVE" ? "is-approve" : "is-reject"}`}>
            {d.recommended_action.replace(/_/g, " ").toLowerCase()}
          </span>
          <span className="dk-id">{d.subject_type} #{d.subject_id}</span>
          <span className="dk-id">{d.drift_class}</span>
          {d.drift_codes && d.drift_codes.length > 0 && (
            <span className="src-history-reason">{d.drift_codes.join(", ")}</span>
          )}
          <span className="dk-id">{new Date(d.created_at).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

const REVIEW_STATUSES = new Set(["needs_human_review", "quarantined"]);

function resolvedProposalIdOf(d: DossierDecision): number | null {
  return d.proposal_id ?? d.evidence_snapshot?.proposal_id ?? null;
}

/* One row per endpoint, not per decision — the Dossier the old `resolved`
 * and `flagged` tabs were both partial views of. Expandable: the decision
 * chain in order (which one is currently in force), and every proposal
 * that ever named this endpoint with every intent it carried, marked
 * `not evaluated` where nothing ever ruled on it — the case a dedup onto
 * an already-active endpoint used to let disappear silently. */
export function SourceDossier({
  endpoints,
  dossier,
  unattachedDecisions,
}: {
  endpoints: DossierEndpoint[];
  dossier: Record<string, EndpointDossierEntry>;
  unattachedDecisions: ResolvedDecision[];
}) {
  if (endpoints.length === 0 && unattachedDecisions.length === 0) {
    return <p className="dk-empty">No source has been decided on yet.</p>;
  }

  return (
    <div className="src-dossier">
      {endpoints.map((e) => {
        const entry = dossier[String(e.id)] ?? { proposals: [], decisions: [] };
        const decisions = [...entry.decisions].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const inForceId = decisions[0]?.id;
        const flagged = REVIEW_STATUSES.has(e.status);

        return (
          <details key={e.id} className="src-dossier-row">
            <summary className="src-dossier-summary">
              <span className="dk-id src-dossier-host">{e.host_pattern}</span>
              {e.trust_mode && <span className="conf-badge is-approve">{e.trust_mode}</span>}
              {flagged && (
                <span className={`conf-badge ${e.status === "quarantined" ? "is-reject" : "is-review"}`}>
                  {e.status.replace(/_/g, " ")}
                </span>
              )}
              <span className="src-dossier-count">
                {entry.proposals.length} proposal{entry.proposals.length === 1 ? "" : "s"} ·{" "}
                {decisions.length} decision{decisions.length === 1 ? "" : "s"}
              </span>
            </summary>

            <div className="src-dossier-body">
              {decisions.length === 0 ? (
                <p className="dk-empty">No decision recorded against this endpoint yet.</p>
              ) : (
                <div className="src-history-list">
                  {decisions.map((d) => (
                    <div key={d.id} className="src-history-row">
                      <span className={`conf-badge ${d.decision_outcome === "approve" ? "is-approve" : "is-reject"}`}>
                        {d.decision_outcome}
                      </span>
                      {d.id === inForceId && <span className="dk-id src-in-force">in force</span>}
                      {d.trust_mode && <span className="dk-id">{d.trust_mode}</span>}
                      <span className="src-history-reason">{d.reason}</span>
                      <span className="dk-id">{new Date(d.timestamp).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {entry.proposals.length > 0 && (
                <div className="src-dossier-proposals">
                  <p className="sb-key">proposals on file</p>
                  {entry.proposals.map((p) => {
                    const ruled = decisions.find((d) => resolvedProposalIdOf(d) === p.id);
                    const intents = p.source_proposal_intents ?? [];
                    return (
                      <div key={p.id} className="src-dossier-proposal">
                        <div className="src-history-row">
                          <span className="dk-id">#{p.id} · {host(p.target_url)}</span>
                          {ruled ? (
                            <span className={`conf-badge ${ruled.decision_outcome === "approve" ? "is-approve" : "is-reject"}`}>
                              ruled {ruled.decision_outcome}
                            </span>
                          ) : (
                            <span className="conf-badge is-review">not evaluated</span>
                          )}
                        </div>
                        {intents.length === 0 && (
                          <p className="sb-note">No intent recorded on this proposal.</p>
                        )}
                        {intents.map((intent, i) => (
                          <p key={i} className="sb-note src-dossier-intent">
                            {intent.reason ?? "(no stated reason)"}
                            {intent.voyage && <> — <span className="dk-id">{intent.voyage}</span></>}
                            {intent.waypoint != null && <> stage <span className="dk-id">{intent.waypoint}</span></>}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        );
      })}

      {unattachedDecisions.length > 0 && (
        <div className="src-dossier-loose">
          <p className="sb-key">decisions with no endpoint on record</p>
          <ResolvedSourceDecisions decisions={unattachedDecisions} />
        </div>
      )}
    </div>
  );
}

/* Whether the reverification pipeline has produced anything at all —
 * independent of whether any pass it did run found drift. A count of zero
 * from a drift_detected=true filter cannot tell "ran clean" from "never
 * ran"; evidence carries that distinction explicitly from the route, which
 * checks source_reverifications and source_drift_evaluations for any row
 * regardless of outcome. */
export function ReverificationStatus({
  endpoints,
  drifts,
  evidence,
}: {
  endpoints: DossierEndpoint[];
  drifts: MaterialDrift[];
  evidence: { any_reverifications: boolean; any_drift_evaluations: boolean };
}) {
  const trusted = endpoints.filter((e) => e.trust_mode != null);
  const verified = trusted.filter((e) => e.last_verified_at != null);
  const pipelineRan = evidence.any_reverifications || evidence.any_drift_evaluations;

  return (
    <div>
      {!pipelineRan ? (
        <section className="sb sb-appeal">
          <p className="sb-lede">
            <span className="sb-verb">The reverification pipeline is not running.</span>
          </p>
          <p className="sb-idea">
            {trusted.length === 0 ? (
              "No source is trusted yet, so there is nothing to reverify."
            ) : (
              <>
                {trusted.length} trusted source{trusted.length === 1 ? "" : "s"}, and none carr
                {trusted.length === 1 ? "ies" : "y"} a recorded verification.{" "}
                <span className="dk-id">source_reverifications</span> and{" "}
                <span className="dk-id">source_drift_evaluations</span> are both empty — this is
                not &ldquo;no drift found&rdquo;, it is that nothing has ever checked.
              </>
            )}
          </p>
        </section>
      ) : (
        <p className="dk-empty">
          {verified.length} of {trusted.length} trusted source{trusted.length === 1 ? "" : "s"} carr
          {verified.length === 1 ? "ies" : "y"} a recorded verification.
        </p>
      )}

      {drifts.length > 0 && (
        <>
          <p className="sb-key" style={{ marginTop: "var(--space-5)" }}>material drift found</p>
          <MaterialDrifts drifts={drifts} />
        </>
      )}

      {verified.length > 0 && (
        <>
          <p className="sb-key" style={{ marginTop: "var(--space-5)" }}>last verified</p>
          <div className="src-history-list">
            {verified.map((e) => (
              <div key={e.id} className="src-history-row">
                <span className="dk-id">{e.host_pattern}</span>
                <span className="dk-id">{e.trust_mode}</span>
                <span className="src-history-reason">
                  last verified {new Date(e.last_verified_at as string).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
