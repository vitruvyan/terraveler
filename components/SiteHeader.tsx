"use client";

import Link from "next/link";
import { useState } from "react";
import AccountPanel from "@/components/AccountPanel";

/** Bold, fixed site header for editorial pages. (The map page keeps its
 *  floating cartouche chrome; the account panel is shared by both.) */
export default function SiteHeader() {
  const [acct, setAcct] = useState(false);
  return (
    <>
      <header className="site-header">
        <div className="sh-inner">
          <div className="sh-brand">
            <Link href="/" className="sh-wordmark">Terraveler</Link>
            <span className="sh-tagline">An atlas of geo-history, written in tandem</span>
          </div>
          <nav className="sh-nav">
            <Link href="/">The voyage</Link>
            <Link href="/about">About</Link>
            <Link href="/contribute">Contribute</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/magna-carta">The Magna Carta</Link>
          </nav>
          <button className="tr-btn sh-acct" onClick={() => setAcct(true)} title="Account" aria-label="Account">
            👤
          </button>
        </div>
      </header>
      <AccountPanel open={acct} onClose={() => setAcct(false)} />
    </>
  );
}
