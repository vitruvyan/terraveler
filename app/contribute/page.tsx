import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contribute — Terraveler",
  description:
    "What Terraveler is looking for right now: the open editorial roadmap. Bring an idea, connect your AI, and help the atlas grow.",
};
export const dynamic = "force-dynamic";

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
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
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
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 22px 80px", lineHeight: 1.65 }}>
      <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
        Terraveler · Contribute
      </span>
      <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>What the atlas is looking for</h1>
      <p style={{ margin: "14px 0 6px", color: "var(--ink-soft)" }}>
        Terraveler grows through a simple tandem: <strong>you bring the idea, your AI does
        the work, our Curator verifies everything</strong> against the{" "}
        <a href="https://github.com/vitruvyan/terraveler/blob/main/MAGNA_CARTA.md" target="_blank" rel="noreferrer">
          Magna Carta of the Seas
        </a>
        . Below is the live editorial roadmap — the desk&rsquo;s current priorities.
        Connect your assistant and claim one:{" "}
        <a href="https://github.com/vitruvyan/terraveler/blob/main/docs/HOW_IT_WORKS.md" target="_blank" rel="noreferrer">
          how it works
        </a>
        .
      </p>

      {gaps === null ? (
        <p style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>
          The roadmap is momentarily unavailable — ask your AI to call{" "}
          <code>list_gaps</code> on the Terraveler MCP server instead.
        </p>
      ) : (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {gaps.map((g) => (
            <div
              key={g.id}
              style={{
                border: "1px solid var(--parchment-deep)",
                borderRadius: 10,
                padding: "14px 16px",
                background: "rgba(255,255,255,0.35)",
                opacity: g.status === "claimed" ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>{g.title}</strong>
                <span style={{ display: "flex", gap: 6 }}>
                  <span className="conf-badge">{KIND_LABEL[g.kind] ?? g.kind}</span>
                  <span className="conf-badge">{g.status === "claimed" ? "claimed" : `priority ${g.priority}`}</span>
                </span>
              </div>
              {g.description && (
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--ink-soft)" }}>{g.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 28 }}>
        Beyond the list: our AI also computes, from the live data, which landfalls still
        lack period imagery, journal excerpts or firm dates — ask it via{" "}
        <code>list_gaps</code> once connected.
      </p>

      <p style={{ marginTop: 32 }}>
        <Link href="/about">About Terraveler</Link> · <Link href="/">← Return to the voyage</Link>
      </p>
    </main>
  );
}
