import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "The Magna Carta of the Seas",
  description: "Terraveler's editorial constitution: the rules that govern what may enter the atlas, how, and why.",
};
// Read from a file in the repo, so it can only change when a deploy happens:
// fully static, no revalidation needed.

export default function MagnaCarta() {
  const md = fs.readFileSync(path.join(process.cwd(), "MAGNA_CARTA.md"), "utf-8");
  const html = String(marked.parse(md));
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Editorial constitution"
        title="The Magna Carta of the Seas"
        dek="The rules that keep Terraveler sourced, inspectable and human-authorized before anything enters the public atlas."
        background="/login-backgrounds/ortelius-world-map-1570.jpg"
        credit="Typus Orbis Terrarum · 1570 · Abraham Ortelius"
        actions={[
          { href: "/how-it-works", label: "How contributors use it" },
          { href: "/contribute", label: "Open roadmap", variant: "secondary" },
        ]}
        meta={["v0.4 draft", "Sources are sacred", "Audit everything"]}
      >
        <article className="prose editorial-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </TitlePage>
      <SiteFooter />
    </>
  );
}
