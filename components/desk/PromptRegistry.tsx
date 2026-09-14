"use client";

import { useState } from "react";
import { PROMPT_KEYS, PROMPT_LABEL, type PromptKey } from "@/lib/promptRegistry";

/* The prompt registry, edited from the desk. Same append-only discipline as
 * Sources: a new version is added, never an old one changed — so "Save"
 * here reads as "publish a new version" rather than "overwrite," and the
 * history below is a real record, not a chat log that can be edited later.
 */

export type PromptVersion = {
  id: number;
  prompt_key: PromptKey;
  version: number;
  body: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

type Draft = { body: string; notes: string };

function groupByKey(versions: PromptVersion[]): Record<PromptKey, PromptVersion[]> {
  const grouped = {} as Record<PromptKey, PromptVersion[]>;
  for (const key of PROMPT_KEYS) grouped[key] = [];
  for (const v of versions) {
    if (grouped[v.prompt_key]) grouped[v.prompt_key].push(v);
  }
  // agent_prompts?order=prompt_key.asc,version.desc already sorts each
  // group newest-first; re-sort defensively so a caller passing raw rows in
  // any order still gets a correct "current" at index 0.
  for (const key of PROMPT_KEYS) grouped[key].sort((a, b) => b.version - a.version);
  return grouped;
}

export function PromptEditor({
  versions,
  busy,
  onSave,
}: {
  versions: PromptVersion[];
  busy: boolean;
  onSave?: (key: PromptKey, body: string, notes: string) => void;
}) {
  const grouped = groupByKey(versions);
  const [drafts, setDrafts] = useState<Partial<Record<PromptKey, Draft>>>({});

  function draftFor(key: PromptKey, current: PromptVersion | undefined): Draft {
    return drafts[key] ?? { body: current?.body ?? "", notes: "" };
  }

  function setDraft(key: PromptKey, patch: Partial<Draft>, current: PromptVersion | undefined) {
    setDrafts((d) => ({ ...d, [key]: { ...draftFor(key, current), ...patch } }));
  }

  return (
    <div className="pr-list">
      {PROMPT_KEYS.map((key) => {
        const history = grouped[key];
        const current = history[0];
        const draft = draftFor(key, current);
        const changed = current ? draft.body !== current.body : draft.body.trim().length > 0;

        return (
          <section key={key} className="pr-card">
            <div className="pr-card-head">
              <strong className="pr-card-title">{PROMPT_LABEL[key]}</strong>
              <span className="dk-id">v{current?.version ?? "—"}</span>
            </div>
            {!current && <p className="dk-empty">No version recorded yet.</p>}

            <textarea
              className="desk-input pr-textarea"
              value={draft.body}
              onChange={(e) => setDraft(key, { body: e.target.value }, current)}
              rows={10}
            />
            <input
              className="desk-input pr-notes"
              placeholder="notes for this version (why the change — recorded permanently)"
              value={draft.notes}
              onChange={(e) => setDraft(key, { notes: e.target.value }, current)}
            />
            <button
              className="desk-btn desk-btn-primary"
              disabled={busy || !changed || !draft.body.trim()}
              onClick={() => {
                onSave?.(key, draft.body, draft.notes);
                setDrafts((d) => ({ ...d, [key]: { body: draft.body, notes: "" } }));
              }}
            >
              Publish as v{(current?.version ?? 0) + 1}
            </button>

            {history.length > 1 && (
              <details className="pr-history">
                <summary>Earlier versions ({history.length - 1})</summary>
                <div className="src-history-list">
                  {history.slice(1).map((v) => (
                    <details key={v.id} className="pr-history-row">
                      <summary>
                        <span className="dk-id">v{v.version}</span>
                        <span className="dk-id">{new Date(v.created_at).toLocaleDateString()}</span>
                        {v.created_by && <span className="dk-id">{v.created_by}</span>}
                        {v.notes && <span className="src-history-reason">{v.notes}</span>}
                      </summary>
                      <pre className="pr-old-body">{v.body}</pre>
                    </details>
                  ))}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
