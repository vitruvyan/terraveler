import type { Metadata } from "next";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AtlasSearch from "@/components/AtlasSearch";
import { ATLAS, voyageLogPath, type AtlasEntry } from "@/lib/voyages";

export const metadata: Metadata = {
  title: "The Atlas",
  description: "Every voyage published on Terraveler: choose a route and sail it through time.",
};

const KIND_LABEL: Record<string, string> = {
  earth: "Age of Sail",
  surface: "Other worlds",
  space: "Space voyages",
};

/** Grouped by era rather than printed as one flat list: at six voyages the
 *  difference is cosmetic, at a hundred it is the difference between an index
 *  and a scroll. The heading a voyage falls under comes from its own dates, so
 *  the grouping grows with the atlas and needs no upkeep. */
const BEYOND_EARTH_KEY: Record<string, number> = { surface: 9998, space: 9999 };

/** 1st, 2nd, 3rd, 4th — and 11th through 13th, which break the pattern. The
 *  old code printed "th" onto every number, so a correct grouping still came
 *  out as "21th century". */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function era(v: AtlasEntry): { key: number; label: string } {
  const kind = v.kind ?? "earth";
  // Voyages off Earth group by where they went, not by century — and each kind
  // gets its own key, or a Moon traverse lands under "Space voyages".
  if (kind !== "earth") {
    return { key: BEYOND_EARTH_KEY[kind] ?? 9997, label: KIND_LABEL[kind] ?? "Beyond Earth" };
  }
  /* `years` reads "629–645", and slice(0, 4) took "629–" — Number() of that is
     NaN, NaN + 1 is NaN, and every voyage whose start year has three digits
     landed in one bogus bucket that rendered as "1th century". Xuanzang and
     Faxian were in it. Match the first run of digits instead of counting
     characters, and treat a year we cannot read as unknown rather than as
     century one. */
  const year = Number(v.years.match(/\d{3,4}/)?.[0]);
  if (!Number.isFinite(year)) return { key: 9996, label: "Undated" };
  const century = Math.floor((year - 1) / 100) + 1;
  return { key: century, label: `${ordinal(century)} century` };
}

export default async function Voyages({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  /* The atlas absorbed /search, which was forty-three lines wrapping this same
     component in a hero. Results belong where the things are. */
  const q = (await searchParams).q?.trim() ?? "";
  const groups = new Map<number, { label: string; items: AtlasEntry[] }>();
  for (const v of ATLAS) {
    const { key, label } = era(v);
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key)!.items.push(v);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a - b);

  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="The Atlas"
        title="Choose a route through time"
        dek="Every voyage is a verified sequence of places, dates, documents and confidence marks, from ocean crossings to journeys beyond Earth."
        background="/login-backgrounds/cellarius-scenographia-copernicani.jpg"
        credit="Scenographia Systematis Copernicani · 1660 · Andreas Cellarius"
        actions={[
          { href: "#find", label: "Search the atlas" },
          { href: "/contribute", label: "Suggest a voyage", variant: "secondary" },
        ]}
        meta={[`${ATLAS.length} voyages published`, "Earth and beyond", "Logs available"]}
        wide
      >
        <section className="ed-panel ed-atlas-panel">
          <p>
            Every voyage on Terraveler is verified before it sails: real routes, the
            navigators&rsquo; own words, sources cited. Choose a route and scrub through time.
          </p>
        </section>

        <section id="find" className="ed-find">
          <h2 className="ed-find-title">Find a voyage</h2>
          <p className="ed-find-note">
            {ATLAS.length} published. Search by place, navigator or era — and if the atlas
            does not hold it, that empty result becomes editorial signal for what it should
            hold next.
          </p>
          <AtlasSearch initialQuery={q} autoFocus={Boolean(q)} />
        </section>

        {ordered.map(([key, g]) => (
          <section key={key} className="ed-index-section">
            <h2>
              {g.label}
              <span> · {g.items.length}</span>
            </h2>
            <div className="ed-voyage-grid">
              {g.items.map((v) => (
                <article key={v.slug} className="ed-voyage-card">
                  <a className="ed-voyage-main" href={v.href}>
                    <span className="ed-voyage-kicker">{KIND_LABEL[v.kind ?? "earth"] ?? "Voyage"}</span>
                    <strong>{v.title}</strong>
                    <span className="voy-meta">{v.navigator} · {v.years}</span>
                    <span className="voy-blurb">{v.blurb}</span>
                  </a>
                  <div className="ed-voyage-footer">
                    <a href={voyageLogPath(v.slug)}>Read the log as text →</a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}

        <p className="ed-muted">
          Missing a voyage? The atlas grows by request —{" "}
          <a href="/contribute">see what it is looking for</a>.
        </p>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
