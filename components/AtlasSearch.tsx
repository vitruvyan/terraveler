"use client";

import Icon, { type IconName } from "@/components/Icon";
import { useEffect, useRef, useState } from "react";
import { fetchCurrentPrompts, renderPrompt, type PromptMap } from "@/lib/promptRegistry";

/**
 * Atlas search: debounced autocomplete against /api/search.
 *
 * The index stays on the server — the browser never downloads the atlas — so
 * this behaves the same whether there are six voyages or six thousand. When a
 * query matches nothing, the dead end becomes the contribution funnel: the
 * reader is told the atlas doesn't hold it *yet*, and handed a prompt their
 * own AI can act on.
 */

type Item = { type: string; label: string; sublabel: string; href: string };
type Group = { type: string; label: string; items: Item[] };
type Topic = { label: string; count: number; href: string };
type Result = {
  q: string;
  groups: Group[];
  total: number;
  topics?: Topic[];
  counts?: { voyages: number; places: number; kind?: number };
  featured?: Item[];
  missing?: { query: string } | null;
};

const ICON: Record<string, IconName> = {
  voyage: "anchor",
  navigator: "compass",
  place: "pin",
  era: "hourglass",
};

/* Content now lives in the versioned prompt registry (prompt_key
 * "contribution" — supabase/agent_prompts_schema.sql), edited from the desk
 * without a deploy. This stays a pure render over already-fetched prompts
 * (see the `prompts` state below) so the clipboard write in copyPrompt()
 * still fires synchronously within the click that triggers it. */
function contributionPrompt(prompts: PromptMap | null, query: string): string | null {
  return renderPrompt(prompts, "contribution", { query });
}

export default function AtlasSearch({
  autoFocus = false,
  placeholder = "Search voyages, navigators, places…",
  initialQuery = "",
  onActiveChange,
  kind,
  excludeSlug,
  browseAll = true,
}: {
  autoFocus?: boolean;
  placeholder?: string;
  initialQuery?: string;
  /** Restricts the browse list to one family of voyages (earth/surface/space). */
  kind?: string;
  /** The voyage being read — left out of "also in the atlas". */
  excludeSlug?: string;
  /** Show the link out to the full atlas (off on the atlas page itself). */
  browseAll?: boolean;
  /** Fires when the field goes from empty to searching and back, so a host
   *  panel can hide its own browse list instead of stacking it under the
   *  results. */
  onActiveChange?: (active: boolean) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prompts, setPrompts] = useState<PromptMap | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    fetchCurrentPrompts().then(setPrompts);
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (kind) params.set("kind", kind);
        if (excludeSlug) params.set("exclude", excludeSlug);
        const r = await fetch(`/api/search?${params}`);
        const j = await r.json();
        if (mine === seq.current) setRes(j);
      } catch {
        /* keep the last good result rather than blanking the panel */
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, q ? 180 : 0);   // debounce typing; load the browse view immediately
    return () => clearTimeout(t);
  }, [q, kind, excludeSlug]);

  // Tell the atlas it was asked for something it does not hold — but only once
  // the asking has stopped.
  //
  // The results debounce is 180ms, which is right for an autocomplete and wrong
  // for a demand signal: every keystroke that found nothing was recorded as a
  // separate request, so typing "shackleton" put shac, shak, shakle, shaklet
  // and shakletong on the editor's list of things people wanted. The list
  // filled up with the act of typing rather than with anyone's intent.
  //
  // A second, much longer pause is the closest thing to "I have finished
  // asking" that a search box can observe. One small request, only for a query
  // that already came back empty, and only if it is still on screen a second
  // and a half later.
  useEffect(() => {
    const query = q.trim();
    if (!query || res?.total !== 0 || res?.q !== q) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, record: "1" });
      if (kind) params.set("kind", kind);
      if (excludeSlug) params.set("exclude", excludeSlug);
      fetch(`/api/search?${params}`).catch(() => {
        /* the demand log is best-effort; never surface it to the reader */
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [q, res, kind, excludeSlug]);

  useEffect(() => {
    onActiveChange?.(Boolean(q.trim()));
  }, [q, onActiveChange]);

  const copyPrompt = async () => {
    const text = contributionPrompt(prompts, res?.missing?.query ?? q);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the textarea below is selectable */
    }
  };

  return (
    <div className="atlas-search">
      <input
        className="desk-input atlas-search-input"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search the atlas"
        type="search"
      />

      {/* Empty query: browse what the atlas holds. Grows with the atlas
          instead of being a hand-kept shortlist. */}
      {!q.trim() && res?.topics && (
        <div className="atlas-search-browse">
          {res.counts && (
            <div className="atlas-search-count">
              {res.counts.voyages} voyages · {res.counts.places} landfalls indexed
            </div>
          )}
          {res.topics.length > 0 && (
            <>
              <div className="atlas-search-grouphead">Browse by era</div>
              <div className="atlas-chips">
                {res.topics.map((t) => (
                  <button key={t.label} type="button" className="atlas-chip" onClick={() => setQ(t.label)}>
                    {t.label} ({t.count})
                  </button>
                ))}
              </div>
            </>
          )}

          {/* A bounded handful, never the whole atlas — the rest is one click
              away rather than an endless scroll inside a 350px panel. */}
          {res.featured && res.featured.length > 0 && (
            <>
              <div className="atlas-search-grouphead">Voyages</div>
              {res.featured.map((it) => (
                <a key={it.href} className="atlas-search-hit" href={it.href}>
                  <span className="atlas-search-ico" aria-hidden="true"><Icon name="anchor" size={16} /></span>
                  <span>
                    <strong>{it.label}</strong>
                    <span className="atlas-search-sub">{it.sublabel}</span>
                  </span>
                </a>
              ))}
            </>
          )}

          {browseAll && (
            <a className="atlas-search-browseall" href="/voyages">
              Browse all {res.counts?.kind ?? res.counts?.voyages ?? ""} voyages →
            </a>
          )}
        </div>
      )}

      {q.trim() && (
        <div className="atlas-search-results">
          {res?.groups.map((g) => (
            <div key={g.type} className="atlas-search-group">
              <div className="atlas-search-grouphead">{g.label}</div>
              {g.items.map((it) => (
                <a key={it.href + it.label} className="atlas-search-hit" href={it.href}>
                  <span className="atlas-search-ico" aria-hidden="true">
                    {ICON[it.type] ? <Icon name={ICON[it.type]} size={16} /> : "\u00b7"}
                  </span>
                  <span>
                    <strong>{it.label}</strong>
                    {it.sublabel && <span className="atlas-search-sub">{it.sublabel}</span>}
                  </span>
                </a>
              ))}
            </div>
          ))}

          {res && res.total === 0 && !loading && (
            <div className="atlas-search-missing">
              <div className="atlas-search-grouphead">Not in the atlas — yet</div>
              <p>
                Nothing here for <strong>“{res.q}”</strong>. The atlas is written by AI
                under human command and grows by request: your assistant can research it
                from public-domain sources and propose it to the editorial desk.
              </p>
              <div className="atlas-search-actions">
                <button type="button" className="welcome-btn primary" onClick={copyPrompt} disabled={!prompts}>
                  {copied ? "Copied" : prompts ? "Copy the prompt for your AI" : "Loading prompt…"}
                </button>
                <a className="welcome-btn" href="/how-it-works">How contributing works</a>
              </div>
            </div>
          )}

          {loading && !res?.groups.length && <div className="atlas-search-count">Searching…</div>}
        </div>
      )}
    </div>
  );
}
