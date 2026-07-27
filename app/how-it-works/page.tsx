import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "How it works",
  description: "How to contribute to Terraveler: connect your AI, read the Carta, work the roadmap.",
};
// Read from a file in the repo, so it can only change when a deploy happens:
// fully static, no revalidation needed.

export default function HowItWorks() {
  const md = fs.readFileSync(path.join(process.cwd(), "docs", "HOW_IT_WORKS.md"), "utf-8");
  const html = String(marked.parse(md));
  return (
    <>
      <SiteHeader />
      <EditorialPage
        eyebrow="Contributor guide"
        title="How the tandem works"
        dek="A practical route from idea to source discovery, curator review, human authorization and public atlas entry."
        background="/login-backgrounds/celestial-planisphere-1835.jpg"
        credit="A celestial planisphere · 1835 · Library of Congress"
        actions={[
          { href: "/contribute", label: "View open gaps" },
          { href: "/magna-carta", label: "Read the Carta", variant: "secondary" },
        ]}
        meta={["MCP-ready", "Audited workflow", "Desk reviewed"]}
      >
        <article className="prose editorial-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </EditorialPage>
      <SiteFooter />
    </>
  );
}
