/** Editor-desk auth helpers: Supabase Auth via server-side REST, token in an
 *  httpOnly cookie. Only the allowlisted editor email may pass.
 *
 *  Auth and data live on DIFFERENT backends since the VPS cutover: SB_URL
 *  (api.terraveler.com \u2192 PostgREST) serves the governance tables, while
 *  /auth/v1 endpoints only exist on the Supabase project, which stays the
 *  identity provider (Google OAuth lives there). AUTH_* defaults to the
 *  NEXT_PUBLIC_ vars, which still point at that project. */

const cleanEnv = (v?: string) => (v ?? "").replace(/[\s\u200B-\u200D\uFEFF]+/g, "").replace(/\/+$/, "");
const SB_URL = cleanEnv(process.env.SUPABASE_URL);
const SB_KEY = cleanEnv(process.env.SUPABASE_SERVICE_KEY);
const AUTH_URL = cleanEnv(process.env.SUPABASE_AUTH_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
const AUTH_KEY = cleanEnv(process.env.SUPABASE_AUTH_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
// No fallback: with EDITOR_EMAIL unset, editor checks fail closed.
const EDITOR_EMAIL = (process.env.EDITOR_EMAIL ?? "").trim().toLowerCase();

export const COOKIE = "desk_token";

export function readCookie(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function signIn(email: string, password: string): Promise<{ token?: string; error?: string }> {
  if (!AUTH_URL || !AUTH_KEY || !EDITOR_EMAIL) return { error: "server not configured" };
  const r = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: AUTH_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return { error: "invalid credentials" };
  const j = await r.json();
  const mail = (j?.user?.email ?? "").toLowerCase();
  if (mail !== EDITOR_EMAIL) return { error: "not an editor account" };
  return { token: j.access_token as string };
}

export async function getUserEmail(token: string): Promise<string | null> {
  if (!AUTH_URL || !AUTH_KEY) return null;
  const r = await fetch(`${AUTH_URL}/auth/v1/user`, {
    headers: { apikey: AUTH_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j?.email ?? null) as string | null;
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
