import { NextResponse } from "next/server";
import { signIn, COOKIE } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "email and password required" }, { status: 400 });
  const { token, error } = await signIn(String(email), String(password));
  if (!token) return NextResponse.json({ error }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600,
  });
  return res;
}
