"use client";
import { useEffect, useState } from "react";
import ChatBubble from "@/components/ChatBubble";
export type EditorContext = {
  type: "submission" | "project" | "voyage";
  id: string;
  title: string;
  version: number;
};
type Action = {
  type: "rename" | "request-revision";
  target_type: EditorContext["type"];
  target_id: string;
  value: string;
  expected_version?: number;
};
type Message = {
  role: "user" | "assistant";
  content: string;
  action?: Action;
  requestId?: string;
  applied?: boolean;
};
export default function EditorAssistant({
  context,
  onChanged,
}: {
  context: EditorContext | null;
  onChanged: () => Promise<void>;
}) {
  const [config, setConfig] = useState<{
      configured: boolean;
      model?: string;
      message?: string;
    } | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    fetch("/api/desk/assistant")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (current) setConfig(j);
      })
      .catch(() => {
        if (current)
          setError("Could not check the local assistant connection.");
      });
    return () => {
      current = false;
    };
  }, []);
  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setError("");
    setBusy(true);
    setInput("");
    const history = messages
      .map(({ role, content }) => ({ role, content }))
      .slice(-10);
    setMessages((m) => [...m, { role: "user", content: question }]);
    try {
      const r = await fetch("/api/desk/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history,
          ...(context
            ? { target_type: context.type, target_id: context.id }
            : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Local assistant unavailable.");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: j.answer,
          action: j.action,
          requestId: crypto.randomUUID(),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Local assistant unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function apply(index: number) {
    const m = messages[index],
      a = m.action;
    if (
      !a ||
      !context ||
      a.target_type !== context.type ||
      a.target_id !== context.id ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/desk/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: a.type,
          target_type: a.target_type,
          target_id: a.target_id,
          value: a.value,
          expected_version: a.expected_version ?? context.version,
          request_id: m.requestId,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not save the action.");
      setMessages((old) =>
        old.map((v, i) =>
          i === index
            ? {
                ...v,
                applied: true,
                content:
                  v.content +
                  "\n\n" +
                  (a.type === "rename"
                    ? "Editorial title saved."
                    : `Request recorded as work #${j.result?.gap_id ?? "recorded"}; waiting for an agent.`),
              }
            : v,
        ),
      );
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the action.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="ed-assistant" aria-label="Local editorial assistant">
      <h2>Editorial assistant</h2>
      <p className="ec-meta">
        Local AI ·{" "}
        {config?.configured ? config.model : "Connection not configured"}
      </p>
      <p>
        {context
          ? `Working on: ${context.title}`
          : "Select a proposal or draft to work on it with your assistant."}
      </p>
      {config && !config.configured && (
        <p className="ec-notice">
          {config.message ??
            "The local server address and model must be configured on the backend. No cloud fallback is used."}
        </p>
      )}
      <div className="ed-messages" aria-live="polite">
        {messages.map((m, i) => (
          <div className={`pig-msg pig-${m.role}`} key={i}>
            <span className="ec-meta">
              {m.role === "user" ? "You" : "Local assistant"}
            </span>
            <ChatBubble content={m.content} />
            {m.action && !m.applied && (
              <div className="ec-notice">
                <p>
                  {m.action.type === "rename"
                    ? "Proposed editorial title"
                    : "Proposed revision request"}
                </p>
                <p>{m.action.value}</p>
                <button
                  className="desk-btn"
                  disabled={busy || !context}
                  onClick={() => apply(i)}
                >
                  {m.action.type === "rename"
                    ? "Save this title"
                    : "Create this request"}
                </button>
                <button
                  className="desk-btn"
                  disabled={busy}
                  onClick={() =>
                    setMessages((old) =>
                      old.map((v, j) =>
                        i === j ? { ...v, action: undefined } : v,
                      ),
                    )
                  }
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p className="ec-error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="ed-question">
          Ask for an edit or a next step
          <textarea
            id="ed-question"
            className="desk-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={6000}
            placeholder="Shorten this title, or ask the author to add more context…"
            disabled={busy}
          />
        </label>
        <button
          className="desk-btn desk-btn-primary"
          disabled={busy || !config?.configured || !input.trim()}
        >
          {busy ? "Working…" : "Send to local assistant"}
        </button>
      </form>
      <p className="ec-meta">
        Edits are saved only through the action buttons. The assistant cannot
        publish.
      </p>
    </aside>
  );
}
