"use client";
import { useRef, useState } from "react";
import { submissionTitle, type DeskSubmission } from "@/lib/deskPresentation";
export default function EditorTools({
  submission,
  target,
  onChanged,
}: {
  submission?: DeskSubmission;
  target?: {
    type: "submission" | "project" | "voyage";
    id: string;
    title: string;
    version: number;
  };
  onChanged: () => Promise<void>;
}) {
  const current = submission
    ? {
        type: "submission" as const,
        id: String(submission.id),
        title: submissionTitle(submission),
        version: submission.title_version ?? 0,
      }
    : target;
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const [editing, setEditing] = useState(false),
    [title, setTitle] = useState(current?.title ?? ""),
    [revision, setRevision] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(action: "rename" | "request-revision", value: string) {
    if (!current) return;
    const signature = JSON.stringify([
      current.type,
      current.id,
      action,
      value,
      current.version,
    ]);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/desk/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          target_type: current.type,
          target_id: current.id,
          value,
          expected_version: current.version,
          request_id: pending.current.id,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not save the change.");
      setMessage(
        action === "rename"
          ? "Editorial title saved. The original submitted record is preserved."
          : `Revision request saved as work #${j.result?.gap_id ?? "recorded"}. Waiting for an agent to take it.`,
      );
      setEditing(false);
      setRevision("");
      await onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save the change.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ed-tools">
      <button
        className="desk-btn"
        onClick={() => {
          setTitle(current?.title ?? "");
          setEditing(!editing);
        }}
        disabled={busy}
      >
        Edit title
      </button>
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save("rename", title.trim());
          }}
        >
          <label>
            Editorial title
            <input
              className="desk-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </label>
          <p className="ec-meta">
            This edits the Desk title. Changing published wording requires a
            reviewed revision.
          </p>
          <div className="ec-actions">
            <button
              className="desk-btn desk-btn-primary"
              disabled={busy || !title.trim()}
            >
              Save title
            </button>
            <button
              className="desk-btn"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <details>
        <summary>Request a change from an agent</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save("request-revision", revision.trim());
          }}
        >
          <label>
            What should change?
            <textarea
              className="desk-input"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              maxLength={6000}
            />
          </label>
          <p className="ec-meta">
            Creates an open editorial task. It is not executed until an agent
            takes it.
          </p>
          <button className="desk-btn" disabled={busy || !revision.trim()}>
            Create revision request
          </button>
        </form>
      </details>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
