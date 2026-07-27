"use client";

import { useEffect, useState } from "react";

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
            <a className="acct-google-cta" href="/api/desk/google">
              <svg className="acct-google-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285f4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34a853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#fbbc05"
                  d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
                />
                <path
                  fill="#ea4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
                />
              </svg>
              <span>Continue with Google</span>
            </a>
            <a className="acct-desk-link" href="/desk">
              Already aboard? Open the editorial desk
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
    </>
  );
}
