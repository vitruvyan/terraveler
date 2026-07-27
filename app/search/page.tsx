import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
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
      <EditorialPage
        eyebrow="Search"
        title="Find a voyage, place or navigator"
        dek="Search the atlas as it exists today. Empty results become editorial signal for what Terraveler should hold next."
        background="/login-backgrounds/cellarius-planisphaerium-copernicanum.jpg"
        credit="Planisphaerium Copernicanum · 1660 · Andreas Cellarius"
        actions={[{ href: "/voyages", label: "Browse all voyages", variant: "secondary" }]}
        meta={["Voyages", "Navigators", "Landfalls"]}
      >
      <section className="ed-search-panel">
        <p>
          Voyages, navigators, landfalls. What isn&rsquo;t here yet can be
          requested — the atlas grows by exactly that route.
        </p>
        <AtlasSearch autoFocus initialQuery={q ?? ""} />
      </section>
      </EditorialPage>
      <SiteFooter />
    </>
  );
}
