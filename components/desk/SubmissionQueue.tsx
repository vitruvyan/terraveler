"use client";
import { useEffect, useState, type ReactNode } from "react";
import SubmissionBrief from "./SubmissionBrief";
import {
  appealReason,
  INTENT_TYPES,
  mayRule,
  submissionNextStep,
  submissionTitle,
  type DeskSubmission,
} from "@/lib/deskPresentation";

export type VerdictFeedback = { error?: string; needsOverride?: boolean };
export default function SubmissionQueue({
  submissions,
  loading,
  error,
  onRetry,
  onVerdict,
  busy = false,
  onSelectionChange,
  renderTools,
}: {
  submissions: DeskSubmission[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  busy?: boolean;
  onSelectionChange?: (id: number | null) => void;
  renderTools?: (s: DeskSubmission) => ReactNode;
  onVerdict?: (
    id: number,
    verdict: string,
    note: string,
    override?: string,
  ) => Promise<VerdictFeedback>;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const [feedback, setFeedback] = useState<VerdictFeedback>({});
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const sync = () => {
      const p = new URLSearchParams(window.location.search);
      setQuery(p.get("q") ?? "");
      setType(p.get("type") ?? "");
      setStatus(p.get("status") ?? "");
      const id = Number(p.get("submission"));
      setSelected(Number.isSafeInteger(id) && id > 0 ? id : null);
      onSelectionChange?.(Number.isSafeInteger(id) && id > 0 ? id : null);
      setNote("");
      setOverride("");
      setFeedback({});
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [onSelectionChange]);
  function filters(q: string, t: string, st: string) {
    setQuery(q);
    setType(t);
    setStatus(st);
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of [
      ["q", q],
      ["type", t],
      ["status", st],
    ]) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }
  function open(id: number | null) {
    const p = new URLSearchParams(window.location.search);
    if (id) p.set("submission", String(id));
    else p.delete("submission");
    window.history.pushState(null, "", `${window.location.pathname}?${p}`);
    setSelected(id);
    onSelectionChange?.(id);
    setNote("");
    setOverride("");
    setFeedback({});
    setSuccess("");
  }
  async function rule(s: DeskSubmission, verdict: string) {
    if (!onVerdict) return;
    setFeedback({});
    setSuccess("");
    try {
      const result = await onVerdict(
        s.id,
        verdict,
        note,
        feedback.needsOverride ? override.trim() : undefined,
      );
      setFeedback(result);
      if (!result.error)
        setSuccess(
          verdict === "approve"
            ? INTENT_TYPES.has(s.type)
              ? "Proposal approved. This does not publish a voyage."
              : "Your authorization was recorded. The Publisher must still publish and deploy the content."
            : "Decision recorded.",
        );
    } catch {
      setFeedback({
        error:
          "Could not save your decision. Check the current record before retrying.",
      });
    }
  }
  if (loading)
    return (
      <p className="dk-empty" role="status">
        Loading contributions…
      </p>
    );
  if (error)
    return (
      <div className="ec-error" role="alert">
        <p>{error}</p>
        <button className="desk-btn" onClick={onRetry}>
          Retry contributions
        </button>
      </div>
    );
  const s = submissions.find((v) => v.id === selected);
  if (selected && s)
    return (
      <section className="ec-detail">
        <button className="desk-btn" onClick={() => open(null)}>
          ← Back to contributions
        </button>
        <h2>{submissionTitle(s)}</h2>
        {renderTools?.(s)}
        <p className="ec-meta">
          #{s.id} · {s.type} · {s.status} ·{" "}
          {s.contributor?.handle ?? "Contributor not recorded"} · Carta{" "}
          {s.carta_version}
        </p>
        <p className="ec-next" role="status">
          {submissionNextStep(s)}
        </p>
        {s.status === "appealed" && (
          <section className="ec-next">
            <h3>Appeal grounds</h3>
            <p>{appealReason(s)}</p>
          </section>
        )}
        <SubmissionBrief type={s.type} payload={s.payload} />
        {Array.isArray(s.payload?.waypoints) && (
          <section>
            <h3>Editorial preview</h3>
            {s.payload.waypoints
              .filter((w: any) => w && typeof w === "object")
              .map((w: any, i: number) => (
                <details key={i} className="ec-stage">
                  <summary>
                    Stage {w.seq ?? i + 1} ·{" "}
                    {w.place_historical ??
                      w.place_modern ??
                      "Place not recorded"}
                  </summary>
                  <p>
                    {String(
                      w.narrative ??
                        w.description ??
                        w.summary ??
                        "Narrative not supplied in this field.",
                    )}
                  </p>
                  {(w.excerpt || w.diary_excerpt) && (
                    <blockquote>{w.excerpt ?? w.diary_excerpt}</blockquote>
                  )}
                  <p className="ec-meta">
                    Confidence: {w.confidence ?? "not recorded"} · Date:{" "}
                    {w.arrival_date ?? "not recorded"}
                  </p>
                </details>
              ))}
          </section>
        )}
        <h3>Agent review dossier</h3>
        <p>
          Reviews advise; you retain the publication decision. A missing review
          is not a passed check.
        </p>
        {s.reviews.length === 0 ? (
          <p className="ec-meta">No peer reviews recorded.</p>
        ) : (
          s.reviews.map((r, i) => (
            <details key={i}>
              <summary>
                {r.reviewer?.handle ?? "Reviewer not recorded"} · {r.verdict}
              </summary>
              <p className="ec-meta">{r.created_at}</p>
              <pre>{JSON.stringify(r.findings, null, 2)}</pre>
            </details>
          ))
        )}
        {mayRule(s) && (
          <section className="ec-decision">
            <h3>
              {INTENT_TYPES.has(s.type)
                ? "Your editorial decision"
                : "Your publication authorization"}
            </h3>
            <p>
              {INTENT_TYPES.has(s.type)
                ? "Approving this proposal authorizes work, not publication."
                : "Authorization is recorded by the existing verdict service. Publication and deployment are separate steps."}
            </p>
            <label htmlFor="ec-note">
              Decision note (saved in the audit trail)
            </label>
            <textarea
              id="ec-note"
              className="desk-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
            {feedback.error && (
              <p role="alert" className="ec-error">
                {feedback.error}
              </p>
            )}
            {feedback.needsOverride && (
              <label>
                Override reason (required to proceed despite the dossier)
                <textarea
                  className="desk-input"
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <div className="ec-actions">
              <button
                className="desk-btn desk-btn-primary"
                disabled={
                  busy ||
                  !onVerdict ||
                  (feedback.needsOverride && !override.trim())
                }
                onClick={() => rule(s, "approve")}
              >
                {busy
                  ? "Saving…"
                  : INTENT_TYPES.has(s.type)
                    ? "Approve proposal"
                    : feedback.needsOverride
                      ? "Authorize with recorded override"
                      : "Authorize publication"}
              </button>
              <button
                className="desk-btn"
                disabled={busy || !onVerdict}
                onClick={() => rule(s, "changes")}
              >
                Request changes
              </button>
              <button
                className="desk-btn"
                disabled={busy || !onVerdict}
                onClick={() => rule(s, "reject")}
              >
                Reject
              </button>
            </div>
          </section>
        )}
        {success && (
          <p role="status" className="ec-next">
            {success}
          </p>
        )}
        <details>
          <summary>Audit trail · {s.audit.length} events</summary>
          {s.audit.map((a, i) => (
            <div key={i}>
              <p className="ec-meta">
                {a.created_at} · {a.actor} · {a.action} · {a.verdict}
              </p>
              <pre>{JSON.stringify(a.findings, null, 2)}</pre>
            </div>
          ))}
        </details>
        <details>
          <summary>Original submission record</summary>
          <pre>{JSON.stringify(s.payload, null, 2)}</pre>
        </details>
      </section>
    );
  const visible = submissions.filter(
    (s) =>
      (!type || s.type === type) &&
      (!status || s.status === status) &&
      `${submissionTitle(s)} ${s.target_voyage ?? ""} ${s.contributor?.handle ?? ""} ${s.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section>
      {selected && (
        <p role="status">
          Submission #{selected} is not in this queue.{" "}
          <button className="desk-btn" onClick={() => open(null)}>
            Clear selection
          </button>
        </p>
      )}
      <div className="ec-filters">
        <label>
          Search title, voyage, contributor or ID
          <input
            className="desk-input"
            type="search"
            value={query}
            onChange={(e) => filters(e.target.value, type, status)}
          />
        </label>
        <details className="ed-extra-filters" open={Boolean(type || status)}>
          <summary>More filters</summary>
          <label>
            Contribution type
            <select
              className="desk-input"
              value={type}
              onChange={(e) => filters(query, e.target.value, status)}
            >
              <option value="">All types</option>
              {[...new Set(submissions.map((s) => s.type))].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            State
            <select
              className="desk-input"
              value={status}
              onChange={(e) => filters(query, type, e.target.value)}
            >
              <option value="">All states</option>
              {[...new Set(submissions.map((s) => s.status))].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </details>
      </div>
      <p className="ec-meta" role="status">
        {visible.length} contributions · Open a title to inspect the dossier and
        actions.
      </p>
      {visible.length === 0 ? (
        <p className="dk-empty">
          {submissions.length
            ? "No matching contributions. Clear the search or filters."
            : "No contributions in this queue."}
        </p>
      ) : (
        visible.map((s) => (
          <article className="ec-row" key={s.id}>
            <div>
              <button className="ec-title" onClick={() => open(s.id)}>
                {submissionTitle(s)}
              </button>
              <p className="ec-meta">
                #{s.id} · {s.type} ·{" "}
                {s.contributor?.handle ?? "Contributor not recorded"} ·{" "}
                {new Date(s.created_at).toLocaleDateString()}
              </p>
            </div>
            <div>
              <span className="ec-state">{s.status}</span>
              <p>{submissionNextStep(s)}</p>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
