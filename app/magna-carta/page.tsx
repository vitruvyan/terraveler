import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
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
      <main className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      <SiteFooter />
    </>
  );
}
