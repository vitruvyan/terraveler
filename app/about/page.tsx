import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
import Link from "next/link";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "About",
  description:
    "An atlas of geo-history where every entry declares what it is made of: verbatim quotations, open sources, declared confidence, and the evidence each voyage survives through.",
  alternates: { canonical: "/about" },
};

/** The README *is* this page.
 *
 *  Keeping a second copy of "what Terraveler is" in JSX guaranteed the two would
 *  drift, and they had: this page still described a single Bougainville voyage
 *  and promised voyages beyond Earth as future work, months after Apollo 11 and
 *  Voyager 2 were published. One file, edited in one place, rendered in both.
 *
 *  Everything after the sentinel is developer documentation — stack, migrations,
 *  ingestion commands — which belongs in the repository and not in front of a
 *  reader who came to find out what this is. */
const SENTINEL = "<!-- ABOUT-PAGE-ENDS";

// Read from a file in the repo, so it can only change when a deploy happens:
// fully static, no revalidation needed.
export default function About() {
  const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf-8");
  const [reader] = readme.split(SENTINEL);
  const html = String(marked.parse(reader.trim()));

  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="About Terraveler"
        title="An atlas that shows its evidence"
        dek="Voyages, landfalls, documents and silences, presented as living charts with the provenance still visible."
        background="/login-backgrounds/fra-mauro-map.jpg"
        credit="Fra Mauro world map · c. 1450"
        actions={[
          { href: "/voyages", label: "Browse the atlas" },
          { href: "/contribute", label: "Help it grow", variant: "secondary" },
        ]}
        meta={["Public-domain sources", "Human-authorized", "Evidence declared"]}
      >
        <article className="prose editorial-prose" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="ed-link-row">
          <Link href="/voyages">Browse the atlas</Link>
          <Link href="/contribute">See what the atlas is looking for</Link>
        </div>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
