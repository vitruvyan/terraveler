/** Editor-desk auth helpers: Supabase Auth via server-side REST, token in an
 *  httpOnly cookie. Only the allowlisted editor email may pass.
 *
 *  Auth and data live on DIFFERENT backends since the VPS cutover: SB_URL
 *  (api.terraveler.com \u2192 PostgREST) serves the governance tables, while
 *  /auth/v1 endpoints only exist on the Supabase project, which stays the
 *  identity provider (Google OAuth lives there). AUTH_* defaults to the
 *  NEXT_PUBLIC_ vars, which still point at that project. */

import type { NextResponse } from "next/server";

const cleanEnv = (v?: string) => (v ?? "").replace(/[\s\u200B-\u200D\uFEFF]+/g, "").replace(/\/+$/, "");
const SB_URL = cleanEnv(process.env.SUPABASE_URL);
const SB_KEY = cleanEnv(process.env.SUPABASE_SERVICE_KEY);
const AUTH_URL = cleanEnv(process.env.SUPABASE_AUTH_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
const AUTH_KEY = cleanEnv(process.env.SUPABASE_AUTH_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
// No fallback: with EDITOR_EMAIL unset, editor checks fail closed.
const EDITOR_EMAIL = (process.env.EDITOR_EMAIL ?? "").trim().toLowerCase();

export const COOKIE = "desk_token";
/** Supabase access tokens live about an hour and cannot be extended. Storing
 *  only the access token meant a session simply ended after sixty minutes,
 *  with no warning and no way to renew — in the middle of authorising an
 *  assistant, for instance. The refresh token is what makes a session last. */
export const COOKIE_REFRESH = "desk_refresh";

function readNamed(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function readCookie(req: Request): string | null {
  return readNamed(req, COOKIE);
}

export function readRefreshCookie(req: Request): string | null {
  return readNamed(req, COOKIE_REFRESH);
}

/** One place for the cookie flags. They were repeated in four route handlers,
 *  which is how the two of them drifted out of step in the first place. */
export function setSession(res: NextResponse, token: string, refresh?: string) {
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  res.cookies.set({ ...common, name: COOKIE, value: token, maxAge: 3600 });
  if (refresh) {
    res.cookies.set({ ...common, name: COOKIE_REFRESH, value: refresh, maxAge: 60 * 60 * 24 * 30 });
  }
}

export function clearSession(res: NextResponse) {
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    value: "",
    maxAge: 0,
  };
  res.cookies.set({ ...common, name: COOKIE });
  res.cookies.set({ ...common, name: COOKIE_REFRESH });
}

/** Trades a refresh token for a fresh pair. Returns nothing if the refresh
 *  token has itself expired or been revoked, which is a real sign-out. */
export async function refreshSession(
  refresh: string,
): Promise<{ token: string; refresh: string } | null> {
  if (!authConfigured() || !refresh) return null;
  const r = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: AUTH_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j?.access_token) return null;
  return { token: j.access_token as string, refresh: (j.refresh_token ?? refresh) as string };
}

type AuthResult = { token?: string; refresh?: string; error?: string };

function authConfigured(): boolean {
  return Boolean(AUTH_URL && AUTH_KEY);
}

function authError(status: number, body: any, fallback: string): string {
  if (status === 400 && typeof body?.msg === "string") return body.msg;
  if (typeof body?.error_description === "string") return body.error_description;
  if (typeof body?.message === "string") return body.message;
  return fallback;
}

/** Regular Terraveler account login. Desk access is checked separately. */
export async function signInAccount(email: string, password: string): Promise<AuthResult> {
  if (!authConfigured()) return { error: "server not configured" };
  if (!email || !password) return { error: "email and password required" };
  const r = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: AUTH_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: authError(r.status, j, "invalid credentials") };
  return { token: j.access_token as string, refresh: j.refresh_token as string | undefined };
}

/** Creates a regular account with the configured Supabase Auth provider. */
export async function signUpAccount(email: string, password: string): Promise<AuthResult> {
  if (!authConfigured()) return { error: "server not configured" };
  if (!email || !password) return { error: "email and password required" };
  const r = await fetch(`${AUTH_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: AUTH_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: authError(r.status, j, "could not create account") };
  return { token: j.access_token as string | undefined, refresh: j.refresh_token as string | undefined };
}

/* signIn() is gone with /api/desk/login. It signed someone in and then refused
   them if they were not the editor, which put a role check on the front door
   of a second sign-in page. The desk is protected where it should be: every
   /api/desk/* route calls requireEditor, and the desk page asks
   /api/desk/me whose it is. One door in, the role checked at the room. */

export async function getUserEmail(token: string): Promise<string | null> {
  if (!AUTH_URL || !AUTH_KEY) return null;
  const r = await fetch(`${AUTH_URL}/auth/v1/user`, {
    headers: { apikey: AUTH_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j?.email ?? null) as string | null;
}

/**
 * The signed-in account, whoever it is.
 *
 * getUserEmail() answers "which address" and verifyToken() answers "is this the
 * editor". Neither answers "which account", which is what OAuth consent needs:
 * the subject claim is the stable identifier a contributor's standing hangs
 * from, and an email address is neither stable nor unique enough to be one.
 */
export async function getUser(token: string): Promise<{ sub: string; email: string | null } | null> {
  if (!AUTH_URL || !AUTH_KEY || !token) return null;
  const r = await fetch(`${AUTH_URL}/auth/v1/user`, {
    headers: { apikey: AUTH_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j?.id) return null;
  return { sub: String(j.id), email: (j.email ?? null) as string | null };
}

export function editorEmail(): string {
  return EDITOR_EMAIL;
}

export async function verifyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  if (!AUTH_URL || !AUTH_KEY || !EDITOR_EMAIL) return { ok: false, error: "server not configured" };
  const r = await fetch(`${AUTH_URL}/auth/v1/user`, {
    headers: { apikey: AUTH_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { ok: false, error: "session expired — sign in again" };
  const j = await r.json();
  if ((j?.email ?? "").toLowerCase() !== EDITOR_EMAIL) return { ok: false, error: "not an editor account" };
  return { ok: true };
}

export async function requireEditor(req: Request): Promise<{ ok: boolean; error?: string }> {
  const token = readCookie(req);
  if (!token) return { ok: false, error: "not signed in" };
  return verifyToken(token);
}

/** Base URL of the IDENTITY provider (Supabase Auth), not the data backend. */
export function supabaseUrl(): string {
  return AUTH_URL;
}

/** A stored procedure, for the writes that must be one statement. */
export async function rpc(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${name}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export async function sb(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "" : "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`backend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
