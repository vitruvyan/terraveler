"use client";

import Link from "next/link";
import { useState } from "react";
import AccountPanel from "@/components/AccountPanel";

const NAV_LINKS = [
  { href: "/search", label: "Search" },
  { href: "/voyages", label: "The Atlas" },
  { href: "/about", label: "About" },
  { href: "/contribute", label: "Contribute" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/magna-carta", label: "The Magna Carta" },
];

/** Bold, fixed site header for editorial pages. (The map page keeps its
 *  floating cartouche chrome; the account panel is shared by both.) */
export default function SiteHeader() {
  const [acct, setAcct] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <div className="sh-inner">
          <div className="sh-brand">
            <Link href="/" className="sh-wordmark">Terraveler</Link>
            <span className="sh-tagline">An atlas of geo-history, written in tandem</span>
          </div>
          <nav className="sh-nav" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>{link.label}</Link>
            ))}
          </nav>
          <div className="sh-actions">
            <button
              className="tr-btn sh-menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              title="Menu"
              aria-label="Menu"
              aria-expanded={menuOpen}
              aria-controls="site-mobile-nav"
            >
              {menuOpen ? "×" : "☰"}
            </button>
            <button className="tr-btn sh-acct" onClick={() => setAcct(true)} title="Account" aria-label="Account">
              👤
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="site-mobile-nav" className="sh-mobile-menu" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <AccountPanel open={acct} onClose={() => setAcct(false)} />
    </>
  );
}
