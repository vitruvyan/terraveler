import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AtlasSearch from "@/components/AtlasSearch";

export const metadata: Metadata = {
  title: "Search the atlas",
  description:
    "Search Terraveler's voyages, navigators and landfalls. If the atlas doesn't hold it yet, propose it: your AI researches it from public-domain sources and the editorial desk verifies it.",
  alternates: { canonical: "/search" },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 22px 80px", lineHeight: 1.65, minHeight: "58vh" }}>
        <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>Search the atlas</h1>
        <p style={{ color: "var(--ink-soft)", margin: "10px 0 22px" }}>
          Voyages, navigators, landfalls. What isn&rsquo;t here yet can be
          requested — the atlas grows by exactly that route.
        </p>
        <AtlasSearch autoFocus initialQuery={q ?? ""} />
      </main>
      <SiteFooter />
    </>
  );
}
