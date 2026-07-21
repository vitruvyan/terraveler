import { NextResponse } from "next/server";
import { readCookie, getUserEmail, editorEmail } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session info for the account panel: signed_in, email, is_editor. */
export async function GET(req: Request) {
  const token = readCookie(req);
  if (!token) return NextResponse.json({ signed_in: false });
  const email = await getUserEmail(token);
  if (!email) return NextResponse.json({ signed_in: false });
  return NextResponse.json({
    signed_in: true,
    email,
    is_editor: email.toLowerCase() === editorEmail(),
  });
}
