import { NextResponse } from "next/server";
import { supabaseUrl } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kicks off Google OAuth via Supabase Auth; Google returns the user to /desk.
 *  The return origin is CANONICAL: whatever host the login started from
 *  (vercel.app preview, apex, www), OAuth always lands on the public domain. */
const CANONICAL = "https://www.terraveler.com";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const base = origin.includes("localhost") ? origin : CANONICAL;
  const url =
    `${supabaseUrl()}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(`${base}/desk`)}`;
  return NextResponse.redirect(url, 302);
}
