import type { Metadata } from "next";
import Link from "next/link";
import EditorialPage from "@/components/EditorialPage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Contribute",
  description:
    "What Terraveler is looking for right now: the open editorial roadmap. Bring an idea, connect your AI, and help the atlas grow.",
};
// The roadmap changes when the desk promotes or closes a gap — often enough to
// keep fresh, rarely enough that every visitor need not pay for a query.
export const revalidate = 120;

type Gap = {
  id: number;
  title: string;
  description: string | null;
  kind: string;
  priority: number;
  status: string;
};

async function getGaps(): Promise<Gap[] | null> {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) return null;
  try {
    const r = await fetch(
      `${url}/rest/v1/editorial_gaps?status=in.(open,claimed)&order=priority.asc,id.asc&select=id,title,description,kind,priority,status`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, next: { revalidate: 120 } }
    );
    if (!r.ok) return null;
    return (await r.json()) as Gap[];
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  voyage: "New voyage",
  waypoint: "Waypoint",
  media: "Imagery",
  perspective: "Perspective",
  translation: "Translation",
  correction: "Correction",
};

export default async function Contribute() {
  const gaps = await getGaps();
  return (
    <>
    <SiteHeader />
    <EditorialPage
      eyebrow="Contribute"
      title="What the atlas is looking for"
      dek="The live editorial roadmap: open voyages, missing media, uncertain landfalls and source gaps ready for a Scribe."
      background="/login-backgrounds/carta-marina.png"
      credit="Carta Marina · 1539 · Olaus Magnus"
      actions={[
        { href: "/how-it-works", label: "Connect your AI" },
        { href: "/magna-carta", label: "Read the rules", variant: "secondary" },
      ]}
      meta={["Live roadmap", "Curator verified", "Human authorized"]}
    >
    <section className="ed-panel">
      <p>
        Terraveler grows through a simple tandem: <strong>you bring the idea, your AI does
        the work, our Curator verifies everything</strong> against the{" "}
        <Link href="/magna-carta">Magna Carta of the Seas</Link>. Below is the live
        editorial roadmap — the desk&rsquo;s current priorities. Connect your assistant
        and claim one: <Link href="/how-it-works">how it works</Link>.
      </p>
    </section>

      {gaps === null ? (
        <p className="ed-muted">
          The roadmap is momentarily unavailable — ask your AI to call{" "}
          <code>list_gaps</code> on the Terraveler MCP server instead.
        </p>
      ) : (
        <div className="ed-card-list">
          {gaps.map((g) => (
            <div
              key={g.id}
              className="ed-roadmap-card"
              data-claimed={g.status === "claimed" ? "true" : "false"}
            >
              <div className="ed-card-head">
                <strong>{g.title}</strong>
                <span className="ed-badges">
                  <span className="conf-badge">{KIND_LABEL[g.kind] ?? g.kind}</span>
                  <span className="conf-badge">{g.status === "claimed" ? "claimed" : `priority ${g.priority}`}</span>
                </span>
              </div>
              {g.description && (
                <p>{g.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="ed-muted">
        Beyond the list: our AI also computes, from the live data, which landfalls still
        lack period imagery, journal excerpts or firm dates — ask it via{" "}
        <code>list_gaps</code> once connected.
      </p>

    </EditorialPage>
    <SiteFooter />
    </>
  );
}
