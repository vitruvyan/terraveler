"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminDashboardData } from "@/lib/adminDashboard";
import "./AdminDashboard.css";
const labels: Record<string, string> = { researching: "Research", writing: "Writing", reviewing: "Agent review", "awaiting-editor": "Awaiting your review", attention: "Needs attention", "not-started": "Not started" };
export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    controller.current?.abort();
    const activeController = new AbortController(); controller.current = activeController;
    const timer = setTimeout(() => activeController.abort(), 30000);
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/desk/dashboard", { cache: "no-store", signal: activeController.signal });
      if (!r.ok) throw Error("The platform overview could not be refreshed. Previously loaded data may be out of date.");
      const next = await r.json(); if (seq === sequence.current) setData(next);
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : "The overview is unavailable."); }
    finally { clearTimeout(timer); if (seq === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const check = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(check, 45000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); ++sequence.current; controller.current?.abort(); };
  }, [refresh]);
  const projects = data?.projects;
  const active = projects?.filter(p => ["researching", "writing", "reviewing"].includes(p.state));
  const attention = projects?.filter(p => p.state === "attention");
  const waiting = projects?.filter(p => p.state === "awaiting-editor");
  const unknown = <p>State unavailable. This is not an empty queue.</p>;
  return <section className="admin-dashboard" aria-label="Platform overview">
    <div className="admin-dashboard-toolbar"><p>Supervise the newsroom, read the work and resolve the exceptions.</p><button className="desk-btn" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "Checking…" : "Refresh overview"}</button></div>
    {error && <p role="alert" className="ec-error">{error}</p>}
    {data && <><p className="ec-meta">Last checked: {data.checked_at}{error ? " · refresh failed" : ""}</p>{data.errors.length > 0 && <p className="ec-error" role="alert">Could not read: {data.errors.join(", ")}. Other sections remain available.</p>}
    <dl className="admin-dashboard-summary">
      <div><dt><a href="#admin-active">Projects in progress</a></dt><dd>{active?.length ?? "Unavailable"}</dd></div>
      <div><dt><a href="#admin-drafts">Saved drafts</a></dt><dd>{data.drafts?.length ?? "Unavailable"}</dd></div>
      <div><dt><a href="#admin-attention">Project blockers</a></dt><dd>{attention?.length ?? "Unavailable"}</dd></div>
      <div><dt><a href="#admin-team">Enabled agents</a></dt><dd>{data.agents?.filter(a => a.enabled).length ?? "Unavailable"}</dd></div>
    </dl>
    <section className="admin-dashboard-section"><h2>Platform status</h2><dl className="admin-dashboard-status"><div><dt>Editorial database</dt><dd>{data.errors.filter(e => e !== "Limen catalogue").length === 0 ? "Dashboard records readable" : "Some records could not be read"}</dd></div><div><dt>Limen</dt><dd>{data.gateway.status === "ready" ? `Model catalogue reachable · ${data.gateway.models.length} models visible` : data.gateway.status === "not-configured" ? "Not configured" : "Unavailable"}</dd></div><div><dt>Work requests</dt><dd>{data.execution_configured ? "Enabled by configuration" : "Disabled by configuration"}</dd></div><div><dt>Editorial worker</dt><dd>Health not verified</dd></div></dl><p className="ec-meta">A reachable catalogue does not verify model generation. A task marked running records a lease, not a live worker health check.</p></section>
    <section className="admin-dashboard-section"><h2 id="admin-attention">Needs your attention</h2>{attention ? attention.length ? attention.map(p => <article className="admin-dashboard-row" key={p.id}><a href={`/desk/projects?topic_id=${p.id}`}>{p.title}</a><p>{p.next_step}</p></article>) : <p>No project blockers reported.</p> : unknown}<p>{data.publication ? `${data.publication.awaiting_decision} submissions marked human-review or appealed. Other decisions may remain in the publication queue.` : "Publication decisions unavailable."} <a href="/desk?tab=workspace">Open review &amp; publication queue</a></p></section>
    <section className="admin-dashboard-section"><h2 id="admin-drafts">Drafts to read</h2><p>Read each saved version and its own review in the preview. A project’s status alone does not certify this version.</p>{waiting && <p>{waiting.length} projects have completed their agent review and await your assessment.</p>}{data.drafts ? data.drafts.length ? data.drafts.map(d => <article className="admin-dashboard-row" key={d.result_id}><div><h3>{d.title}</h3><p className="ec-meta">Saved version #{d.result_id} · Project: {labels[projects?.find(p => p.id === d.topic_id)?.state ?? ""] ?? "Review state unavailable"}</p></div><a className="desk-btn" href={`/desk/projects/${d.topic_id}/preview?result=${d.result_id}`}>Read private preview</a></article>) : <p>No saved drafts yet. Agent research must lead to a saved writer result before there is an edition to read.</p> : unknown}</section>
    <section className="admin-dashboard-section"><h2 id="admin-active">Work in progress</h2>{active ? active.length ? active.map(p => <article className="admin-dashboard-row" key={p.id}><div><h3><a href={`/desk/projects?topic_id=${p.id}`}>{p.title}</a></h3><p>{labels[p.state]} · {p.running} tasks with a running state</p><p>{p.next_step}</p></div></article>) : <p>No active editorial pipeline reported.</p> : unknown}<a href="/desk/projects">All projects →</a></section>
    <section className="admin-dashboard-section"><h2 id="admin-team">Agent team</h2>{data.agents ? data.agents.length ? <><p>{data.agents.filter(a => a.enabled).length} enabled configurations · {data.agents.filter(a => !a.enabled).length} paused. Configuration does not mean an agent is running.</p>{data.agents.map((a, i) => <article className="admin-dashboard-row" key={i}><div><h3>{a.name}</h3><p className="ec-meta">{a.role} · {a.model} · version {a.version}</p></div><span>{a.enabled ? "Enabled configuration" : "Paused"}</span></article>)}</> : <p>No agents configured. Create the first members of the team.</p> : unknown}<a href="/desk/team">Manage agent team →</a></section>
    <section className="admin-dashboard-section"><h2>Published work</h2><p>{data.atlas.length} voyages listed in the public atlas.</p><a href="/desk?tab=content">Browse content catalogue →</a><details><summary>View published voyages</summary><ul>{data.atlas.map(v => <li key={v.href}><a href={v.href}>{v.title}</a></li>)}</ul></details></section></>}
    {!data && loading && <p role="status">Reading platform state…</p>}
  </section>;
}
