import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
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
      <main className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      <SiteFooter />
    </>
  );
}
