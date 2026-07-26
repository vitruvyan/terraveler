import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { getVoyageBundle, knownVoyages } from "@/lib/data";
import { voyageDescription } from "@/lib/seo";
import { voyagePath, voyageLogPath, ATLAS } from "@/lib/voyages";
import { alsoVisited } from "@/lib/gazetteer";
import { evidenceBasisOf, evidenceCopy, noExcerptCopy } from "@/lib/evidence";
import { notesForVoyage } from "@/lib/marginalia";
import StageNotes from "@/components/StageNotes";
import Notebook from "@/components/Notebook";
import type { Navigator, SpaceWaypoint, Voyage, Waypoint } from "@/lib/types";

/** The voyage as text: the itinerary, the dates and the verbatim journal
 *  excerpts with their sources, server-rendered. The map tells this story
 *  interactively; this page is the same story in HTML — readable by search
 *  engines, screen readers and reader modes, and honouring CC BY-SA by
 *  making the work genuinely consultable, not merely explorable. */

// Editorial content: it changes when the desk publishes, not per request.
// Served from Vercel's edge and regenerated in the background, which is also
// what makes it resilient — if the backend is unreachable at revalidation
// time the last good page keeps being served instead of erroring.
export const revalidate = 300;

function fmtDate(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

function place(w: Waypoint | SpaceWaypoint): string {
  const anyW = w as any;
  return anyW.place_historical ?? anyW.body ?? `Stage ${w.seq}`;
}

/** Prerendered at build time, so the first reader of a voyage is served from
 *  the edge rather than waiting for it to be rendered. */
export async function generateStaticParams() {
  return knownVoyages().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) return {};
  const { voyage, navigator } = await getVoyageBundle(slug);
  const title = `${voyage.title} — the log`;
  const description = `The full itinerary of ${voyage.title}, stage by stage: dates, landfalls and ${navigator.name}'s own words, each excerpt verbatim with its source.`;
  return {
    title,
    description,
    alternates: { canonical: `/voyage/${slug}/log` },
    openGraph: { type: "article", url: `/voyage/${slug}/log`, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

function jsonLd(slug: string, voyage: Voyage, navigator: Navigator, wps: (Waypoint | SpaceWaypoint)[]) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${voyage.title} — the log`,
    description: voyageDescription(voyage, navigator),
    url: `https://www.terraveler.com/voyage/${slug}/log`,
    datePublished: voyage.start_date ?? undefined,
    about: { "@type": "Person", name: navigator.name },
    author: { "@type": "Organization", name: "Terraveler" },
    license: "https://creativecommons.org/licenses/by-sa/4.0/",
    hasPart: wps
      .filter((w) => (w as any).diary_excerpt)
      .slice(0, 40)
      .map((w) => ({
        "@type": "Quotation",
        text: (w as any).diary_excerpt,
        spokenByCharacter: { "@type": "Person", name: navigator.name },
        citation: (w as any).diary_source_citation ?? undefined,
      })),
  };
}

export default async function VoyageLog({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) notFound();
  const { navigator, voyage, waypoints } = await getVoyageBundle(slug);
  const wps = waypoints as (Waypoint | SpaceWaypoint)[];
  const mapHref = voyagePath(slug);
  // What kind of record this voyage comes down to us through. It decides what
  // a stage with no excerpt is allowed to say — see lib/evidence.ts.
  const basis = evidenceBasisOf(voyage);
  const gap = noExcerptCopy(basis);
  // The questions each stage asks about itself, answered from the atlas's own
  // verified fields — no model involved, so they cannot drift from what a reader
  // can check. Computed for the whole voyage at once so an explanation that
  // would read identically on forty stages is asked only on the first.
  const marginalia = notesForVoyage(voyage, navigator, wps);
  const years =
    voyage.start_date && voyage.end_date
      ? `${voyage.start_date.slice(0, 4)}–${voyage.end_date.slice(0, 4)}`
      : "";

  return (
    <>
      <SiteHeader />
      {/* Wider than a plain article, because the itinerary now has a margin to
          open answers into. The prose keeps its own readable measure via
          .tv-log-prose; only the stage rows use the full width. */}
      <main className="prose" style={{ maxWidth: 1060, margin: "0 auto", padding: "40px 22px 80px", lineHeight: 1.65 }}>
        <div className="tv-log-prose">
        <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
          The log
        </span>
        <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>{voyage.title}</h1>
        <p style={{ color: "var(--ink-soft)", margin: "0 0 6px", fontSize: 15 }}>
          {navigator.name}
          {years ? ` · ${years}` : ""}
          {voyage.ships ? ` · ${voyage.ships}` : ""}
        </p>
        {voyage.summary && <p style={{ margin: "14px 0" }}>{voyage.summary}</p>}

        {/* How we know this. Deliberately placed above the itinerary rather
            than in a footnote: for a voyage whose records were destroyed, what
            was lost and when is not a caveat on the history — it frequently is
            the history, and burying it would repeat the omission. */}
        {basis && (
          <aside
            aria-label="How this voyage is documented"
            style={{
              margin: "22px 0 4px",
              padding: "14px 16px",
              borderLeft: "3px solid var(--brass)",
              background: "rgba(255,255,255,0.4)",
              borderRadius: "0 8px 8px 0",
            }}
          >
            <div style={{
              letterSpacing: "0.14em", textTransform: "uppercase",
              fontSize: 11, color: "var(--brass)", marginBottom: 5,
            }}>
              {evidenceCopy(basis).label}
            </div>
            <p style={{ margin: 0, fontSize: 14.5 }}>{evidenceCopy(basis).blurb}</p>
            {voyage.what_was_lost && (
              <p style={{ margin: "9px 0 0", fontSize: 14.5, color: "var(--ink-soft)" }}>
                {voyage.what_was_lost}
              </p>
            )}
          </aside>
        )}

        <p style={{ margin: "18px 0 30px" }}>
          <a
            href={mapHref}
            style={{
              display: "inline-block",
              fontFamily: "var(--font-display)",
              fontSize: 14,
              padding: "9px 16px",
              borderRadius: 10,
              border: "1px solid var(--accent-deep)",
              background: "var(--accent)",
              color: "var(--parchment)",
              textDecoration: "none",
            }}
          >
            🗺 Sail this voyage on the map
          </a>
        </p>

        <h2 style={{ fontSize: "1.25rem", margin: "0 0 4px" }}>The itinerary</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, margin: "0 0 20px" }}>
          {wps.length} stages. Journal excerpts are verbatim from public-domain
          sources, each with its citation; where no verified quote exists, the
          entry says so rather than inventing one. Select any passage to keep it
          with its source, or open a stage&rsquo;s own questions in the margin.
        </p>
        </div>

        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {wps.map((w) => {
            const anyW = w as any;
            const arrival = fmtDate(w.arrival_date);
            const departure = fmtDate(w.departure_date);
            // The same landfall under other flags: the gazetteer resolved this
            // stop to a real place, so the voyages that also called there can
            // be named — the link that makes this an atlas and not a shelf of
            // separate voyages.
            const also = alsoVisited(slug, w.seq);
            const notes = marginalia.get(w.seq) ?? [];
            const stageLabel = `${w.seq}. ${place(w)}`;
            return (
              <li key={w.seq} id={`stage-${w.seq}`} className="tv-stage-row">
              <div className="tv-stage-col"
                   style={{ borderLeft: "2px solid var(--parchment-deep)", paddingLeft: 16 }}>
                <h3 style={{ fontSize: "1.05rem", margin: "0 0 2px" }}>
                  {w.seq}. {place(w)}
                </h3>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6 }}>
                  {anyW.place_modern && anyW.place_modern !== anyW.place_historical && (
                    <>Today: {anyW.place_modern} · </>
                  )}
                  {arrival && <>Arrived {arrival}</>}
                  {departure && <> · departed {departure}</>}
                  {w.date_note && <> · {w.date_note}</>}
                  {w.confidence && w.confidence !== "certain" && (
                    <> · position {w.confidence}</>
                  )}
                </div>
                {w.event && <p style={{ margin: "0 0 8px" }}>{w.event}</p>}
                {anyW.diary_excerpt ? (
                  <figure style={{ margin: "8px 0 0" }}>
                    {/* The provenance travels with the text: selecting inside
                        this block is what lets a reader keep the quotation with
                        its citation already attached, which is the step people
                        otherwise skip and cannot reconstruct later. */}
                    <blockquote
                      data-tv-source={anyW.diary_source_citation ?? "Source not recorded"}
                      data-tv-source-url={anyW.diary_source_url ?? undefined}
                      data-tv-stage={stageLabel}
                      style={{
                        margin: 0, padding: "10px 14px", background: "rgba(255,255,255,0.45)",
                        borderRadius: 8, fontStyle: "italic",
                      }}
                    >
                      {anyW.diary_excerpt}
                    </blockquote>
                    <figcaption style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
                      {anyW.diary_source_url ? (
                        <a href={anyW.diary_source_url} target="_blank" rel="noreferrer">
                          {anyW.diary_source_citation ?? "Source"}
                        </a>
                      ) : (
                        anyW.diary_source_citation ?? "Source not recorded"
                      )}
                    </figcaption>
                  </figure>
                ) : (
                  // What an absent excerpt means depends entirely on what
                  // survives. Where a journal exists the gap is ours and a
                  // reader can close it; where the records burned there is
                  // nothing to find, and asking anyway would be a small
                  // falsehood repeated on every stage of the voyage.
                  <p style={{ fontSize: 13, color: "var(--ink-soft)", fontStyle: "italic", margin: 0 }}>
                    {gap.text}
                    {gap.invitesContribution ? (
                      <> — <a href="/contribute">help us find one</a>.</>
                    ) : (
                      "."
                    )}
                  </p>
                )}
                {also && (
                  <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "10px 0 0" }}>
                    Also called at by{" "}
                    {also.visits.map((v, i) => {
                      const other = ATLAS.find((a) => a.slug === v.voyage);
                      return (
                        <span key={v.voyage + v.seq}>
                          {i > 0 && ", "}
                          <a href={`${voyageLogPath(v.voyage)}#stage-${v.seq}`}>
                            {other?.navigator ?? v.voyage}
                          </a>
                          {v.called_it && v.called_it !== place(w) && <> — who called it “{v.called_it}”</>}
                        </span>
                      );
                    })}
                    {". "}
                    <a href={also.place.source_url} target="_blank" rel="noreferrer"
                       style={{ fontSize: 12.5 }}>
                      Identified as {also.place.name}
                    </a>
                  </p>
                )}
              </div>
              <StageNotes notes={notes} stageLabel={stageLabel} voyageTitle={voyage.title} />
              </li>
            );
          })}
        </ol>

        <p className="tv-log-prose" style={{ marginTop: 30, fontSize: 13.5, color: "var(--ink-soft)" }}>
          Published under{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noreferrer" target="_blank">CC BY-SA 4.0</a>.
          Sources keep their own open licences. See{" "}
          <a href="/magna-carta">the Magna Carta of the Seas</a> for how this was verified.
        </p>
      </main>
      <Notebook voyageTitle={voyage.title} />
      <SiteFooter />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(slug, voyage, navigator, wps)) }}
      />
    </>
  );
}
