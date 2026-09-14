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
};

export type PendingProposal = {
  id: number;
  target_url: string;
  proposed_by_actor_type: string;
  proposed_by_actor_id: number;
  endpoint_id: number | null;
  source_proposal_intents: SourceIntent[];
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
    </section>
  );
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

  function set(id: number, patch: Partial<{ trustMode: string; rightsClass: string; reason: string }>) {
    const defaults = { trustMode: TRUST_MODES[0].value, rightsClass: RIGHTS_CLASSES[4].value, reason: "" };
    setForm((f) => ({ ...f, [id]: { ...defaults, ...f[id], ...patch } }));
  }

  if (proposals.length === 0) {
    return <p className="dk-empty">No source proposals awaiting judgement.</p>;
  }

  return (
    <div className="src-pending">
      {proposals.map((p) => {
        const f = form[p.id] ?? { trustMode: TRUST_MODES[0].value, rightsClass: RIGHTS_CLASSES[4].value, reason: "" };
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
                  onChange={(e) => set(p.id, { trustMode: e.target.value })}
                >
                  {TRUST_MODES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="src-field">
                <span>rights class</span>
                <select
                  className="desk-input"
                  value={f.rightsClass}
                  onChange={(e) => set(p.id, { rightsClass: e.target.value })}
                >
                  {RIGHTS_CLASSES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <input
                className="desk-input src-reason"
                placeholder="reason (recorded permanently)"
                value={f.reason}
                onChange={(e) => set(p.id, { reason: e.target.value })}
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

export function ResolvedSourceDecisions({ decisions }: { decisions: ResolvedDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <details className="src-history">
      <summary>Resolved decisions ({decisions.length})</summary>
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
    </details>
  );
}
