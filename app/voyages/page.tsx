import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { ATLAS, voyageLogPath, type AtlasEntry } from "@/lib/voyages";

export const metadata: Metadata = {
  title: "The Atlas — Terraveler",
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

function era(v: AtlasEntry): { key: number; label: string } {
  const kind = v.kind ?? "earth";
  // Voyages off Earth group by where they went, not by century — and each kind
  // gets its own key, or a Moon traverse lands under "Space voyages".
  if (kind !== "earth") {
    return { key: BEYOND_EARTH_KEY[kind] ?? 9997, label: KIND_LABEL[kind] ?? "Beyond Earth" };
  }
  const century = Math.floor(Number(v.years.slice(0, 4)) / 100) + 1;
  return { key: century, label: `${century}th century` };
}

export default function Voyages() {
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
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 22px 80px", lineHeight: 1.65 }}>
        <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>The Atlas</h1>
        <p style={{ color: "var(--ink-soft)", margin: "10px 0 6px" }}>
          Every voyage on Terraveler is verified before it sails: real routes, the
          navigators&rsquo; own words, sources cited. Choose a route and scrub through time.
        </p>
        <p style={{ margin: "0 0 26px", fontSize: 14 }}>
          {ATLAS.length} voyages published · <a href="/search">search the atlas</a> for a
          place, a navigator or an era.
        </p>

        {ordered.map(([key, g]) => (
          <section key={key} style={{ marginBottom: 30 }}>
            <h2
              style={{
                fontSize: "1.05rem",
                letterSpacing: "0.04em",
                margin: "0 0 12px",
                paddingBottom: 6,
                borderBottom: "1px solid var(--parchment-deep)",
                color: "var(--ink-soft)",
              }}
            >
              {g.label}
              <span style={{ color: "var(--brass)", fontSize: 13 }}> · {g.items.length}</span>
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {g.items.map((v) => (
                <div key={v.slug}>
                  <a className="voy-card" href={v.href} style={{ padding: "16px 18px" }}>
                    <strong style={{ fontSize: 17 }}>{v.title}</strong>
                    <span className="voy-meta" style={{ fontSize: 13.5 }}>
                      {v.navigator} · {v.years}
                    </span>
                    <span className="voy-blurb" style={{ fontSize: 13.5 }}>{v.blurb}</span>
                  </a>
                  <div style={{ fontSize: 13, marginTop: 4, paddingLeft: 2 }}>
                    <a href={voyageLogPath(v.slug)}>Read the log as text →</a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginTop: 30 }}>
          Missing a voyage? The atlas grows by request —{" "}
          <a href="/contribute">see what it is looking for</a>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
