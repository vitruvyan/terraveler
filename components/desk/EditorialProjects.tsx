"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./EditorialProjects.css";

type Message = { role: string; content: string; created_at: string };
type Project = {
  id: number; topic_key: string; title: string; objective: string;
  contributions: { submission_id: number; title: string; type: string; status: string }[];
  tasks: { id: number; role: string; state: string; attempt: number; agent?: unknown }[];
  pipeline: { id: number; state: string; revision: number; next_step: string } | null;
  latest_draft: { title: string; body: string } | null;
};
type Receipt = { run_id?: string | number; task_id?: number; replayed?: boolean };
const stages: Record<string, string> = { researching: "Research stage", writing: "Draft stage", reviewing: "Review stage", "awaiting-editor": "Draft ready for your decision", attention: "Your attention is needed" };
function status(project: Project) { return project.pipeline ? stages[project.pipeline.state] || project.pipeline.state.replaceAll("_", " ").replaceAll("-", " ") : "Not started"; }
async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${data.error || `Request failed (${response.status}).`}${data.recorded ? " Your message was saved; retry with the same text to recover the response." : ""}`);
  return data;
}
export default function EditorialProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [configured, setConfigured] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Project | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attach, setAttach] = useState({ submission_id: "", topic_key: "", title: "", objective: "" });
  const [briefs, setBriefs] = useState<Record<number, string>>({});
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const requestIds = useRef<Record<string, string>>({});
  const detailSequence = useRef(0);
  const selectedRef = useRef<number | null>(null);
  const listSequence = useRef(0);
  const load = useCallback(async () => {
    const seq = ++listSequence.current;
    try {
      const data = await readResponse(await fetch("/api/desk/projects", { cache: "no-store" }));
      if (seq === listSequence.current) { setProjects(data.projects || []); setConfigured(Boolean(data.execution?.configured)); }
    } catch (e) { if (seq === listSequence.current) setError(e instanceof Error ? e.message : "Could not load projects."); }
    finally { if (seq === listSequence.current) setLoading(false); }
  }, []);
  const loadDetail = useCallback(async (id: number) => {
    const seq = ++detailSequence.current;
    setDetailLoading(true);
    try {
      const data = await readResponse(await fetch(`/api/desk/projects?topic_id=${id}`, { cache: "no-store" }));
      if (seq === detailSequence.current && selectedRef.current === id) { setDetail(data.project); setMessages(data.messages || []); setConfigured(Boolean(data.execution?.configured)); }
    } catch (e) { if (seq === detailSequence.current) setError(e instanceof Error ? e.message : "Could not load this project."); }
    finally { if (seq === detailSequence.current) setDetailLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function select(id: number) {
    const next = selected === id ? null : id;
    selectedRef.current = next; setSelected(next); setDetail(null); setMessages([]); setError(""); setNotice("");
    ++detailSequence.current;
    if (next !== null) void loadDetail(next);
  }
  function requestId(key: string) { return requestIds.current[key] ||= crypto.randomUUID(); }
  function receiptText(receipt?: Receipt) { return receipt ? ` Work recorded${receipt.task_id ? ` as task #${receipt.task_id}` : ""}${receipt.run_id ? ` (run ${receipt.run_id})` : ""}.` : ""; }
  async function attachProposal(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await readResponse(await fetch("/api/desk/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "attach", ...attach, submission_id: Number(attach.submission_id) }) }));
      setNotice("Proposal attached to its project."); setAttach({ submission_id: "", topic_key: "", title: "", objective: "" }); setAttachOpen(false); await load();
      if (selected !== null) await loadDetail(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not attach proposal."); } finally { setBusy(false); }
  }
  async function start(event: React.FormEvent, id: number) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const key = `start:${id}`;
    try {
      const data = await readResponse(await fetch("/api/desk/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", topic_id: id, brief: briefs[id] || "", request_id: requestId(key) }) }));
      setNotice(`Editorial work requested.${receiptText(data.action_receipt || data)}`); delete requestIds.current[key];
      await load(); await loadDetail(id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start work."); } finally { setBusy(false); }
  }
  async function chat(event: React.FormEvent, id: number) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const key = `chat:${id}`;
    try {
      const data = await readResponse(await fetch("/api/desk/projects/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic_id: id, message: inputs[id], request_id: requestId(key) }) }));
      setInputs(current => ({ ...current, [id]: "" })); delete requestIds.current[key];
      if (data.reply) setMessages(current => [...current, { role: "user", content: inputs[id], created_at: "" }, { role: "assistant", content: data.reply, created_at: "" }]);
      setNotice(data.action_receipt ? `Coordinator request saved.${receiptText(data.action_receipt)}` : "Coordinator replied.");
      await load(); await loadDetail(id);
    } catch (e) { setError(e instanceof Error ? e.message : "The coordinator could not reply."); await loadDetail(id); } finally { setBusy(false); }
  }
  const needsAttention = projects.filter(p => p.pipeline && ["attention", "awaiting-editor"].includes(p.pipeline.state)).length;
  return <section className="editorial-projects" aria-label="Editorial projects">
    <p className="projects-intro">One project collects the proposals, evidence and drafts for one topic. Agents combine the contributions and review the result. You supervise progress and authorize publication from the editorial desk.</p>
    <div className="projects-toolbar"><p className="ec-meta">{projects.length} projects · {needsAttention} need your decision</p><div className="ec-actions"><button type="button" className="desk-btn" disabled={busy} onClick={() => { setError(""); void load(); if (selected !== null) void loadDetail(selected); }}>Refresh status</button><button type="button" className="desk-btn" disabled={busy} aria-expanded={attachOpen} onClick={() => setAttachOpen(!attachOpen)}>Attach approved proposal</button></div></div>
    {!loading && !configured && <p className="ec-notice">Work requests are disabled. Projects can be organized now; the operator enables requests after configuring the editorial worker.</p>}
    {error && <p className="ec-error" role="alert">{error}</p>}{notice && <p className="ec-notice" role="status">{notice}</p>}
    {attachOpen && <form className="projects-form" onSubmit={attachProposal}><h2>Attach an approved proposal</h2><p>Use the same topic key to collect related contributions in an existing project. Similar titles are never merged automatically.</p><fieldset disabled={busy}><div className="projects-fields">{([['submission_id', 'Approved proposal number'], ['topic_key', 'Topic key'], ['title', 'Project title']] as const).map(([key, label]) => <label key={key}>{label}<input className="desk-input" required type={key === 'submission_id' ? 'number' : 'text'} min={key === 'submission_id' ? 1 : undefined} value={attach[key]} onChange={e => setAttach({ ...attach, [key]: e.target.value })} /></label>)}<label>Editorial objective<textarea className="desk-input" rows={3} required value={attach.objective} onChange={e => setAttach({ ...attach, objective: e.target.value })} /></label></div><button className="desk-btn desk-btn-primary" type="submit">Attach proposal</button></fieldset></form>}
    {loading ? <p role="status">Loading projects…</p> : projects.length === 0 ? <p className="ec-empty">No editorial projects yet. Attach an approved proposal to collect its contributions and commission agent work.</p> : <div className="projects-ledger">{projects.map(project => <article key={project.id} className="projects-item">
      <div className="ec-row"><div><h2><button type="button" className="projects-title" disabled={busy} aria-expanded={selected === project.id} aria-controls={`project-${project.id}`} onClick={() => select(project.id)}>{project.title}</button></h2><p className="ec-meta">{project.topic_key} · {project.contributions.length} contributions</p><p>{project.objective || "No editorial objective recorded."}</p></div><div><p className="projects-state">{status(project)}</p><p>{project.pipeline?.next_step || "Next: define the brief and start editorial work."}</p><button className="desk-btn" type="button" disabled={busy} onClick={() => select(project.id)}>{selected === project.id ? "Close project" : "Open project"}</button></div></div>
      {selected === project.id && <div className="projects-detail" id={`project-${project.id}`}>{detailLoading && <p role="status">Refreshing project…</p>}{detail && <>
        <section><h3>Collected contributions</h3>{detail.contributions.length ? <ul className="projects-contributions">{detail.contributions.map(c => <li key={c.submission_id}><a href={`/desk?tab=submissions&submission_id=${c.submission_id}`}>{c.title || `Proposal #${c.submission_id}`}</a><span className="ec-meta"> #{c.submission_id} · {c.type} · {c.status}</span></li>)}</ul> : <p>No contributions attached.</p>}</section>
        <section><h3>Agent work</h3>{detail.tasks.length ? <ul className="projects-contributions">{detail.tasks.map(t => <li key={t.id}><span>{t.role}</span><span className="ec-meta"> · task #{t.id} · {t.state} · attempt {t.attempt}</span></li>)}</ul> : <p>No agent work has been requested.</p>}{detail.pipeline && <p className="ec-meta">Pipeline #{detail.pipeline.id} · revision {detail.pipeline.revision}</p>}</section>
        {detail.latest_draft && <section><h3>Latest draft · {detail.latest_draft.title}</h3><div className="projects-draft">{detail.latest_draft.body}</div><p>Draft only. Publication requires your authorization in the editorial desk.</p></section>}
        <form className="projects-form" onSubmit={event => start(event, project.id)}><h3>Commission editorial work</h3><p>Agents research this topic, combine the contributions into a draft and review it. A request records work for the worker; refresh to see progress.</p><label>Brief<textarea aria-label="Brief" className="desk-input" required rows={3} disabled={busy} value={briefs[project.id] || ""} onChange={e => { setBriefs({ ...briefs, [project.id]: e.target.value }); delete requestIds.current[`start:${project.id}`]; }} /></label><button type="submit" className="desk-btn desk-btn-primary" disabled={busy || !configured || !(briefs[project.id] || "").trim()}>Start editorial work</button></form>
        <section className="projects-chat"><h3>Talk to the editorial coordinator</h3><p>Ask about this project or request a specific change. A reply confirms whether work was recorded; it does not publish content.</p><ol className="projects-messages" aria-label="Project conversation">{messages.map((m, index) => <li key={`${m.created_at}-${index}`}><p className="ec-meta">{m.role === "user" ? "You" : m.role === "assistant" ? "Coordinator" : m.role}{m.created_at ? ` · ${m.created_at}` : ""}</p><p className="projects-message-body">{m.content}</p></li>)}</ol><form onSubmit={event => chat(event, project.id)}><label>Message<textarea aria-label="Message" className="desk-input" rows={3} required disabled={busy} value={inputs[project.id] || ""} onChange={e => { setInputs({ ...inputs, [project.id]: e.target.value }); delete requestIds.current[`chat:${project.id}`]; }} /></label><button type="submit" className="desk-btn desk-btn-primary" disabled={busy || !configured || !(inputs[project.id] || "").trim()}>Send</button></form></section>
      </>}</div>}
    </article>)}</div>}
  </section>;
}
