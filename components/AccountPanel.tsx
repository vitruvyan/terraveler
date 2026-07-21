"use client";

import { useEffect, useState } from "react";

type Me = { signed_in: boolean; email?: string; is_editor?: boolean };

/** Slide-over account panel, shared across every page. */
export default function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/desk/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ signed_in: false }));
  }, [open]);

  if (!open) return null;

  return (
    <div className="acct-overlay" onClick={onClose}>
      <aside className="acct-panel" onClick={(e) => e.stopPropagation()}>
        <div className="acct-head">
          <span className="cart-kicker">Terraveler · Account</span>
          <button className="win-btn" onClick={onClose} aria-label="Close">×</button>
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
              className="desk-btn acct-cta"
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
            <a className="desk-btn desk-btn-primary acct-cta" href="/api/desk/google">
              Sign in with Google
            </a>
            <div className="acct-note">
              <strong>Want to register?</strong> Contributor accounts are on the way —
              Terraveler is invitation-only while the Ship&rsquo;s Ranks are being built.
              You can already contribute through your AI with an invite code:{" "}
              <a href="/how-it-works">see how it works</a>.
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
