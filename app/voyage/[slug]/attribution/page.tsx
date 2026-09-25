import Icon from "@/components/Icon";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { getVoyageBundle, getVoyageProvenance, knownVoyages } from "@/lib/data";
import { voyagePath, voyageLogPath } from "@/lib/voyages";
import type { SpaceWaypoint, Waypoint } from "@/lib/types";

/** Carta §3.5's provenance chain, made visible: who asked for this voyage,
 *  what drafted it and every waypoint-enrichment after it, in order — the
 *  attribution Wikipedia gives every article's "View history" tab and this
 *  atlas has never surfaced anywhere a reader can see. Deliberately its own
 *  page rather than inline on the log or the map: the text is what a reader
 *  came for, and a per-stage byline on every one of forty landfalls would
 *  compete with it rather than support it. See getVoyageProvenance() for why
 *  this reads the checked-in bundle directly rather than going through
 *  getVoyageBundle()'s Postgres-first path. */

// Editorial content: it changes when the desk publishes, not per request.
export const revalidate = 300;

function fmtDate(d: string | null): string {
  if (!d) return "undated";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

const TYPE_LABEL: Record<string, string> = {
  "new-voyage": "Voyage created",
  "waypoint-enrichment": "Waypoints enriched",
};

/** Names the stages a publication touched, from its recorded seq numbers —
 *  never re-deriving them, since a later renumbering of the voyage would
 *  then also silently rewrite what an old publication is credited with.
 *  Enumerates by name for a handful of stages; a publication that touched
 *  everything (every new-voyage's own initial one) just says so, since
 *  listing all forty places a long voyage opens with would bury the record
 *  in itself. */
function describeWaypoints(seqs: number[], wps: (Waypoint | SpaceWaypoint)[]): string {
  if (seqs.length === 0) return "no waypoints on record";
  if (seqs.length === wps.length) return `all ${seqs.length} stage${seqs.length === 1 ? "" : "s"}`;
  const byName = new Map(wps.map((w) => [w.seq, (w as any).place_historical ?? (w as any).body ?? `stage ${w.seq}`]));
  const names = seqs.map((s) => byName.get(s) ?? `stage ${s}`);
  const shown = names.slice(0, 8);
  const rest = names.length - shown.length;
  return `${seqs.length} stage${seqs.length === 1 ? "" : "s"}: ${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""}`;
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) return {};
  const { voyage } = await getVoyageBundle(slug);
  const title = `${voyage.title} — attribution`;
  const description = `Who asked for this voyage, what drafted it and every enrichment since, in order — the provenance Carta §3.5 requires, made visible.`;
  return {
    title,
    description,
    alternates: { canonical: `/voyage/${slug}/attribution` },
    robots: { index: false }, // a record of the record, not a page a search result should land on
  };
}

export async function generateStaticParams() {
  return knownVoyages().map((slug) => ({ slug }));
}

export default async function VoyageAttribution({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) notFound();
  const { navigator, voyage, waypoints } = await getVoyageBundle(slug);
  const wps = waypoints as (Waypoint | SpaceWaypoint)[];
  const entries = getVoyageProvenance(slug);

  return (
    <>
      <SiteHeader />
      <main className="prose tv-voyage-attribution" style={{ maxWidth: "var(--log-page-width)", margin: "0 auto", padding: "40px var(--log-page-padding) 80px", lineHeight: 1.65 }}>
        <span className="tv-log-kicker" style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass-text)" }}>
          <Icon name="quill" size={16} /> Attribution
        </span>
        <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>{voyage.title}</h1>
        <p style={{ color: "var(--ink-soft)", margin: "0 0 20px", fontSize: 15 }}>
          {navigator.name}
        </p>

        <p style={{ margin: "0 0 24px", maxWidth: "62ch" }}>
          Carta §3.5 promises this voyage&rsquo;s provenance is recorded forever:
          who asked for it, what drafted it, under which version of the Carta,
          and — for every publication after the first — which stages it
          touched. Below is that record, in the order it was published.
        </p>

        {entries.length === 0 ? (
          <p style={{ margin: "0 0 24px", fontStyle: "italic", color: "var(--ink-soft)", maxWidth: "62ch" }}>
            No submission-pipeline record exists for this voyage. It was
            either published before this mechanism existed, or authored
            outside the submission pipeline entirely — absent, not
            withheld.
          </p>
        ) : (
          <ol className="tv-attribution-list" style={{ listStyle: "none", padding: 0, margin: "0 0 30px" }}>
            {entries.map((entry, i) => (
              <li key={`${entry.submission_id}-${i}`} className="tv-attribution-entry">
                <div className="tv-attribution-type">
                  {TYPE_LABEL[entry.type] ?? entry.type}
                </div>
                <dl className="tv-attribution-facts">
                  <div>
                    <dt>Ideator</dt>
                    <dd>{entry.ideator ?? "not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Scribe</dt>
                    <dd>{entry.scribe_model ?? "not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Carta</dt>
                    <dd>{entry.carta_version ?? "not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{fmtDate(entry.date)}</dd>
                  </div>
                  <div>
                    <dt>Submission</dt>
                    <dd>#{entry.submission_id}</dd>
                  </div>
                </dl>
                <div className="tv-attribution-waypoints">
                  {describeWaypoints(entry.waypoints ?? [], wps)}
                </div>
              </li>
            ))}
          </ol>
        )}

        <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
          <a href={voyagePath(slug)}>Back to the map</a>
          {" · "}
          <a href={voyageLogPath(slug)}>Read the log as text</a>
          {" · "}
          Published under{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noreferrer" target="_blank">CC BY-SA 4.0</a>.
          See <a href="/magna-carta">the Magna Carta of the Seas</a> for how this was verified.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
