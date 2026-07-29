import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sb } from "@/lib/deskAuth";

/**
 * RFC 7591 — a client registering itself, with nobody provisioning anything.
 *
 * This is the endpoint that removes the human from the credential path. The
 * MCP client arrives knowing only the server URL, registers, and from then on
 * holds its own identity. Nothing is handed to a person to carry.
 *
 * Open registration is the point and also the exposure, so: public clients
 * only, no secret issued, exact redirect URIs, and a per-hour ceiling. A
 * registration is cheap to make and cheap to ignore — what it grants is the
 * ability to *ask* a human for consent, and the human is the gate.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_HOUR = 60;

function badRequest(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("invalid_client_metadata", "body must be JSON");

  const uris: unknown = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length)
    return badRequest("invalid_redirect_uri", "redirect_uris is required and must be a non-empty array");

  const clean: string[] = [];
  for (const u of uris) {
    let parsed: URL;
    try {
      parsed = new URL(String(u));
    } catch {
      return badRequest("invalid_redirect_uri", `not a URL: ${String(u).slice(0, 120)}`);
    }
    // https, or a loopback/custom scheme, which is what a desktop client uses.
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !loopback && !parsed.protocol.includes("."))
      return badRequest("invalid_redirect_uri",
        `${parsed.protocol}//… is neither https nor a loopback nor an app scheme`);
    if (parsed.hash)
      return badRequest("invalid_redirect_uri", "a redirect URI may not carry a fragment");
    clean.push(parsed.toString());
  }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await sb("GET", `oauth_clients?created_at=gte.${since}&select=id`);
  if ((recent?.length ?? 0) >= PER_HOUR)
    return NextResponse.json(
      { error: "temporarily_unavailable",
        error_description: "client registrations are capped for this hour — a flood guard, " +
          "not a closed door. Try again shortly, or write to the editorial desk." },
      { status: 429 },
    );

  const client_id = `tv_${randomBytes(16).toString("hex")}`;
  await sb("POST", "oauth_clients", {
    client_id,
    client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null,
    redirect_uris: clean,
    registered_via: "dcr",
  });

  return NextResponse.json(
    {
      client_id,
      client_name: body.client_name ?? undefined,
      redirect_uris: clean,
      // No secret, and no expiry on the registration itself. A public client
      // cannot keep a secret, so PKCE is the proof of possession and issuing a
      // "confidential" credential to a desktop app would be theatre.
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
