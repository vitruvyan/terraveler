import fs from "fs";
import path from "path";
import { marked } from "marked";
import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "The Magna Carta of the Seas — Terraveler",
  description: "Terraveler's editorial constitution: the rules that govern what may enter the atlas, how, and why.",
};
export const dynamic = "force-dynamic";

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
