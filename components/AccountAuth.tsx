"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthBackdrop, { GoogleMark } from "@/components/AuthBackdrop";

type Mode = "login" | "signup";

/**
 * Where to go once signed in.
 *
 * The OAuth consent screen sends people here when they are not signed in, and
 * dropping them on the account page afterwards would lose the authorisation
 * request they were in the middle of. Only same-origin paths are honoured — an
 * open `next=` is an open redirect, and this one is reachable without a login.
 */
function safePath(raw: string): string {
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "";
}

function nextPath(): string {
  if (typeof window === "undefined") return "";
  return safePath(new URLSearchParams(window.location.search).get("next") ?? "");
}

/* Where to come back to after the Google round trip.
 *
 * The destination cannot travel with the request: the button leaves for
 * /api/desk/google, which hands Supabase a redirect_to of a bare path, and
 * Google returns to that path with the tokens in the fragment and no query
 * string at all. So `?next=` was silently dropped every time, and signing in
 * with Google from a gated page left you sitting on /login reading "you are
 * signed in" instead of arriving anywhere. Email and password kept working,
 * because that flow never leaves the page — which is why the two methods
 * behaved differently.
 *
 * Putting the destination in redirect_to would need Supabase's allow-list to
 * accept a query string, which is configuration we cannot verify from here.
 * Remembering it in the tab is the version that cannot be broken by a setting
 * on someone else's dashboard. */
const RETURN_KEY = "tv:after-signin";

function rememberDestination() {
  const to = nextPath() || safePath(window.location.pathname + window.location.search);
  try { sessionStorage.setItem(RETURN_KEY, to); } catch { /* private mode */ }
}

function takeDestination(): string {
  const fromQuery = nextPath();
  if (fromQuery) return fromQuery;
  try {
    const stored = sessionStorage.getItem(RETURN_KEY) ?? "";
    sessionStorage.removeItem(RETURN_KEY);
    return safePath(stored);
  } catch { return ""; }
}

export default function AccountAuth({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "complete">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    if (!token) return;

    const controller = new AbortController();
    window.history.replaceState(null, "", window.location.pathname);
    setStatus("submitting");
    fetch("/api/desk/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token, refresh_token: refresh ?? undefined }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        setError((await response.json()).error ?? "Google sign-in could not be completed.");
        setStatus("idle");
        return;
      }
      const to = takeDestination();
      if (to && to !== window.location.pathname) { window.location.href = to; return; }
      setMessage(mode === "signup" ? "Your Terraveler account is ready." : "You are signed in to Terraveler.");
      setStatus("complete");
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Google sign-in could not be completed.");
      setStatus("idle");
    });
    return () => controller.abort();
  }, [mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("submitting");

    const response = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? "We could not complete your request.");
      setStatus("idle");
      return;
    }

    setPassword("");
    const to = nextPath();
    if (to && mode === "login") { window.location.href = to; return; }
    setMessage(body.message ?? (mode === "signup"
      ? "Check your inbox to confirm your email address."
      : "You are signed in to Terraveler."));
    setStatus("complete");
  }

  const isSignup = mode === "signup";
  const title = isSignup ? "Join the atlas" : "Welcome back";
  const description = isSignup
    ? "Create a Terraveler account to keep your place in the atlas as the contributor desk opens."
    : "Sign in to continue your journey through Terraveler.";

  return (
    <AuthBackdrop>
      <section className="auth-panel auth-account-panel" aria-labelledby="account-auth-title">
        <Link href="/" className="wordmark auth-wordmark">Terraveler</Link>
        <span className="auth-kicker">{isSignup ? "Your place in the atlas" : "Terraveler account"}</span>
        <h1 id="account-auth-title">{title}</h1>
        <p className="auth-intro">{description}</p>

        {status === "complete" ? (
          <div className="auth-complete" role="status">
            <strong>{message}</strong>
            <p>{isSignup ? "You can return to the atlas now. Contributor tools will appear here as they become available." : "Your account is active on this device."}</p>
            <Link href="/" className="auth-primary-link">Return to the atlas</Link>
          </div>
        ) : (
          <>
            <a
              href={`/api/desk/google?next=/${mode}`}
              className="auth-google-button"
              onClick={rememberDestination}
            >
              <GoogleMark />
              <span>{isSignup ? "Sign up with Google" : "Continue with Google"}</span>
            </a>
            <div className="auth-divider"><span>or continue with email</span></div>
            <form onSubmit={submit} className="auth-form">
              <label>
                <span>Email address</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
              </label>
              <label>
                <span>Password</span>
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 8 : undefined} />
              </label>
              <button type="submit" className="auth-submit" disabled={status === "submitting"}>
                {status === "submitting" ? "One moment..." : isSignup ? "Create account" : "Sign in"}
              </button>
            </form>
            {error && <p className="auth-error" role="alert">{error}</p>}
          </>
        )}

        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "New to Terraveler?"}{" "}
          <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create an account"}</Link>
        </p>
      </section>
    </AuthBackdrop>
  );
}
