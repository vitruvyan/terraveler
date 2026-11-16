import TitlePage from "@/components/TitlePage";
import type { EditorialPreview as Preview } from "@/lib/editorialPreview";
import "./EditorialPreview.css";

const verdicts: Record<string, string> = { "ready-for-editor": "Agent review completed", "changes-requested": "The reviewer requested changes", blocked: "The reviewer reported a blocker" };
export default function EditorialPreview({ preview }: { preview: Preview }) {
  const sourceIndex = new Map(preview.sources.map((s, i) => [s.id, i + 1]));
  return <TitlePage eyebrow="Private editorial preview · not published" title={preview.title}
    meta={[`Saved version #${preview.result_id}`, `Writer task #${preview.task_id}`, ...(preview.created_at ? [preview.created_at] : [])]}
    actions={[{ href: `/desk/projects?topic_id=${preview.topic.id}`, label: "Return to project" }, { href: "#revision-request", label: "Request changes", variant: "secondary" }]}>
    <aside className="preview-note"><p>You are reading one saved version of the agents’ work. New drafts do not change this preview.</p><p>This is a text edition. The agents do not yet produce an assembled map, waypoint diary, images or population sections in this workflow. Those parts are missing, rather than hidden elsewhere.</p></aside>
    <article className="preview-article" aria-label="Draft reading edition">
      {preview.paragraphs.map((p, index) => <div key={index}><p className="preview-paragraph">{p.text}</p><p className="preview-citations">{p.source_ids.length ? p.source_ids.map((id, i) => <span key={id}>{i > 0 && " · "}<a href={`#preview-source-${sourceIndex.get(id)}`}>Source {sourceIndex.get(id)}</a></span>) : "No paragraph source mapping recorded."}</p></div>)}
    </article>
    <section className="preview-section" aria-labelledby="preview-sources"><h2 id="preview-sources">Sources used in this draft</h2>{preview.sources.length ? <ol>{preview.sources.map((source, index) => <li id={`preview-source-${index + 1}`} key={source.id}>{source.href ? <a href={source.href} target="_blank" rel="noreferrer noopener">{source.title}</a> : source.title}<p className="preview-citations">{source.rights}</p></li>)}</ol> : <p>No source records are available for this saved draft.</p>}</section>
    <section className="preview-section" aria-labelledby="preview-review"><h2 id="preview-review">Review of this version</h2><p>{preview.review ? verdicts[preview.review.verdict] : "No completed agent review is recorded for this draft."} This is not publication authorization.</p>{preview.review && preview.review.issues.length > 0 && <ul>{preview.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}</section>
  </TitlePage>;
}
