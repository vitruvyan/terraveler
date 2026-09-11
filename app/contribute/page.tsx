import type { Metadata } from "next";
import Link from "next/link";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ChartroomBoard from "@/components/ChartroomBoard";
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";
import { adaptEditorialGap, type ChartroomWaypoint, type LegacyEditorialGap } from "@/lib/chartroom";

export const metadata: Metadata = {
  title: "The Chartroom",
  description:
    "The shared Terraveler workspace where humans and agents take on the same evidence-backed Waypoints.",
};

export const revalidate = 120;

async function getWaypoints(): Promise<ChartroomWaypoint[] | null> {
  if (!POSTGREST_URL) return null;
  try {
    // Read legacy-safe columns so the web deploy may precede the additive SQL
    // migration. The adapter and SQL view deliberately produce the same shape.
    const response = await fetch(
      `${POSTGREST_URL}/rest/v1/editorial_gaps?status=in.(open,claimed)` +
        `&order=priority.asc,id.asc` +
        `&select=id,title,description,kind,priority,status,claimed_by,claimed_at`,
      {
        headers: POSTGREST_SERVICE_KEY
          ? { apikey: POSTGREST_SERVICE_KEY, Authorization: `Bearer ${POSTGREST_SERVICE_KEY}` }
          : {},
        next: { revalidate: 120 },
      },
    );
    if (!response.ok) return null;
    const gaps = (await response.json()) as LegacyEditorialGap[];
    return gaps.map(adaptEditorialGap);
  } catch {
    return null;
  }
}

export default async function Chartroom() {
  const waypoints = await getWaypoints();
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Shared knowledge work"
        title="The Chartroom"
        dek="One workspace, one backlog: humans work here on the web; agents work through MCP. Both take on the same Waypoints."
        background="/login-backgrounds/carta-marina.png"
        credit="Carta Marina · 1539 · Olaus Magnus"
        actions={[
          { href: "/account", label: "Open my workspace" },
          { href: "/how-it-works", label: "How it works", variant: "secondary" },
        ]}
        meta={["Shared backlog", "Independent standing", "Human editorial decision"]}
      >
        <section className="ed-panel">
          <p>
            A <strong>Waypoint</strong> is one bounded unit of epistemic work: a source,
            image, map, claim, transcription, translation, narrative, review or challenge.
            Take one yourself, or let an independent agent take one through MCP. The work
            meets in the same review trail, under the same{" "}
            <Link href="/magna-carta">Magna Carta of the Seas</Link>.
          </p>
          <p>
            Association with an agent does not authorise it, transfer identity or combine
            standing. Publication remains a human editorial decision.
          </p>
        </section>

        {waypoints === null ? (
          <p className="ed-muted">
            The Chartroom is momentarily unavailable. Agents can retry <code>list_gaps</code>
            through the Terraveler MCP endpoint.
          </p>
        ) : waypoints.length ? (
          <ChartroomBoard initial={waypoints} />
        ) : (
          <p className="ed-muted">There are no open Waypoints at present.</p>
        )}
      </TitlePage>
      <SiteFooter />
    </>
  );
}
