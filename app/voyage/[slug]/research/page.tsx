import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";
import edition from "@/data/research/pizarro-1532.json";
import "./research.css";

// This edition is a published research snapshot, independent of the canonical
// map's PostgREST-first loader. No private working files are read at runtime.
export const dynamicParams = false;

type Edition = typeof edition;
type Media = Edition["media"][number];
type Params = { params: Promise<{ slug: string }> };

const SECTION_TITLES: Record<string, string> = {
  scope: "Scope & questions",
  itinerary: "Itinerary & branches",
  chronology: "Dates & uncertainty",
  sources: "Sources & testimony",
  populations: "People & cultural context",
  images: "Images & rights",
  narrative: "The Motux research card",
  review: "Review & remaining work",
};

const STATE_LABELS: Record<string, string> = {
  approved: "Independently reviewed task",
  awaiting_review: "Awaiting independent review",
  awaiting_revision: "Revision requested",
  reviewed_task_results: "Scoped task results reviewed",
  reviewed_with_gaps: "Reviewed with gaps",
  materials_collected: "Materials collected",
  not_started: "Research not started",
  to_do: "Research to do",
  todo: "Ready for research",
  in_progress: "Research in progress",
  claim_expired: "Available for reassignment",
  documented_gap: "Documented gap",
  blocked: "Work blocked",
};

function readable(value: string): string {
  return STATE_LABELS[value] ?? value.replace(/[_-]+/g, " ");
}

function evidenceRole(role: string): string {
  const labels: Record<string, string> = {
    "participant-account": "Translated participant account",
    "translated-participant-account": "Translated participant account",
    "primary-narrative": "Translated historical narrative",
    "translator-note": "Translator’s later annotation",
    "editorial-footnote": "Translator’s later annotation",
    "modern-reference": "Modern place reference",
    "image-description": "Image-item metadata",
    "study-metadata": "Study metadata",
  };
  return labels[role] ?? readable(role);
}

function routeRelationship(value: string): string {
  const labels: Record<string, string> = {
    "governor-mainline-named-visit": "Named place in the account of the Governor’s main journey",
    "governor-mainline-unnamed-passages": "Unnamed passages in the account of the main journey",
    "editorially-associated-mainline-name": "Place associated with the main route by editorial annotation",
    "reported-vanguard-passage": "Reported passage of an advance party",
  };
  return labels[value] ?? readable(value);
}

function Status({ value }: { value: string }) {
  return <span className="research-status" data-state={value}>{readable(value)}</span>;
}

function ExternalLink({ href, children }: { href?: string | null; children: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function Gaps({ items, title = "What remains unknown" }: { items: readonly string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <aside className="research-gaps">
      <h4>{title}</h4>
      <ul>{items.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
    </aside>
  );
}

function SourceList({ ids }: { ids: readonly string[] }) {
  const studies = ids.map((id) => edition.studies.find((study) => study.id === id)).filter((s) => s !== undefined);
  if (studies.length === 0) return null;
  return <p className="research-citation">Related scholarship: {studies.map((study, i) => (
    <span key={study.id}>{i > 0 && "; "}<a href={`#study-${study.id}`}>{study.title}</a></span>
  ))}</p>;
}

function MediaRecord({ item }: { item: Media }) {
  return (
    <div className="research-media-record" id={`image-${item.id}`}>
      <h3>{item.title}</h3>
      <Status value={item.status} />
      <p>{item.caption}</p>
      <dl className="research-record">
        <div><dt>Credit reported by Commons</dt><dd>{item.credit || "Not recorded"}</dd></div>
        <div><dt>License reported by Commons</dt><dd><ExternalLink href={item.license_url}>{item.license}</ExternalLink></dd></div>
        <div><dt>Image date metadata</dt><dd>{item.date || "Unknown"}</dd></div>
        <div><dt>Dimensions</dt><dd>{item.width} × {item.height}</dd></div>
        <div><dt>Source</dt><dd><ExternalLink href={item.item_url}>Commons item record</ExternalLink></dd></div>
      </dl>
      <p className="research-small">{item.date_note}</p>
      <Gaps items={item.limits} title="Image limits" />
    </div>
  );
}

export function generateStaticParams() {
  return [{ slug: "pizarro-1532" }];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (slug !== "pizarro-1532") return {};
  return {
    title: `${edition.title} — research edition`,
    description: edition.summary,
    alternates: { canonical: "/voyage/pizarro-1532/research" },
  };
}

export default async function PizarroResearch({ params }: Params) {
  const { slug } = await params;
  if (slug !== "pizarro-1532") notFound();
  const localMedia = edition.media.filter((item) => item.local_url?.startsWith("/") && !item.local_url.startsWith("//"));
  const linkedMedia = edition.media.filter((item) => !localMedia.some((local) => local.id === item.id));
  const section = (id: string) => edition.sections.find((entry) => entry.id === id);
  const sectionLead = (id: string) => {
    const entry = section(id);
    return entry ? <div className="research-section-lead"><Status value={entry.status} /><p>{entry.summary}</p></div> : null;
  };

  return (
    <>
      <SiteHeader />
      <main className="research-edition">
        <TitlePage
          eyebrow="Public research edition · Pizarro, 1532–1533"
          title={edition.title}
          dek={edition.summary}
          actions={[
            { href: "/voyage/pizarro-1532", label: "Open the published map" },
            { href: "/voyage/pizarro-1532/log", label: "Read the published log", variant: "secondary" },
          ]}
          meta={[`Research snapshot: ${edition.as_of}`, "Proposals, evidence & declared gaps"]}
          wide
        >
          <article className="research-document">
            <div className="research-notice"><p>{edition.notice}</p></div>
            <nav className="research-contents" aria-label="Research edition contents">
              <p className="research-kicker">Eight parts of the research</p>
              <ol>{edition.sections.map((entry) => <li key={entry.id}>
                <a href={`#research-${entry.id}`}>{SECTION_TITLES[entry.id] ?? entry.title}</a>
              </li>)}</ol>
            </nav>

            <section id="research-scope" className="research-chapter">
              <h2>{SECTION_TITLES.scope}</h2>
              <p className="research-lede">{edition.scope}</p>
              <dl className="research-coverage">{edition.sections.map((entry) => <div key={entry.id}>
                <dt><a href={`#research-${entry.id}`}>{entry.title}</a></dt>
                <dd><Status value={entry.status} /><p>{entry.summary}</p>
                  <Gaps items={entry.gaps} title="Open questions" />
                </dd>
              </div>)}</dl>
              <p className="research-small">These are research states, not percentages of historical completeness. A reviewed task does not certify an entire stage or section.</p>
            </section>

            <section id="research-itinerary" className="research-chapter">
              <h2>{SECTION_TITLES.itinerary}</h2>
              {sectionLead("itinerary")}
              <p className="research-small">The candidate sequence below is presented alongside the published map, whose route has not been replaced by this research edition.</p>
              <ol className="research-stages">{edition.stages.map((stage) => <li key={stage.id} id={`stage-${stage.id}`}>
                <div className="research-stage-heading"><span className="research-kicker">Proposed stage {stage.seq}</span><Status value={stage.status} /></div>
                <h3>{stage.historical_name}</h3>
                <p className="research-place">{stage.modern_name}</p>
                <p>{stage.event}</p>
                {stage.location && <p className="research-citation">{stage.location.label}: {stage.location.latitude}, {stage.location.longitude}</p>}
                <p className="research-date">{stage.date.value || "Exact date not established"}</p>
                <p className="research-small">{stage.date.note}</p>
                <details className="research-details">
                  <summary>Read the testimony & references</summary>
                  <blockquote>{stage.testimony.text}</blockquote>
                  <p className="research-citation"><ExternalLink href={stage.testimony.url}>{stage.testimony.citation}</ExternalLink>{stage.testimony.locator && ` · ${stage.testimony.locator}`}</p>
                  <SourceList ids={stage.study_ids} />
                  {stage.media_ids.length > 0 && <p className="research-citation">Image records: {stage.media_ids.map((id, i) => (
                    <span key={id}>{i > 0 && "; "}<a href={`#image-${id}`}>{edition.media.find((item) => item.id === id)?.title ?? "Candidate image"}</a></span>
                  ))}</p>}
                  {stage.cultural_context_ids.length > 0 && <p className="research-citation">Regional context: {stage.cultural_context_ids.map((id, i) => (
                    <span key={id}>{i > 0 && "; "}<a href={`#context-${id}`}>{edition.cultural_contexts.find((item) => item.id === id)?.title ?? "Context discussion"}</a></span>
                  ))}</p>}
                </details>
                <Gaps items={stage.gaps} />
              </li>)}</ol>

              <details className="research-details research-register">
                <summary>{edition.intermediate_stages.length} intermediate places & unresolved route connections</summary>
                <p>Their appearance in a source does not automatically make them stops on Francisco Pizarro’s main march.</p>
                {edition.intermediate_stages.map((place) => <div className="research-register-entry" key={place.id}>
                  <h3>{place.name}</h3><Status value={place.status} />
                  <p>{routeRelationship(place.route_relationship)}</p><p className="research-small">{place.date_note}</p>
                  <ul>{place.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
                  {place.quotes.map((quote, i) => <div key={i}>
                    <p className="research-citation">{evidenceRole(quote.role)}</p><blockquote>{quote.text}</blockquote>
                    <p className="research-citation"><ExternalLink href={quote.url}>{quote.locator || "Source passage"}</ExternalLink></p>
                  </div>)}
                </div>)}
              </details>

              <h3>Branches and other journeys</h3>
              <p>These records are kept separate from the proposed main route.</p>
              {edition.branches.map((branch, i) => <div className="research-branch" key={branch.id}>
                <h4>Branch {i + 1}</h4>
                {branch.records.map((record) => <div key={record.legacy_id}>
                  <h3>{record.name}</h3><p>{record.event}</p><p className="research-small">{record.note}</p>
                  <details className="research-details"><summary>Read the source for this branch</summary>
                    {record.evidence.map((evidence, index) => <div key={index}>
                      <p className="research-citation">{evidenceRole(evidence.role)}</p>
                      <blockquote>{evidence.text}</blockquote>
                      <p className="research-citation"><ExternalLink href={evidence.url}>{evidence.citation}</ExternalLink>{evidence.locator && ` · ${evidence.locator}`}</p>
                    </div>)}
                  </details>
                </div>)}
              </div>)}
            </section>

            <section id="research-chronology" className="research-chapter">
              <h2>{SECTION_TITLES.chronology}</h2>
              {sectionLead("chronology")}
              <div className="research-table-scroll" role="region" aria-label="Candidate chronology" tabIndex={0}>
                <table><caption>Dates at the precision supported by the research</caption>
                  <thead><tr><th scope="col">Stage</th><th scope="col">Date or interval</th><th scope="col">What the date means</th></tr></thead>
                  <tbody>{edition.stages.map((stage) => <tr key={stage.id}>
                    <th scope="row"><a href={`#stage-${stage.id}`}>{stage.historical_name}</a></th>
                    <td className="research-date">{stage.date.value || "Not established"}</td><td>{stage.date.note}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <Gaps items={section("chronology")?.gaps ?? []} />
            </section>

            <section id="research-sources" className="research-chapter">
              <h2>{SECTION_TITLES.sources}</h2>
              {sectionLead("sources")}
              <ul>{edition.provenance.edition_notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
              <p>Testimony is reproduced with its edition and locator under each proposed stage. Conquistador accounts, later annotations and modern scholarship retain their own voices and limits.</p>
              <Gaps items={section("sources")?.gaps ?? []} />
              <details className="research-details research-register" id="research-bibliography">
                <summary>{edition.studies.length} studies & bibliographic records · links, not an ingested corpus</summary>
                <ol className="research-bibliography">{edition.studies.map((study) => <li id={`study-${study.id}`} key={study.id}>
                  <h3><ExternalLink href={study.url}>{study.title}</ExternalLink></h3>
                  <p className="research-citation">{study.authors.join(", ")} · {study.year}{study.locator && ` · ${study.locator}`}</p>
                  {study.doi && <p className="research-citation"><ExternalLink href={study.doi.startsWith("https://") ? study.doi : `https://doi.org/${study.doi}`}>DOI: {study.doi}</ExternalLink></p>}
                  <Status value={study.status} /><p>{study.scope}</p>
                  <p className="research-small">Consulted: {study.consulted_basis}</p>
                </li>)}</ol>
              </details>
            </section>

            <section id="research-populations" className="research-chapter">
              <h2>{SECTION_TITLES.populations}</h2>
              {sectionLead("populations")}
              <p>Regional context does not assign an ethnicity to everyone encountered in 1532–1533. Later ethnography and archaeology are read within their own places and periods.</p>
              {edition.cultural_contexts.map((context) => <div className="research-context" key={context.id} id={`context-${context.id}`}>
                <h3>{context.title}</h3><Status value={context.status} /><p>{context.text}</p>
                <dl className="research-context-limits">
                  <div><dt>Period & place</dt><dd>{context.period_limits}</dd></div>
                  <div><dt>Source limits</dt><dd>{context.source_limits}</dd></div>
                </dl>
                <SourceList ids={context.source_ids} />
              </div>)}
              <Gaps items={section("populations")?.gaps ?? []} />
            </section>

            <section id="research-images" className="research-chapter">
              <h2>{SECTION_TITLES.images}</h2>
              {sectionLead("images")}
              <p>{edition.media.length} item records are listed here. {localMedia.length === 1 ? "One photograph was retrieved and visually inspected" : `${localMedia.length} photographs have local image files`}; the other records remain links to their Commons items. Modern photographs do not document the historical camp.</p>
              {localMedia.map((item) => <figure className="research-plate" key={item.id}>
                <div className="research-plate-mount">
                  {/* The local, hash-checked file is the only image requested by this page. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.local_url ?? undefined} alt={item.caption} width={item.width} height={item.height} loading="lazy" />
                </div>
                <figcaption><MediaRecord item={item} /></figcaption>
              </figure>)}
              <details className="research-details research-register">
                <summary>{linkedMedia.length} further image records · item links only</summary>
                {linkedMedia.map((item) => <MediaRecord key={item.id} item={item} />)}
              </details>
              <Gaps items={section("images")?.gaps ?? []} />
            </section>

            <section id="research-narrative" className="research-chapter">
              <h2>{SECTION_TITLES.narrative}</h2>
              {sectionLead("narrative")}
              <p>These {edition.motux.facts.length} Motux statements passed a separate, scoped evidence review. Their wording is preserved here; that review does not certify every other stage or remove the gaps below.</p>
              <ol className="research-facts">{edition.motux.facts.map((fact) => <li key={fact.id}>
                <p className="research-atom">{fact.text}</p>
                <details className="research-details">
                  <summary>Inspect supporting evidence</summary>
                  {fact.evidence.map((evidence) => <div className="research-evidence" key={evidence.id}>
                    <p className="research-citation">{evidence.semantic_role ? evidenceRole(evidence.semantic_role) : evidence.kind === "source-text" ? "Source passage" : "Source metadata"}</p>
                    <p className="research-source-text">{evidence.text}</p>
                    <p className="research-citation"><ExternalLink href={evidence.url}>{evidence.title || "Consulted source"}</ExternalLink>{evidence.author && ` · ${evidence.author}`}{evidence.locator && ` · ${evidence.locator}`}</p>
                    {evidence.license && <p className="research-citation">Source rights: <ExternalLink href={evidence.license_url}>{evidence.license}</ExternalLink></p>}
                  </div>)}
                </details>
              </li>)}</ol>
              <Gaps items={edition.motux.gaps} title="The six retained limits of the Motux card" />
              <div className="research-image-update"><h3>Subsequent photograph check</h3>
                <p className="research-date">{edition.motux.image_update.as_of}</p><p>{edition.motux.image_update.text}</p>
              </div>
              <SourceList ids={edition.motux.study_ids} />
              <p className="research-citation">{edition.motux.media_ids.map((id) => <a key={id} href={`#image-${id}`}>Inspect the modern Motupe image record</a>)}</p>
            </section>

            <section id="research-review" className="research-chapter">
              <h2>{SECTION_TITLES.review}</h2>
              {sectionLead("review")}
              <ul>{edition.provenance.review_scopes.map((note, i) => <li key={i}>{note}</li>)}</ul>
              <Gaps items={edition.provenance.limits} title="Limits of this research edition" />
              <h3>How the {edition.legacy_rows.length} published rows relate to the research</h3>
              <p>The original row identities remain visible for comparison. Proposed corrections and branches have not silently rewritten the published route.</p>
              <div className="research-table-scroll" role="region" aria-label="Published-row comparison" tabIndex={0}>
                <table><caption>Published atlas rows and proposed editorial actions</caption>
                  <thead><tr><th scope="col">Row</th><th scope="col">Place</th><th scope="col">Assessment</th><th scope="col">Proposed action</th></tr></thead>
                  <tbody>{edition.legacy_rows.map((row) => <tr key={row.id}>
                    <th scope="row" className="research-date">{row.seq}</th><td>{row.name}</td>
                    <td><Status value={row.status} /><ul>{row.findings.map((finding, i) => <li key={i}>{finding}</li>)}</ul></td><td>{row.proposed_action}</td>
                  </tr>)}</tbody>
                </table>
              </div>

              <details className="research-details research-register">
                <summary>Open the research board · every waypoint and its remaining questions</summary>
                <p>Task counts describe work records, not historical completeness. {Object.entries(edition.board.counts.tasks).map(([state, count]) => `${count} ${readable(state).toLowerCase()}`).join("; ")}.</p>
                {edition.board.units.map((unit) => <details className="research-details research-board-unit" key={unit.id}>
                  <summary>{unit.label}{unit.kind === "journey" ? " · journey-wide research" : ""}</summary>
                  <dl className="research-coverage">{unit.sections.map((cell) => <div key={cell.id}>
                    <dt>{section(cell.id)?.title ?? readable(cell.id)}</dt><dd><Status value={cell.state} /><p>{cell.summary}</p><Gaps items={cell.gaps} title="Open questions" /></dd>
                  </div>)}</dl>
                  {edition.board.tasks.filter((task) => task.unit_id === unit.id).map((task) => <div className="research-board-task" key={task.id}>
                    <h4>{task.objective}</h4><Status value={task.state} />
                    <p className="research-small">{SECTION_TITLES[task.section] ?? readable(task.section)}</p>
                  </div>)}
                </details>)}
              </details>
              <Gaps items={section("review")?.gaps ?? []} />
            </section>
          </article>
        </TitlePage>
      </main>
      <SiteFooter />
    </>
  );
}
