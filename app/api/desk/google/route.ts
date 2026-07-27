import { NextResponse } from "next/server";
import { supabaseUrl } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kicks off Google OAuth via Supabase Auth.
 *  Only known local routes can be used as the OAuth return target. */
const CANONICAL = "https://www.terraveler.com";
const RETURN_PATHS = new Set(["/desk", "/login", "/signup"]);

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const origin = requestUrl.origin;
  const base = origin.includes("localhost") ? origin : CANONICAL;
  const next = requestUrl.searchParams.get("next") ?? "/desk";
  const returnPath = RETURN_PATHS.has(next) ? next : "/desk";
  const url =
    `${supabaseUrl()}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(`${base}${returnPath}`)}`;
  return NextResponse.redirect(url, 302);
}
