/**
 * Governed Wikimedia Commons image consultation (the `wikimedia_api`
 * verification strategy declared in lib/source-governance.ts).
 *
 * Commons is registered with mixed licensing, so a domain-level decision can
 * never make a file usable. Every file is verified individually from the
 * Commons API's own machine-readable licence metadata, and anything that is
 * not public domain, CC0, CC BY or CC BY-SA is refused — including unknown,
 * non-commercial, no-derivatives and non-free files. Nothing here looks at
 * pixels or describes an image: these are metadata snapshots only.
 */
import { ensureRegistry, isGovernedHost, registryUnavailable } from "@/lib/sourceSearch";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "Terraveler-CommonsImages/1.0 (+https://www.terraveler.com)";
const TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 2_000_000;
const THUMB_WIDTH = 1280;
const METADATA_FIELDS = [
  "License", "LicenseShortName", "LicenseUrl", "UsageTerms", "AttributionRequired", "Copyrighted",
  "NonFree", "Restrictions", "Artist", "Credit", "DateTimeOriginal", "ImageDescription", "ObjectName",
];

export type LicenceClass = "public_domain" | "cc0" | "cc_by" | "cc_by_sa";
export const ACCEPTED_LICENCE_CLASSES: readonly LicenceClass[] = ["public_domain", "cc0", "cc_by", "cc_by_sa"];

export type LicenceDecision =
  | { usable: true; class: LicenceClass; code: string; short_name: string; url: string | null; attribution_required: boolean }
  | { usable: false; reason: string; code: string | null; short_name: string | null };

export type CommonsImage = {
  kind: "commons-image";
  title: string;
  page_url: string;
  page_id: number;
  revision_id: number;
  image_url: string;
  thumb_url: string | null;
  mime: string;
  width: number;
  height: number;
  sha1: string;
  licence: Extract<LicenceDecision, { usable: true }>;
  artist: string | null;
  credit: string | null;
  date_original: string | null;
  date_year: number | null;
  description: string | null;
  object_name: string | null;
  restrictions: string[];
};

export type CommonsCandidate =
  | (CommonsImage & { usable: true })
  | { usable: false; title: string; page_url: string; reason: string; licence_short_name: string | null };

type Fetcher = typeof fetch;

const IMAGE_MIME = /^image\/(jpeg|png|gif|tiff|webp|svg\+xml)$/;
// Originals live on upload.wikimedia.org; Commons now serves scaled thumbnails from thumb.wikimedia.org.
const ORIGINAL_HOSTS = new Set(["upload.wikimedia.org"]);
const THUMB_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

/** Canonical https media URL on an allowed Wikimedia host, without utm_* tracking parameters; null otherwise. */
export function mediaUrl(value: unknown, hosts: Set<string>): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !hosts.has(url.hostname)) return null;
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  url.hash = "";
  return url.toString();
}

/** Plain text from Commons extmetadata HTML: tags removed, common entities decoded, whitespace collapsed. */
export function plainText(value: unknown, limit = 2000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|dd|dt|dl)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#0*39;/g, "'").replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

function meta(ext: Record<string, any> | undefined, key: string): string | null {
  const value = ext?.[key]?.value;
  return typeof value === "string" ? value : null;
}

/**
 * Per-file licence decision from Commons extmetadata. Fail closed: a missing,
 * ambiguous or unrecognized licence is refused, never guessed.
 */
export function classifyLicence(ext: Record<string, any> | undefined): LicenceDecision {
  const code = (meta(ext, "License") ?? "").trim().toLowerCase();
  const shortName = plainText(meta(ext, "LicenseShortName"), 200);
  const url = plainText(meta(ext, "LicenseUrl"), 500);
  const nonFree = (meta(ext, "NonFree") ?? "").trim().toLowerCase();
  if (nonFree && nonFree !== "false") return { usable: false, reason: "non-free", code: code || null, short_name: shortName };
  const name = (shortName ?? "").toLowerCase();
  const signature = `${code} ${name}`;
  if (!code && !name) return { usable: false, reason: "licence-unknown", code: null, short_name: null };
  // Restrictive terms win over any permissive prefix in the same string.
  if (/(^|[^a-z])nc([^a-z]|$)|non-?commercial/.test(signature)) return { usable: false, reason: "licence-non-commercial", code: code || null, short_name: shortName };
  if (/(^|[^a-z])nd([^a-z]|$)|no-?deriv/.test(signature)) return { usable: false, reason: "licence-no-derivatives", code: code || null, short_name: shortName };
  const attribution = (meta(ext, "AttributionRequired") ?? "").trim().toLowerCase() === "true";
  const accept = (cls: LicenceClass) => ({ usable: true as const, class: cls, code: code || name, short_name: shortName ?? code, url, attribution_required: attribution });
  if (code === "cc0" || /^cc0\b|^cc-zero$/.test(code) || /^cc0\b/.test(name)) return accept("cc0");
  if (code === "pd" || code.startsWith("pd-") || /^public domain\b/.test(name)) return accept("public_domain");
  if (/^cc-by-sa-\d(\.\d)?(-[a-z]{2,3})?$/.test(code) || (!code && /^cc by-sa \d(\.\d)?\b/.test(name))) return accept("cc_by_sa");
  if (/^cc-by-\d(\.\d)?(-[a-z]{2,3})?$/.test(code) || (!code && /^cc by \d(\.\d)?\b/.test(name))) return accept("cc_by");
  return { usable: false, reason: "licence-not-accepted", code: code || null, short_name: shortName };
}

/** The first plausible four-digit year (500-2099) in a free-form Commons date. */
export function yearOf(date: string | null): number | null {
  const match = date?.match(/(?<!\d)(5\d\d|[6-9]\d\d|1\d{3}|20\d{2})(?!\d)/);
  return match ? Number(match[1]) : null;
}

export function filePageUrl(title: string): string {
  return "https://commons.wikimedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
}

/** Canonical "File:..." title from a bare name, a File: title or a commons.wikimedia.org/wiki/File:... URL. */
export function normalizeFileTitle(input: string): string {
  let value = input.trim();
  const prefix = "https://commons.wikimedia.org/wiki/";
  if (value.startsWith(prefix)) value = decodeURIComponent(value.slice(prefix.length).split(/[?#]/)[0]);
  value = value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!/^file:/i.test(value)) value = "File:" + value;
  value = "File:" + value.slice(5).trim();
  if (value.length < 6 || value.length > 255 || /[#<>[\]{}|\u0000-\u001f]/.test(value))
    throw new Error("Commons file title is invalid.");
  return value;
}

async function governedGet(params: Record<string, string>, fetcher: Fetcher): Promise<any> {
  await ensureRegistry();
  if (registryUnavailable())
    throw new Error("The source registry cannot be read right now, so Commons cannot be confirmed as governed — refusing to fetch (fail closed).");
  if (!isGovernedHost(COMMONS_API))
    throw new Error("commons.wikimedia.org is not an active Terraveler source endpoint — refusing to fetch.");
  const url = new URL(COMMONS_API);
  for (const [key, value] of Object.entries({ ...params, format: "json", formatversion: "2", maxlag: "5" })) url.searchParams.set(key, value);
  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Commons API returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Commons API response exceeds the size limit.");
  let body: any;
  try { body = JSON.parse(text); } catch { throw new Error("Commons API returned invalid JSON."); }
  if (body?.error) throw new Error("Commons API refused the request.");
  return body;
}

const IMAGE_PROPS = {
  prop: "imageinfo|info",
  iiprop: "url|extmetadata|mime|size|sha1",
  iiurlwidth: String(THUMB_WIDTH),
  iiextmetadatafilter: METADATA_FIELDS.join("|"),
  iiextmetadatalanguage: "en",
};

function fromPage(page: any): CommonsCandidate | null {
  const title = typeof page?.title === "string" ? page.title : null;
  if (!title || !title.startsWith("File:") || page.missing) return null;
  const page_url = filePageUrl(title);
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  if (!info) return { usable: false, title, page_url, reason: "no-image-info", licence_short_name: null };
  const ext = info.extmetadata ?? {};
  const licence = classifyLicence(ext);
  if (!licence.usable) return { usable: false, title, page_url, reason: licence.reason, licence_short_name: licence.short_name };
  const imageUrl = mediaUrl(info.url, ORIGINAL_HOSTS);
  const thumb = info.thumburl == null ? null : mediaUrl(info.thumburl, THUMB_HOSTS);
  if (!imageUrl || (info.thumburl != null && !thumb))
    return { usable: false, title, page_url, reason: "image-host-not-wikimedia-media", licence_short_name: licence.short_name };
  if (typeof info.mime !== "string" || !IMAGE_MIME.test(info.mime))
    return { usable: false, title, page_url, reason: "not-a-still-image", licence_short_name: licence.short_name };
  const ints = [page.pageid, page.lastrevid, info.width, info.height];
  if (!ints.every(n => Number.isSafeInteger(n) && n > 0) || typeof info.sha1 !== "string" || !/^[0-9a-f]{40}$/.test(info.sha1))
    return { usable: false, title, page_url, reason: "incomplete-file-identity", licence_short_name: licence.short_name };
  const dateOriginal = plainText(meta(ext, "DateTimeOriginal"), 200);
  const restrictions = (plainText(meta(ext, "Restrictions"), 300) ?? "").split(/[|,]/).map(s => s.trim()).filter(Boolean);
  return {
    usable: true, kind: "commons-image", title, page_url, page_id: page.pageid, revision_id: page.lastrevid,
    image_url: imageUrl, thumb_url: thumb, mime: info.mime, width: info.width, height: info.height, sha1: info.sha1,
    licence, artist: plainText(meta(ext, "Artist"), 500), credit: plainText(meta(ext, "Credit"), 500),
    date_original: dateOriginal, date_year: yearOf(dateOriginal),
    description: plainText(meta(ext, "ImageDescription"), 2000), object_name: plainText(meta(ext, "ObjectName"), 300),
    restrictions,
  };
}

/**
 * Search Commons files (namespace 6, still images). Candidates carry their
 * per-file licence decision; refused files are listed with the reason so the
 * refusal is visible, never silently dropped. A candidate is not a consultation.
 */
export async function searchCommonsImages(query: string, limit = 10, fetcher: Fetcher = fetch): Promise<CommonsCandidate[]> {
  const q = query.replace(/\s+/g, " ").trim();
  if (q.length < 2 || q.length > 300) throw new Error("Commons search query must be 2-300 characters.");
  const n = Math.max(1, Math.min(20, Math.trunc(limit)));
  const body = await governedGet({ action: "query", generator: "search", gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap|drawing`, gsrlimit: String(n), ...IMAGE_PROPS }, fetcher);
  const pages = Array.isArray(body?.query?.pages) ? body.query.pages : [];
  return pages
    .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0))
    .map(fromPage)
    .filter((c: CommonsCandidate | null): c is CommonsCandidate => c !== null);
}

/** One file's current metadata snapshot, revision-bound. Throws if the file is missing or not usable. */
export async function fetchCommonsImage(title: string, fetcher: Fetcher = fetch): Promise<CommonsImage> {
  const file = normalizeFileTitle(title);
  const body = await governedGet({ action: "query", titles: file, ...IMAGE_PROPS }, fetcher);
  const page = Array.isArray(body?.query?.pages) ? body.query.pages[0] : null;
  const candidate = fromPage(page);
  if (!candidate) throw new Error("Commons file not found.");
  if (!candidate.usable) throw new Error(`Commons file refused: ${candidate.reason}.`);
  const { usable: _usable, ...image } = candidate;
  return image;
}
