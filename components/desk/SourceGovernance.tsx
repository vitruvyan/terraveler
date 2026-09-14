"use client";

import { useState } from "react";

/* Source governance: the Sources tab.
 *
 * Built the way the design law asks a record to be asked as a question
 * (SubmissionBrief.tsx): a pending proposal's target_url and stated reason
 * are the record; this derives what is actually being decided from them,
 * and the raw record stays available, not printed by default.
 *
 * Two zones, physically separate, per the editor's own diagnosis of the
 * desk's problem — too much density, no line between what needs a decision
 * now and what is only history. Pending proposals sit above, open; resolved
 * decisions sit below, collapsed. Same split DeskStanding already draws
 * between "appealed/escalated" and settled counts, applied here to its own
 * queue instead of borrowing that component's shape for a different kind of
 * record.
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

export type FlaggedEndpoint = {
  id: number;
  host_pattern: string;
  match_type: string;
  status: string;
  trust_mode: string | null;
  last_verified_at: string | null;
};

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
 * prose it wrote, so it reads in the narrator's voice, not the machine's. */
function ProposalBrief({ p }: { p: PendingProposal }) {
  const intent = p.source_proposal_intents?.[0];
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
      {intent?.reason && <p className="sb-idea">{intent.reason}</p>}
      {(intent?.voyage || intent?.region || intent?.person) && (
        <p className="sb-note">
          Concerns{intent.voyage && <> <span className="dk-id">{intent.voyage}</span></>}
          {intent.waypoint != null && <>, stage <span className="dk-id">{intent.waypoint}</span></>}
          {intent.region && <>, {intent.region}</>}
          {intent.person && <>, {intent.person}</>}.
        </p>
      )}
      {(intent?.suggested_trust_mode || intent?.suggested_rights_class) && (
        <p className="sb-note">
          Agent suggests
          {intent.suggested_trust_mode && <> <span className="dk-id">{intent.suggested_trust_mode}</span></>}
          {intent.suggested_rights_class && <>, <span className="dk-id">{intent.suggested_rights_class}</span></>}.
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
 * editor something to confirm or correct instead of type from nothing. */
function defaultForm(p: PendingProposal): { trustMode: string; rightsClass: string; reason: string } {
  const intent = p.source_proposal_intents?.[0];
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
}: {
  proposals: PendingProposal[];
  busy: boolean;
  onResolve?: (id: number, decision: "approve" | "reject", trustMode: string, rightsClass: string, reason: string) => void;
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
        return (
          <div key={p.id} className="src-card">
            <div className="src-card-head">
              <strong className="src-card-title">#{p.id} · {host(p.target_url)}</strong>
              <a href={p.target_url} target="_blank" rel="noreferrer" className="dk-tab-link">
                {p.target_url}
              </a>
            </div>
            <ProposalBrief p={p} />
            <div className="src-verdict">
              <label className="src-field">
                <span>trust mode</span>
                <select
                  className="desk-input"
                  value={f.trustMode}
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
                  onChange={(e) => set(p.id, { rightsClass: e.target.value }, d)}
                >
                  {RIGHTS_CLASSES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <input
                className="desk-input src-reason"
                placeholder="reason (recorded permanently)"
                value={f.reason}
                onChange={(e) => set(p.id, { reason: e.target.value }, d)}
              />
              <button
                className="desk-btn desk-btn-approve"
                disabled={busy || !f.reason.trim()}
                onClick={() => onResolve?.(p.id, "approve", f.trustMode, f.rightsClass, f.reason)}
              >
                Approve
              </button>
              <button
                className="desk-btn desk-btn-reject"
                disabled={busy || !f.reason.trim()}
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
 * actually needed a decision. As its own sidebar subsection, someone who
 * navigated here already chose to look at history, so it opens plainly. */
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
            {d.source_endpoints?.host_pattern ?? (d.source_proposals ? host(d.source_proposals.target_url) : "?")}
          </span>
          {d.trust_mode && <span className="dk-id">{d.trust_mode}</span>}
          <span className="src-history-reason">{d.reason}</span>
          <span className="dk-id">{new Date(d.timestamp).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

/* source_endpoints the automated reverification pass could not stand behind
 * on its own — quarantined outright, or merely flagged for a human look.
 * Read-only: no RPC exists yet to act on one directly (the intended path is
 * still a fresh source_policy_decisions row through Sources' own pending
 * queue, or a manual DB change), so this is visibility the API already
 * computed and the desk never showed, not a new decision surface. */
export function FlaggedEndpoints({ endpoints }: { endpoints: FlaggedEndpoint[] }) {
  if (endpoints.length === 0) return <p className="dk-empty">No source is quarantined or flagged for review.</p>;
  return (
    <div className="src-history-list">
      {endpoints.map((e) => (
        <div key={e.id} className="src-history-row">
          <span className={`conf-badge ${e.status === "quarantined" ? "is-reject" : "is-review"}`}>
            {e.status.replace(/_/g, " ")}
          </span>
          <span className="dk-id">{e.host_pattern}</span>
          <span className="dk-id">{e.match_type}</span>
          {e.trust_mode && <span className="dk-id">{e.trust_mode}</span>}
          <span className="src-history-reason">
            {e.last_verified_at ? `last verified ${new Date(e.last_verified_at).toLocaleDateString()}` : "never verified"}
          </span>
        </div>
      ))}
    </div>
  );
}

/* source_drift_evaluations where the material behind a trusted endpoint or
 * collection changed since it was last verified — a domain that earned
 * trust by being one thing can drift into being another without anyone
 * re-deciding it. Also read-only for the same reason as FlaggedEndpoints:
 * the reverification pipeline writes these, nothing here resolves them. */
export function MaterialDrifts({ drifts }: { drifts: MaterialDrift[] }) {
  if (drifts.length === 0) return <p className="dk-empty">No material drift detected.</p>;
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
