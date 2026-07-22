import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { ATLAS } from "@/lib/voyages";

export const metadata: Metadata = {
  title: "The Atlas — Terraveler",
  description: "Every voyage published on Terraveler: choose a route and sail it through time.",
};

export default function Voyages() {
  return (
    <>
      <SiteHeader />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 22px 80px", lineHeight: 1.65 }}>
        <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>The Atlas</h1>
        <p style={{ color: "var(--ink-soft)", margin: "10px 0 22px" }}>
          Every voyage on Terraveler is verified before it sails: real routes, the
          navigators&rsquo; own words, sources cited. Choose a route and scrub through time.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {ATLAS.map((v) => (
            <a key={v.slug} className="voy-card" href={v.href} style={{ padding: "16px 18px" }}>
              <strong style={{ fontSize: 17 }}>{v.title}</strong>
              <span className="voy-meta" style={{ fontSize: 13.5 }}>
                {v.navigator} · {v.years}
              </span>
              <span className="voy-blurb" style={{ fontSize: 13.5 }}>{v.blurb}</span>
            </a>
          ))}
        </div>
        <p style={{ marginTop: 26, fontSize: 14, color: "var(--ink-soft)" }}>
          More voyages are on the way — see{" "}
          <a href="/contribute">what the atlas is looking for</a> and bring one aboard.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
