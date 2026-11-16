"use client";
import { useRef, useState } from "react";

export default function PreviewRevisionRequest({ topicId, resultId }: { topicId: number; resultId: number }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  async function send(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(""); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/desk/projects/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic_id: topicId, request_id: requestId.current, draft_result_id: resultId, message: message.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.recorded ? "Your message was saved, but no response was received. Retry unchanged to recover it." : data.error || "The request could not be sent. Retry with the same text.");
      const receipt = data.action_receipt;
      setNotice(`${data.reply || "Coordinator replied."}${receipt?.task_id ? ` Work recorded as task #${receipt.task_id}.` : " No task receipt was returned; a reply alone does not confirm changes were scheduled."} This saved preview remains unchanged.`);
      setMessage(""); requestId.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "The coordinator is unavailable. Retry with the same text."); }
    finally { setBusy(false); }
  }
  return <section className="preview-revision" id="revision-request"><h2>Request changes to this version</h2><p>Describe what should change. The coordinator’s response states whether work was recorded. Read the next saved draft to inspect the result.</p><form onSubmit={send}><label htmlFor="preview-revision-message">Message to the editorial coordinator</label><textarea className="desk-input" id="preview-revision-message" rows={4} maxLength={11000} required disabled={busy} value={message} onChange={e => { setMessage(e.target.value); requestId.current = null; }} /><button className="desk-btn" type="submit" disabled={busy || !message.trim()}>{busy ? "Sending…" : "Send request"}</button></form>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</section>;
}
