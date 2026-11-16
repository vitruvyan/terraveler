import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "@/lib/deskAuth";
import AdminNavigation from "@/components/desk/AdminNavigation";
import SiteHeader from "@/components/SiteHeader";
import { DeskHeading } from "@/components/desk/Quarterdeck";
import AgentTeam from "@/components/desk/AgentTeam";
import "../editorial.css";

export const metadata: Metadata = {
  title: "Agent team · Terraveler",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AgentTeamPage() {
  const token = (await cookies()).get(COOKIE)?.value;
  const auth = token ? await verifyToken(token).catch(() => ({ ok: false })) : { ok: false };
  if (!auth.ok) redirect("/desk");

  return <>
    <SiteHeader />
    <main className="dk-page"><AdminNavigation active="team" />
      <DeskHeading eyebrow="Terraveler · editorial administration" title="Agent team" />
      <AgentTeam />
    </main>
  </>;
}
