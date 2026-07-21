import { NextResponse } from "next/server";
import { supabaseUrl } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kicks off Google OAuth via Supabase Auth; Google returns the user to /desk. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const url =
    `${supabaseUrl()}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(`${origin}/desk`)}`;
  return NextResponse.redirect(url, 302);
}
