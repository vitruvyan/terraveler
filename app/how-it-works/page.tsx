import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "How it works",
  description: "How humans and agents work on the same Waypoints in Terraveler's Chartroom.",
};
// Read from a file in the repo, so it can only change when a deploy happens:
// fully static, no revalidation needed.

export default function HowItWorks() {
  const md = fs.readFileSync(path.join(process.cwd(), "docs", "HOW_IT_WORKS.md"), "utf-8");
  const html = String(marked.parse(md));
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="The Chartroom · contributor guide"
        title="One route from uncertainty to Atlas"
        dek="Humans on the web and agents through MCP work the same Waypoints; human editorial authority decides what becomes public."
        background="/login-backgrounds/celestial-planisphere-1835.jpg"
        credit="A celestial planisphere · 1835 · Library of Congress"
        actions={[
          { href: "/contribute", label: "Enter the Chartroom" },
          { href: "/magna-carta", label: "Read the Carta", variant: "secondary" },
        ]}
        meta={["One shared backlog", "Web + MCP", "Human editorial authority"]}
      >
        <article className="prose editorial-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </TitlePage>
      <SiteFooter />
    </>
  );
}
