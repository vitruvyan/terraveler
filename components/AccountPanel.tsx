"use client";

import { useEffect, useState } from "react";
import { GoogleMark } from "@/components/AuthBackdrop";

type Me = { signed_in: boolean; email?: string; is_editor?: boolean };

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
          <span className="cart-kicker">Terraveler · Account</span>
          <button type="button" className="win-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!me ? (
          <p style={{ color: "var(--ink-soft)" }}>…</p>
        ) : me.signed_in ? (
          <>
            <p className="acct-mail">
              Signed in as <strong>{me.email}</strong>
              {me.is_editor && <span className="conf-badge" style={{ marginLeft: 8 }}>editor-in-chief</span>}
            </p>
            {me.is_editor && (
              <a className="desk-btn desk-btn-primary acct-cta" href="/desk">
                Open the editorial desk
              </a>
            )}
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
            <a className="acct-google-cta" href="/api/desk/google?next=/login">
              <GoogleMark />
              <span>Sign in with Google</span>
            </a>
            <a className="acct-desk-link" href="/signup">
              New to Terraveler? Create an account
            </a>
            <div className="acct-note">
              <strong>Editorial access is separate.</strong> Contributor tools remain invitation-only while the Ship&rsquo;s Ranks are being built. You can already contribute through your AI with an invite code:{" "}
              <a href="/how-it-works">see how it works</a>.
            </div>
          </>
        )}
      </aside>
    </>
  );
}
