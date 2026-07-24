import { NextResponse } from "next/server";
import { getUserEmail, COOKIE } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** After OAuth, the page posts the access token here; we verify it against
 *  Supabase Auth and move the session into an httpOnly cookie. Any valid
 *  Google account may hold a session (needed for web contributions); the
 *  desk's admin endpoints separately enforce the editor allowlist. */
export async function POST(req: Request) {
  const { access_token } = await req.json().catch(() => ({}));
  if (!access_token) return NextResponse.json({ error: "access_token required" }, { status: 400 });
  const email = await getUserEmail(String(access_token));
  if (!email) return NextResponse.json({ error: "invalid or expired token" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, String(access_token), {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 3600,
  });
  return res;
}
