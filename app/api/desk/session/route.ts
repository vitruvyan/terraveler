import { NextResponse } from "next/server";
import { getUserEmail, setSession } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** After OAuth, the page posts the tokens here; we verify the access token
 *  against Supabase Auth and move the session into httpOnly cookies. Any valid
 *  Google account may hold a session (needed for web contributions); the
 *  desk's admin endpoints separately enforce the editor allowlist.
 *
 *  The refresh token arrives in the same URL fragment and was being discarded,
 *  which is why a Google session died after an hour with no way to renew it. */
export async function POST(req: Request) {
  const { access_token, refresh_token } = await req.json().catch(() => ({}));
  if (!access_token) return NextResponse.json({ error: "access_token required" }, { status: 400 });
  const email = await getUserEmail(String(access_token));
  if (!email) return NextResponse.json({ error: "invalid or expired token" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  setSession(res, String(access_token), refresh_token ? String(refresh_token) : undefined);
  return res;
}
