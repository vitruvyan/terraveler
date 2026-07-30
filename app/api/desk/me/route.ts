import { NextResponse } from "next/server";
import {
  readCookie,
  readRefreshCookie,
  refreshSession,
  getUserEmail,
  editorEmail,
  setSession,
  clearSession,
} from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shape(email: string) {
  return {
    signed_in: true,
    email,
    is_editor: email.toLowerCase() === editorEmail(),
  };
}

/** Session info for the account panel: signed_in, email, is_editor.
 *
 *  This is also where a session is renewed. An access token lasts an hour and
 *  cannot be extended, so when it stops being accepted we trade the refresh
 *  token for a fresh pair and write them back — a route handler can set
 *  cookies, which is why the renewal lives here rather than in a page. Only a
 *  refresh token that is itself gone counts as a real sign-out. */
export async function GET(req: Request) {
  const token = readCookie(req);
  if (token) {
    const email = await getUserEmail(token);
    if (email) return NextResponse.json(shape(email));
  }

  const refresh = readRefreshCookie(req);
  if (!refresh) return NextResponse.json({ signed_in: false });

  const renewed = await refreshSession(refresh);
  if (!renewed) {
    const out = NextResponse.json({ signed_in: false });
    clearSession(out);
    return out;
  }

  const email = await getUserEmail(renewed.token);
  if (!email) {
    const out = NextResponse.json({ signed_in: false });
    clearSession(out);
    return out;
  }

  const res = NextResponse.json(shape(email));
  setSession(res, renewed.token, renewed.refresh);
  return res;
}
