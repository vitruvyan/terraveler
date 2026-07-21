import { NextResponse } from "next/server";
import { verifyToken, COOKIE } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** After OAuth, the desk page posts the access token here; we verify the
 *  editor allowlist server-side and move the session into an httpOnly cookie. */
export async function POST(req: Request) {
  const { access_token } = await req.json().catch(() => ({}));
  if (!access_token) return NextResponse.json({ error: "access_token required" }, { status: 400 });
  const v = await verifyToken(String(access_token));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, String(access_token), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600,
  });
  return res;
}
