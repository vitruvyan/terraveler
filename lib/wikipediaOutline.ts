import { createHash } from "node:crypto";
import { ensureRegistry, getGovernedText, isGovernedHost, MAX_FETCHED_TEXT_CHARS, wikisourceRenderToText } from "@/lib/sourceSearch";

/** One MCP orientation snapshot. Not a persisted consultation receipt or a validated plan. */
export type WikipediaOutline = {
  kind: "wikipedia-orientation"; purpose: "planning-only";
  requested_url: string; page_url: string; revision_url: string; revision_id: number;
  title: string; retrieved_at: string; snapshot_sha256: string;
  sections: { index: string; level: number; title: string; anchor: string }[];
  text: string; total_text_length: number; text_truncated: boolean;
  sections_truncated: boolean; external_links_truncated: boolean;
  external_links_candidates: string[];
  notice: string;
};

function wikipediaPage(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 2000) throw Error("A Wikipedia article URL is required.");
  let url: URL;
  try { url = new URL(raw); } catch { throw Error("Invalid Wikipedia URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^[a-z][a-z0-9-]{1,19}[.]wikipedia[.]org$/.test(url.hostname) ||
      !url.pathname.startsWith("/wiki/") || url.search || url.hash)
    throw Error("Use a plain https://<language>.wikipedia.org/wiki/<article> URL without query or fragment.");
  let title: string;
  try { title = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " "); }
  catch { throw Error("Invalid Wikipedia page title."); }
  if (!title.trim() || title.length > 500 || /[\u0000-\u001f\u007f]/.test(title)) throw Error("Invalid Wikipedia page title.");
  return { url, title };
}

function candidateUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

/** Pure seam for offline tests. Revision, table of contents, links and body
 * must all be from ONE parse response, never mixed with a later page read. */
export function normalizeWikipediaOutline(rawUrl: string, payload: unknown, retrievedAt: string): WikipediaOutline {
  const { url } = wikipediaPage(rawUrl);
  const p = (payload as any)?.parse;
  if (!p || !Number.isSafeInteger(p.revid) || p.revid <= 0 ||
      typeof p.title !== "string" || !p.title.trim() || p.title.length > 500 ||
      !Array.isArray(p.sections) || !Array.isArray(p.externallinks) ||
      typeof p.text?.["*"] !== "string")
    throw Error("Wikipedia did not return a complete revision-bound parse response.");
  const body = wikisourceRenderToText(p.text["*"]);
  if (!body.trim()) throw Error("Wikipedia returned no readable article text.");
  const sections = p.sections.slice(0, 200).map((s: any) => {
    const level = Number(s?.level);
    if (typeof s?.index !== "string" || !/^\d+$/.test(s.index) ||
        !Number.isInteger(level) || level < 1 || level > 6 ||
        typeof s.line !== "string" || s.line.length > 2000 ||
        typeof s.anchor !== "string" || s.anchor.length > 2000)
      throw Error("Wikipedia returned a malformed section.");
    return { index: s.index, level, title: wikisourceRenderToText(s.line), anchor: s.anchor };
  });
  const external = [...new Set<string>(p.externallinks.map(candidateUrl).filter((v: string | null): v is string => v !== null))];
  const revisionUrl = `https://${url.hostname}/w/index.php?oldid=${p.revid}`;
  const snapshot = {
    kind: "wikipedia-orientation" as const, purpose: "planning-only" as const,
    requested_url: url.href, page_url: `https://${url.hostname}/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
    revision_url: revisionUrl, revision_id: p.revid, title: p.title,
    sections, text: body.slice(0, MAX_FETCHED_TEXT_CHARS), total_text_length: body.length,
    text_truncated: body.length > MAX_FETCHED_TEXT_CHARS,
    sections_truncated: p.sections.length > 200, external_links_truncated: external.length > 200,
    external_links_candidates: external.slice(0, 200),
  };
  return { ...snapshot, retrieved_at: retrievedAt,
    snapshot_sha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    notice: "Orientation for the editorial plan, not independently verified historical evidence. External links are candidates, not consulted sources or a classified bibliography. Truncation flags describe separate limits. This snapshot is not a persisted MCP consultation receipt.",
  };
}

/** Called by the MCP dispatcher only. All outbound I/O remains behind the
 * existing live source registry and governed redirect checks. No fallback. */
export async function fetchWikipediaOutline(rawUrl: unknown, retentionRequired = false): Promise<WikipediaOutline> {
  const { url, title } = wikipediaPage(rawUrl);
  await ensureRegistry();
  if (!isGovernedHost(url.href)) throw Error("Wikipedia source is not currently governed; refusing orientation.");
  const query = new URLSearchParams({ action: "parse", page: title, redirects: "1",
    prop: "sections|text|revid|externallinks", format: "json" });
  const raw = await getGovernedText(`https://${url.hostname}/w/api.php?${query}`, fetch, retentionRequired);
  if (raw.length > 4_000_000) throw Error("Wikipedia orientation response exceeds the inspection limit.");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw Error("Wikipedia orientation response was not JSON."); }
  return normalizeWikipediaOutline(url.href, payload, new Date().toISOString());
}
