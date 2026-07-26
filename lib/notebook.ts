/**
 * The notebook: what the reader has collected, with its citations attached.
 *
 * This is the primitive the site was missing. A student researching Magellan is
 * not browsing — over forty minutes they are *building* something, and until now
 * every page treated each visit as isolated. The chat is how you add to the
 * notebook; the notebook is what makes the chat worth opening; the export is the
 * notebook. That is also what dissolves "I don't know what to ask it": you are
 * not conversing, you are collecting.
 *
 * Deliberately client-only and anonymous — localStorage, no account, no server
 * copy. A fifteen-year-old doing homework should not have to sign up, and the
 * atlas has no business knowing what they are reading.
 *
 * Kept items are appended, never rewritten: a citation is the whole value here,
 * so an item that lost its source would be worse than no item at all.
 */

export const NOTEBOOK_KEY = "tv-notebook-v1";
export const NOTEBOOK_EVENT = "tv-notebook-change";
/** Enough for a school assignment; past this the dossier stops being a dossier. */
export const NOTEBOOK_LIMIT = 60;

export interface KeptItem {
  /** "quote" is verbatim text the reader selected from a source; "note" is an
   *  answer assembled from the atlas's verified fields. The dossier keeps them
   *  apart because only the first is a quotation. */
  kind: "quote" | "note";
  text: string;
  source: string;
  sourceUrl?: string;
  /** Where in the atlas it came from — "24. Cape of the Eleven Thousand Virgins". */
  stage?: string;
  voyage?: string;
  at: number;
}

export type NewKeptItem = Omit<KeptItem, "at">;

function read(): KeptItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as KeptItem[]) : [];
  } catch {
    // Corrupt or unavailable storage must not take the page down with it.
    return [];
  }
}

function write(items: KeptItem[]): void {
  try {
    window.localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(items));
  } catch {
    /* private mode, or quota — the notebook degrades, the page does not */
  }
  window.dispatchEvent(new CustomEvent(NOTEBOOK_EVENT));
}

export function readNotebook(): KeptItem[] {
  return read();
}

/** Adds an item, unless the same text is already held. Announced on the window
 *  rather than through React context: any stage on the page can keep something,
 *  and threading a provider through a server-rendered log to reach them all
 *  would buy nothing. */
export function keepInNotebook(item: NewKeptItem): void {
  const items = read();
  const key = item.text.trim();
  if (!key) return;
  if (items.some((i) => i.text.trim() === key)) return;
  const next = [...items, { ...item, at: Date.now() }].slice(-NOTEBOOK_LIMIT);
  write(next);
}

export function removeFromNotebook(at: number): void {
  write(read().filter((i) => i.at !== at));
}

export function clearNotebook(): void {
  write([]);
}
