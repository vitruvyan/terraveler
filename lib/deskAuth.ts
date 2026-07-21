/** Editor-desk auth helpers: Supabase Auth via server-side REST, token in an
 *  httpOnly cookie. Only the allowlisted editor email may pass. */

const SB_URL = process.env.SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const EDITOR_EMAIL = (process.env.EDITOR_EMAIL ?? "dbaldoni@gmail.com").toLowerCase();

export const COOKIE = "desk_token";

export function readCookie(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function signIn(email: string, password: string): Promise<{ token?: string; error?: string }> {
  if (!SB_URL || !SB_KEY) return { error: "server not configured" };
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return { error: "invalid credentials" };
  const j = await r.json();
  const mail = (j?.user?.email ?? "").toLowerCase();
  if (mail !== EDITOR_EMAIL) return { error: "not an editor account" };
  return { token: j.access_token as string };
}

export async function getUserEmail(token: string): Promise<string | null> {
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j?.email ?? null) as string | null;
}

export function editorEmail(): string {
  return EDITOR_EMAIL;
}

export async function verifyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
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

export function supabaseUrl(): string {
  return SB_URL;
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
