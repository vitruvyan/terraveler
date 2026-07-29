import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";
import { sha256 } from "@/lib/oauth";

/**
 * RFC 7009 — a client handing back a token it no longer wants.
 *
 * Always answers 200, even for a token that never existed. That is the RFC's
 * instruction and it is also right: a revocation endpoint that distinguishes
 * "revoked" from "unknown" is an oracle for testing whether a stolen token is
 * live.
 *
 * Revoking a refresh token takes the whole connection with it. A client that
 * is disconnecting means the person is done with that agent, and leaving its
 * access tokens alive for the rest of the hour is a promise half kept.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  const body = ct.includes("json")
    ? await req.json().catch(() => ({}))
    : Object.fromEntries([...((await req.formData().catch(() => new FormData())) as any)]);
  const token = String(body?.token ?? "");
  if (!token) return NextResponse.json({}, { status: 200 });

  const rows = await sb("GET",
    `oauth_tokens?token_hash=eq.${sha256(token)}&select=id,kind,connection_id`);
  const tok = rows?.[0];
  if (tok) {
    const now = new Date().toISOString();
    if (tok.kind === "refresh")
      await sb("PATCH",
        `oauth_tokens?connection_id=eq.${tok.connection_id}&revoked_at=is.null`,
        { revoked_at: now });
    else
      await sb("PATCH", `oauth_tokens?id=eq.${tok.id}`, { revoked_at: now });
  }
  return NextResponse.json({}, { status: 200 });
}
