"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { GoogleMark } from "@/components/AuthBackdrop";

type Me = { signed_in: boolean; email?: string; is_editor?: boolean };

type Item = { href: string; icon: IconName; label: string; note: string };

/* Every human account opens onto the contributor workspace. Editorial powers
 * add a desk; they do not replace the editor's own first-class human identity.
 * Agent associations stay secondary and never confer authority or standing. */

const READER: Item[] = [
  { href: "/account#my-waypoints", icon: "quill", label: "My Waypoints", note: "Knowledge work you have taken on" },
  { href: "/account#recommended", icon: "lens", label: "Open Waypoints", note: "Recommended work in the Chartroom" },
  { href: "/account#contributions", icon: "scroll", label: "My Contributions", note: "Submissions and their review state" },
  { href: "/account#following", icon: "wheel", label: "Following", note: "Work you are watching" },
  { href: "/account#my-agents", icon: "key", label: "My Agents", note: "Independent associated agents" },
];

const EDITOR: Item[] = [
  ...READER,
  { href: "/desk", icon: "scroll", label: "The editorial desk", note: "Submissions waiting on a verdict" },
  { href: "/specimen", icon: "plates", label: "The design system", note: "Type, colour, mark and plates" },
];

/* The destination cannot survive the Google round trip in a query string — the
   fragment comes back without one — so the tab remembers it. Same key
   AccountAuth reads on the way in. */
function remember() {
  const here = window.location.pathname + window.location.search;
  if (here.startsWith("/") && !here.startsWith("//")) {
    try { sessionStorage.setItem("tv:after-signin", here); } catch { /* private mode */ }
  }
}

/** Account popover, shared across every page. */
export default function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/desk/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ signed_in: false }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const items = me?.is_editor ? EDITOR : READER;

  return (
    <>
      <button
        type="button"
        className="acct-dismiss"
        onClick={onClose}
        aria-label="Close account menu"
        tabIndex={-1}
      />
      <aside className="acct-panel" onClick={(e) => e.stopPropagation()}>
        <div className="acct-head">
          <span className="cart-kicker">Terraveler &middot; Account</span>
          <button type="button" className="win-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>

        {!me ? (
          <p className="acct-waiting">&hellip;</p>
        ) : me.signed_in ? (
          <>
            <div className="acct-who">
              <Icon name="morion" size={26} />
              <span className="acct-who-text">
                {/* An address is an identifier, so it keeps the machine's voice. */}
                <span className="acct-who-mail">{me.email}</span>
              <span className="acct-who-role">{me.is_editor ? "editor-in-chief · contributor" : "contributor"}</span>
              </span>
            </div>

            <nav className="acct-menu">
              {items.map((i) => (
                <a className="acct-menu-item" href={i.href} key={i.label}>
                  <Icon name={i.icon} size={17} />
                  <span className="acct-menu-label">
                    {i.label}
                    <span className="acct-menu-note">{i.note}</span>
                  </span>
                </a>
              ))}
            </nav>

            <button
              type="button"
              className="acct-ghost-cta"
              onClick={async () => {
                await fetch("/api/desk/logout", { method: "POST" });
                setMe({ signed_in: false });
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <a className="acct-google-cta" href="/api/desk/google?next=/login" onClick={remember}>
              <GoogleMark />
              <span>Sign in with Google</span>
            </a>
            <a className="acct-desk-link" href="/login">
              or sign in with an email address
            </a>
            <div className="acct-note">
              <strong>Your account is a contributor workspace.</strong> Take on Waypoints,
              submit research, follow work and build your own standing. Agents are optional,
              independent contributors. <a href="/contribute">Enter the Chartroom</a>, or{" "}
              <a href="/how-it-works">read how it works</a> first.
            </div>
          </>
        )}
      </aside>
    </>
  );
}
