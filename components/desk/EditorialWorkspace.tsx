"use client";
import { useEffect, useState } from "react";
import SubmissionQueue, { type VerdictFeedback } from "./SubmissionQueue";
import EditorAssistant, { type EditorContext } from "./EditorAssistant";
import EditorTools from "./EditorTools";
import {
  editorialLane,
  submissionTitle,
  type DeskSubmission,
  type EditorialLane,
} from "@/lib/deskPresentation";
import type { DeskContent } from "@/lib/deskContent";
const LANES: { id: EditorialLane; label: string; description: string }[] = [
  {
    id: "drafts",
    label: "Proposals & drafts",
    description: "Ideas to assess, work in preparation and agent reviews.",
  },
  {
    id: "ready",
    label: "To publish",
    description:
      "Reviewed drafts and authorizations. You retain the final decision.",
  },
  {
    id: "published",
    label: "Published",
    description: "Voyages available in this edition of the atlas.",
  },
];
export default function EditorialWorkspace({
  submissions,
  content,
  loading,
  error,
  onRetry,
  onVerdict,
  busy,
  onAdministration,
  readOnly = false,
}: {
  readOnly?: boolean;
  submissions: DeskSubmission[];
  content: DeskContent | null;
  loading: boolean;
  error: string;
  onRetry: () => Promise<void>;
  onVerdict: (
    id: number,
    v: string,
    note: string,
    override?: string,
  ) => Promise<VerdictFeedback>;
  busy: boolean;
  onAdministration: () => void;
}) {
  const [otherContext, setOtherContext] = useState<EditorContext | null>(null);
  const [lane, setLane] = useState<EditorialLane>("drafts"),
    [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => {
      const p = new URLSearchParams(location.search),
        v = p.get("lane");
      setOtherContext(null);
      setLane(v === "ready" || v === "published" ? v : "drafts");
    };
    sync();
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);
  const active = submissions.filter(
    (s) => !["rejected", "curator-rejected"].includes(s.status),
  );
  const selectedRecord = submissions.find((s) => s.id === selected);
  function change(next: EditorialLane) {
    setLane(next);
    setSelected(null);
    setOtherContext(null);
    const p = new URLSearchParams(location.search);
    p.set("tab", "workspace");
    p.set("lane", next);
    for (const k of ["submission", "q", "type", "status"]) p.delete(k);
    history.pushState(null, "", `/desk?${p}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }
  function selectOther(target: EditorContext) {
    const p = new URLSearchParams(location.search);
    p.delete("submission");
    history.pushState(null, "", `/desk?${p}`);
    dispatchEvent(new PopStateEvent("popstate"));
    setSelected(null);
    setOtherContext(target);
  }
  const refreshedOther =
    otherContext?.type === "project"
      ? content?.projects.find((p) => String(p.id) === otherContext.id)
      : otherContext?.type === "voyage"
        ? content?.voyages.find((v) => v.slug === otherContext.id)
        : null;
  const other =
    otherContext && refreshedOther
      ? {
          ...otherContext,
          title:
            ("editorial_title" in refreshedOther
              ? refreshedOther.editorial_title
              : null) ?? refreshedOther.title,
          version: refreshedOther.title_version ?? 0,
        }
      : otherContext;
  const context = selectedRecord
    ? {
        type: "submission" as const,
        id: String(selectedRecord.id),
        title: submissionTitle(selectedRecord),
        version: selectedRecord.title_version ?? 0,
      }
    : other;
  const items = selectedRecord
    ? submissions
    : active.filter((s) => editorialLane(s) === lane);
  return (
    <main className="dk-page ed-workspace">
      <header className="ed-header">
        <div>
          <span className="dk-eyebrow">Terraveler · editorial desk</span>
          <h1 className="dk-title">Your editorial desk</h1>
          <a className="desk-btn" href="/desk/projects">Proposals &amp; projects</a>{" "}
          <a className="desk-btn" href="/desk/team">Agent team</a>
          <p>Find the work. Ask for changes. Decide what goes public.</p>
        </div>
        <button className="desk-btn" onClick={onAdministration}>
          Administration
        </button>
      </header>
      <nav className="ed-lanes" aria-label="Editorial workflow">
        {LANES.map((l) => (
          <button
            key={l.id}
            className="desk-btn"
            aria-pressed={lane === l.id}
            onClick={() => change(l.id)}
          >
            {l.label}
            <span className="ec-meta">
              {loading
                ? "…"
                : l.id === "published"
                  ? (content?.voyages.length ?? "—")
                  : active.filter((s) => editorialLane(s) === l.id).length}
            </span>
          </button>
        ))}
      </nav>
      <p>{LANES.find((l) => l.id === lane)?.description}</p>
      <div className="ed-columns">
        <div className="ed-work">
          <div className="ec-error" role="alert" hidden={!error}>
            {error}{" "}
            <button className="desk-btn" onClick={onRetry}>
              Retry desk data
            </button>
          </div>
          {other && !selectedRecord && (
            <section className="ec-next">
              <h2>{other.title}</h2>
              <p className="ec-meta">Selected {other.type}</p>
              {!readOnly && (
                <EditorTools
                  key={`${other.type}:${other.id}`}
                  target={other}
                  onChanged={onRetry}
                />
              )}
              <button
                className="desk-btn"
                onClick={() => setOtherContext(null)}
              >
                Close selected content
              </button>
            </section>
          )}
          {lane === "published" && !selectedRecord ? (
            <section>
              <p className="ec-meta">
                These voyages are in the deployed atlas. A submission’s approval
                alone does not establish publication.
              </p>
              {content?.voyages.map((v) => (
                <article className="ec-row" key={v.slug}>
                  <div>
                    <h2 className="ec-title">
                      <a href={v.href}>{v.title}</a>
                    </h2>
                    <p>
                      {v.navigator} · {v.years}
                    </p>
                  </div>
                  <div>
                    <a href={v.href}>Open voyage →</a>
                    <button
                      className="desk-btn"
                      onClick={() => {
                        selectOther({
                          type: "voyage",
                          id: v.slug,
                          title: v.editorial_title ?? v.title,
                          version: v.title_version ?? 0,
                        });
                      }}
                    >
                      Work with assistant
                    </button>
                    {v.editorial_title && (
                      <p className="ec-meta">
                        Desk title: {v.editorial_title}. The public title above
                        is unchanged.
                      </p>
                    )}
                  </div>
                </article>
              ))}
              <details className="ed-projects">
                <summary>
                  Publication receipts ·{" "}
                  {
                    submissions.filter((s) => editorialLane(s) === "published")
                      .length
                  }
                </summary>
                <p className="ec-meta">
                  A receipt records publication work; deployment of that exact
                  revision is not verified here.
                </p>
                <SubmissionQueue
                  submissions={submissions.filter(
                    (s) => editorialLane(s) === "published",
                  )}
                  onSelectionChange={setSelected}
                  onRetry={onRetry}
                  renderTools={
                    readOnly
                      ? undefined
                      : (s) => (
                          <EditorTools submission={s} onChanged={onRetry} />
                        )
                  }
                />
              </details>
              {!loading && !error && !content?.voyages.length && (
                <p>No published voyages could be listed.</p>
              )}
            </section>
          ) : (
            <SubmissionQueue
              key={lane}
              submissions={items}
              loading={loading}
              error={error}
              onRetry={onRetry}
              onVerdict={readOnly ? undefined : onVerdict}
              busy={busy}
              onSelectionChange={setSelected}
              renderTools={
                readOnly
                  ? undefined
                  : (s) => (
                      <EditorTools
                        key={s.id}
                        submission={s}
                        onChanged={onRetry}
                      />
                    )
              }
            />
          )}{" "}
          {lane === "drafts" && content && (
            <details className="ed-projects">
              <summary>
                Open editorial work ·{" "}
                {content.projects.filter((p) => p.status !== "done").length}
              </summary>
              {content.projects
                .filter((p) => p.status !== "done")
                .map((p) => (
                  <article className="ec-row" key={p.id}>
                    <div>
                      <h3>{p.title}</h3>
                      <p className="ec-meta">
                        {p.claimed_by
                          ? `Assigned to ${p.claimed_by}`
                          : "Waiting for an author"}
                      </p>
                    </div>
                    <div>
                      <button
                        className="desk-btn"
                        onClick={() => {
                          selectOther({
                            type: "project",
                            id: String(p.id),
                            title: p.title,
                            version: p.title_version ?? 0,
                          });
                        }}
                      >
                        Work with assistant
                      </button>
                      <a href="/contribute">Open contributor workspace →</a>
                    </div>
                  </article>
                ))}
            </details>
          )}
        </div>
        {readOnly ? (
          <aside className="ed-assistant">
            <h2>Editorial assistant</h2>
            <p>
              Preview only. Local inference and editing are disabled in this
              fixture.
            </p>
          </aside>
        ) : (
          <EditorAssistant
            key={context ? `${context.type}:${context.id}` : "general"}
            context={context}
            onChanged={onRetry}
          />
        )}
      </div>
    </main>
  );
}
