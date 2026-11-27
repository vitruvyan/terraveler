import TitlePage from "@/components/TitlePage";
import EditorialWaypointMap from "@/components/desk/EditorialWaypointMap";
import type { EditorialPreview as Preview } from "@/lib/editorialPreview";
import "./EditorialPreview.css";

const depictions: Record<string, string> = {
  "period-artwork": "period artwork", "period-map": "period map", "period-document": "period document",
  "later-artwork": "later artwork", "later-map": "later map", "modern-photograph": "modern photograph",
  "modern-reproduction": "modern reproduction", unknown: "undetermined",
};
const verdicts: Record<string, string> = { "ready-for-editor": "Agent review completed", "changes-requested": "The reviewer requested changes", blocked: "The reviewer reported a blocker" };
export default function EditorialPreview({ preview }: { preview: Preview }) {
  const sourceIndex = new Map(preview.sources.map((s, i) => [s.id, i + 1]));
  return <TitlePage eyebrow="Private editorial preview · not published" title={preview.title}
    meta={[`Saved version #${preview.result_id}`, `Writer task #${preview.task_id}`, ...(preview.created_at ? [preview.created_at] : [])]}
    actions={[{ href: `/desk/projects?topic_id=${preview.topic.id}`, label: "Return to project" }, { href: "#revision-request", label: "Request changes", variant: "secondary" }]}>
    <aside className="preview-note"><p>You are reading one saved version of the agents’ work. New drafts do not change this preview.</p><p>Text, candidate waypoints and image plates appear below only when present in this version. Population sections are not yet produced in this workflow and remain explicitly missing.</p></aside>
    <article className="preview-article" aria-label="Draft reading edition">
      {preview.paragraphs.map((p, index) => <div key={index}><p className="preview-paragraph">{p.text}</p><p className="preview-citations">{p.source_ids.length ? p.source_ids.map((id, i) => <span key={id}>{i > 0 && " · "}<a href={`#preview-source-${sourceIndex.get(id)}`}>Source {sourceIndex.get(id)}</a></span>) : "No paragraph source mapping recorded."}</p></div>)}
    </article>
    <section className="preview-section" aria-labelledby="preview-waypoints"><h2 id="preview-waypoints">Candidate waypoint route</h2>
      <p>These are agent-produced candidates, not independently verified geography. Lines connect points in sequence; they are not reconstructed navigation tracks.</p>
      {preview.waypoints_omitted > 0 && <p>{preview.waypoints_omitted} malformed waypoint {preview.waypoints_omitted === 1 ? "record was" : "records were"} omitted from this preview.</p>}
      {preview.waypoints.length === 0 ? <p>No structured waypoint route is stored in this saved version.</p> : <>
        <div className="preview-map-mount"><EditorialWaypointMap waypoints={preview.waypoints} /><p className="preview-citations">Private candidate map · OpenStreetMap attribution is shown on the map.</p></div>
        <ol className="preview-waypoint-list">{preview.waypoints.map(waypoint => {
          const dates = [waypoint.arrival_date, waypoint.departure_date !== waypoint.arrival_date ? waypoint.departure_date : null].filter(Boolean).join(" → ");
          return <li id={`preview-waypoint-${waypoint.id}`} key={waypoint.id}>
            <h3>{waypoint.sequence}. {waypoint.place_historical}</h3>
            {waypoint.place_modern && <p>{waypoint.place_modern}</p>}
            <p className="preview-citations">{waypoint.latitude.toFixed(5)}, {waypoint.longitude.toFixed(5)} · {waypoint.confidence}{dates ? ` · ${dates}` : " · No date recorded"}</p>
            {waypoint.date_note && <p>{waypoint.date_note}</p>}
            <p>{waypoint.event}</p><p>{waypoint.coordinate_note}</p>
            {waypoint.uncertainty && <p><strong>Uncertainty:</strong> {waypoint.uncertainty}</p>}
            <p className="preview-citations">{waypoint.source_ids.map((id, index) => <span key={id}>{index > 0 && " · "}<a href={`#preview-source-${sourceIndex.get(id)}`}>Source {sourceIndex.get(id)}</a></span>)}</p>
          </li>;
        })}</ol>
      </>}
    </section>
    <section className="preview-section" aria-labelledby="preview-plates"><h2 id="preview-plates">Image plates</h2>
      {!preview.images ? <p>No captioned image selection is stored for this plan run.</p> : <>
        <p>Selected by the Photo editor from governed Wikimedia Commons consultations and captioned from Commons metadata only: neither agent saw the images. The date shown is the one recorded on Commons, which is often a reproduction or upload date, not proof of when the image was made.</p>
        {preview.images.omitted > 0 && <p>{preview.images.omitted} malformed image {preview.images.omitted === 1 ? "record was" : "records were"} omitted from this preview.</p>}
        {preview.images.plates.length === 0 ? <p>The Photo editor selected no image for this run.</p> :
          <ol className="preview-plates">{preview.images.plates.map(plate => <li key={plate.receipt_id}>
            <figure className="preview-plate">
              <div className="preview-plate-mount">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={plate.src} alt={plate.alt_text} loading="lazy" width={plate.width ?? undefined} height={plate.height ?? undefined} />
              </div>
              <figcaption>
                <p className="preview-plate-cap">{plate.caption}</p>
                <p className="preview-citations preview-plate-prov">
                  <span>Commons date {plate.date_original ?? "not recorded"}</span>
                  <span>{plate.artist ?? "Maker not recorded"}</span>
                  {plate.credit && <span>{plate.credit}</span>}
                  <span>{plate.licence_url ? <a href={plate.licence_url} target="_blank" rel="noreferrer noopener">{plate.licence}</a> : plate.licence}</span>
                  <span><a href={plate.page_url} target="_blank" rel="noreferrer noopener">Commons file</a></span>
                </p>
                <p className="preview-plate-note">Photo editor judgment: {depictions[plate.depiction]}</p>
              </figcaption>
            </figure>
          </li>)}</ol>}
        <p>{preview.images.review ? `${verdicts[preview.images.review.verdict]}.` : "No completed agent review is recorded for these captions."} This is not publication authorization.</p>
        {preview.images.review && preview.images.review.issues.length > 0 && <ul>{preview.images.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      </>}
    </section>
    <section className="preview-section" aria-labelledby="preview-sources"><h2 id="preview-sources">Sources used in this draft</h2>{preview.sources.length ? <ol>{preview.sources.map((source, index) => <li id={`preview-source-${index + 1}`} key={source.id}>{source.href ? <a href={source.href} target="_blank" rel="noreferrer noopener">{source.title}</a> : source.title}<p className="preview-citations">{source.rights}</p></li>)}</ol> : <p>No source records are available for this saved draft.</p>}</section>
    <section className="preview-section" aria-labelledby="preview-review"><h2 id="preview-review">Review of this version</h2><p>{preview.review ? `${verdicts[preview.review.verdict]}.` : "No completed agent review is recorded for this draft."} This is not publication authorization.</p>{preview.review && preview.review.issues.length > 0 && <ul>{preview.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}</section>
  </TitlePage>;
}
