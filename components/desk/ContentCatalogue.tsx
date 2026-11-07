"use client";

import { useEffect, useState } from "react";
import {
  filterProjects, projectNextStep, projectStatus,
  type DeskContent,
} from "@/lib/deskContent";

type Filters = { kind: "projects" | "voyages"; query: string; status: string };
const DEFAULTS: Filters = { kind: "projects", query: "", status: "all" };

function readFilters(): Filters {
  if (typeof window === "undefined") return DEFAULTS;
  const params = new URLSearchParams(window.location.search);
  const status = params.get("contentStatus") ?? "all";
  return {
    kind: params.get("contentKind") === "voyages" ? "voyages" : "projects",
    query: params.get("contentQuery") ?? "",
    status: ["all", "open", "claimed", "done"].includes(status) ? status : "all",
  };
}

export default function ContentCatalogue({ data, loading, error, onRetry }: {
  data: DeskContent | null;
  loading: boolean;
  error: string;
  onRetry?: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  useEffect(() => {
    setFilters(readFilters());
    const onBack = () => setFilters(readFilters());
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);

  function change(next: Filters, replace = false) {
    setFilters(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "content");
    params.set("contentKind", next.kind);
    if (next.query) params.set("contentQuery", next.query); else params.delete("contentQuery");
    if (next.status !== "all") params.set("contentStatus", next.status); else params.delete("contentStatus");
    window.history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}?${params}`);
  }

  if (loading) return <p className="ec-meta" role="status">Loading the content catalogue…</p>;
  if (error) return <div className="ec-error" role="alert"><p>{error}</p>{onRetry && <button type="button" className="desk-btn" onClick={onRetry}>Retry catalogue</button>}</div>;
  if (!data) return <p className="ec-meta">The content catalogue has not been loaded.</p>;

  const projects = filterProjects(data.projects, filters.query, filters.status);
  const needle = filters.query.trim().toLocaleLowerCase();
  const voyages = data.voyages.filter((v) => `${v.title} ${v.slug} ${v.navigator}`.toLocaleLowerCase().includes(needle));

  return <section className="ec-catalogue" aria-label="Content catalogue">
    <p className="ec-intro">Projects describe work to do. Published voyages are listed separately from the atlas. An approved contribution is not proof that a voyage is online.</p>
    <div className="ec-tabs" aria-label="Content type">
      <button type="button" className="desk-btn" aria-pressed={filters.kind === "projects"} onClick={() => change({ ...filters, kind: "projects" })}>Projects ({data.projects.length})</button>
      <button type="button" className="desk-btn" aria-pressed={filters.kind === "voyages"} onClick={() => change({ ...filters, kind: "voyages", status: "all" })}>Published voyages ({data.voyages.length})</button>
    </div>
    <div className="ec-filters">
      <label>Search by title, author or reference<input className="desk-input" type="search" value={filters.query} placeholder="Title or reference" onChange={(e) => change({ ...filters, query: e.target.value }, true)} /></label>
      {filters.kind === "projects" && <label>Project state<select className="desk-input" value={filters.status} onChange={(e) => change({ ...filters, status: e.target.value })}>
        <option value="all">All states</option><option value="open">Waiting for an author</option><option value="claimed">In progress</option><option value="done">Work marked done</option>
      </select></label>}
      <button type="button" className="desk-btn" onClick={() => change({ ...DEFAULTS, kind: filters.kind })}>Clear filters</button>
    </div>
    <p className="ec-meta" role="status">{filters.kind === "projects" ? projects.length : voyages.length} matching {filters.kind}</p>
    {filters.kind === "projects" ? <>
      {!data.proposalLinksAvailable && <p className="ec-notice">Proposal-to-project links are unavailable until the project-link migration is applied. Existing work remains listed below.</p>}
      {projects.length === 0 && <p className="ec-empty">{data.projects.length ? "No projects match these filters." : "No editorial projects are recorded yet."}</p>}
      {projects.map((project) => <details className="ec-record" key={project.id}>
        <summary className="ec-record-summary"><span><strong className="ec-title">{project.title}</strong><span className="ec-meta">Project #{project.id} · {project.kind} · {project.claimed_by ?? "No author assigned"}</span></span><span className="ec-state">{projectStatus(project)}</span></summary>
        <div className="ec-record-body"><p className="ec-next">{projectNextStep(project)}</p><p className="ec-prose">{project.description ?? "No project brief is recorded."}</p>
          <p className="ec-meta">Drafts are not yet linked to projects. This record cannot establish which drafts or published content belong to it.</p>
          <div className="ec-actions">{project.status !== "done" && <a href="/contribute">Find work in the Chartroom</a>}{project.source_submission_id != null && <a href={`/desk?tab=submissions&submission=${project.source_submission_id}`}>Open source proposal #{project.source_submission_id}</a>}</div>
        </div>
      </details>)}
    </> : <>
      {voyages.length === 0 && <p className="ec-empty">No published voyages match this search.</p>}
      {voyages.map((voyage) => <article className="ec-row" key={voyage.slug}><div><h2 className="ec-title"><a href={voyage.href}>{voyage.title}</a></h2><p>{voyage.navigator} · {voyage.years}</p><p className="ec-meta">{voyage.slug} · Listed in the published atlas</p></div><a href={voyage.href}>Open voyage</a></article>)}
    </>}
  </section>;
}
