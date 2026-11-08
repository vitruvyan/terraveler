import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/deskAuth";
import SiteHeader from "@/components/SiteHeader";
import { DeskHeading } from "@/components/desk/Quarterdeck";
import EditorialProjects from "@/components/desk/EditorialProjects";
import "../editorial.css";

export const metadata: Metadata = { title: "Editorial projects · Terraveler", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function EditorialProjectsPage() {
  const token = (await cookies()).get(COOKIE)?.value;
  const auth = token ? await verifyToken(token).catch(() => ({ ok: false })) : { ok: false };
  if (!auth.ok) redirect("/desk");
  return <><SiteHeader /><main className="dk-page"><DeskHeading eyebrow="Terraveler · editorial administration" title="Editorial projects" aside={<a className="desk-btn" href="/desk">Back to editorial desk</a>} /><EditorialProjects /></main></>;
}
