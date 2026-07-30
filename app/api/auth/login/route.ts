import { NextResponse } from "next/server";
import { setSession, signInAccount } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const { token, refresh, error } = await signInAccount(String(email ?? ""), String(password ?? ""));
  if (!token) return NextResponse.json({ error: error ?? "invalid credentials" }, { status: 401 });

  const res = NextResponse.json({ ok: true, message: "You are signed in to Terraveler." });
  setSession(res, token, refresh);
  return res;
}
