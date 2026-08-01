"use client";

import Icon from "@/components/Icon";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AccountPanel from "@/components/AccountPanel";

/* Seven links, presented identically, were three different kinds of thing:
 *
 *   the atlas          — what the site IS
 *   taking part        — Contribute, The crew
 *   about the project  — About, How it works, The Magna Carta
 *
 * Flattened into one row they read as seven equally likely destinations, which
 * is true of none of them: the project pages are read once, the atlas is read
 * every visit. And nothing said where you were.
 *
 * "Search" was a nav item pointing at a page that was a wrapper around a
 * component. Searching is an action, not a destination — it opens in the bar
 * and lands in the atlas, where the results live.
 */

/* The destinations themselves live in lib/nav, because the map's compass menu
 * offers the same doors and used to keep its own copy — which went stale
 * through two reforms without anyone noticing. */
import { ATLAS, PRIMARY, PROJECT, ALL } from "@/lib/nav";

/** Bold, fixed site header for editorial pages. (The map page keeps its
 *  floating cartouche chrome; the account panel is shared by both.) */
export default function SiteHeader() {
  const [acct, setAcct] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);

  const here = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const inProject = PROJECT.some((l) => here(l.href));

  useEffect(() => {
    if (searching) field.current?.focus();
  }, [searching]);

  useEffect(() => {
    if (!searching && !projectOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSearching(false); setProjectOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, projectOpen]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    /* Searching is an action; the atlas is where it lands. */
    router.push(term ? `${ATLAS.href}?q=${encodeURIComponent(term)}` : ATLAS.href);
    setSearching(false);
  }

  return (
    <header className="site-header">
      <div className="sh-inner">
        <div className="sh-brand">
          <Link href="/" className="wordmark sh-wordmark">Terraveler</Link>
          <span className="sh-tagline">An atlas of geo-history, written in tandem</span>
        </div>

        {searching ? (
          <form className="sh-search" onSubmit={submit} role="search">
            <Icon name="lens" size={17} />
            <input
              ref={field}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => { if (!q.trim()) setSearching(false); }}
              placeholder="A voyage, a navigator, a landfall…"
              aria-label="Search the atlas"
            />
            <button
              type="button"
              className="sh-search-close"
              onClick={() => setSearching(false)}
              aria-label="Close search"
            >
              <Icon name="close" size={15} />
            </button>
          </form>
        ) : (
          <nav className="sh-nav" aria-label="Primary navigation">
            {PRIMARY.map((link) => (
              <Link key={link.href} href={link.href} aria-current={here(link.href) ? "page" : undefined}>
                {link.label}
              </Link>
            ))}

            <span className="sh-disclosure">
              <button
                type="button"
                className="sh-nav-btn"
                aria-expanded={projectOpen}
                aria-current={inProject ? "page" : undefined}
                onClick={() => setProjectOpen((o) => !o)}
              >
                The project
              </button>
              {projectOpen && (
                <>
                  <button
                    className="acct-dismiss"
                    onClick={() => setProjectOpen(false)}
                    aria-label="Close"
                    tabIndex={-1}
                  />
                  <span className="sh-submenu">
                    {PROJECT.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        aria-current={here(link.href) ? "page" : undefined}
                        onClick={() => setProjectOpen(false)}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </span>
                </>
              )}
            </span>
          </nav>
        )}

        <div className="sh-actions">
          {!searching && (
            <button
              className="tr-btn sh-search-open"
              onClick={() => setSearching(true)}
              title="Search the atlas"
              aria-label="Search the atlas"
            >
              <Icon name="lens" size={18} />
            </button>
          )}
          <button
            className="tr-btn sh-menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            title="Menu"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="site-mobile-nav"
          >
            <Icon name={menuOpen ? "close" : "menu"} size={19} />
          </button>
          <div className="acct-anchor">
            <button
              className="tr-btn sh-acct"
              onClick={() => setAcct((open) => !open)}
              title="Account"
              aria-label="Account"
              aria-expanded={acct}
            >
              <Icon name="morion" size={23} />
            </button>
            <AccountPanel open={acct} onClose={() => setAcct(false)} />
          </div>
        </div>
      </div>

      {menuOpen && (
        <nav id="site-mobile-nav" className="sh-mobile-menu" aria-label="Primary navigation">
          {ALL.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={here(link.href) ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
