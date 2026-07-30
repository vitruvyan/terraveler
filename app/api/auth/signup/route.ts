import { NextResponse } from "next/server";
import { setSession, signUpAccount } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const { token, refresh, error } = await signUpAccount(String(email ?? ""), String(password ?? ""));
  if (error) return NextResponse.json({ error }, { status: 400 });

  const message = token
    ? "Your Terraveler account is ready."
    : "Check your inbox to confirm your email address.";
  const res = NextResponse.json({ ok: true, message });
  if (token) setSession(res, token, refresh);
  return res;
}
