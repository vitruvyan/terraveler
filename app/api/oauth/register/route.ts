import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sb } from "@/lib/deskAuth";
import { sha256 } from "@/lib/oauth";
import { CARTA_VERSION } from "@/lib/carta";

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

const PER_SOURCE_PER_HOUR = 10;
const GLOBAL_PER_HOUR = 2000;

function badRequest(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("invalid_client_metadata", "body must be JSON");

  // An unattended agent has nowhere to be redirected to, so it registers
  // without one. Only the interactive flow needs an address to come back to.
  const wantsCC = Array.isArray(body.grant_types)
    && body.grant_types.map(String).includes("client_credentials");
  const uris: unknown = body.redirect_uris ?? (wantsCC ? [] : undefined);
  if (!Array.isArray(uris) || (!uris.length && !wantsCC))
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

  // Per source first, and a far higher global ceiling behind it.
  //
  // One number for the whole system is a denial of service with sixty
  // requests: an anonymous caller spends the hour's budget and every genuine
  // person who tries to connect that hour is turned away. Throttling the
  // source that is flooding leaves everyone else unaffected, and the global
  // number stops being a door anyone can close.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const source = sha256(
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown",
  ).slice(0, 32);
  const [mine, all] = await Promise.all([
    sb("GET", `oauth_clients?created_at=gte.${since}&source_hash=eq.${source}&select=id`),
    sb("GET", `oauth_clients?created_at=gte.${since}&select=id`),
  ]);
  if ((mine?.length ?? 0) >= PER_SOURCE_PER_HOUR)
    return NextResponse.json(
      { error: "temporarily_unavailable",
        error_description: `you have registered ${mine.length} clients this hour, which is ` +
          `the limit for one source. Nobody else is affected by this.` },
      { status: 429 },
    );
  if ((all?.length ?? 0) >= GLOBAL_PER_HOUR)
    return NextResponse.json(
      { error: "temporarily_unavailable",
        error_description: "registrations are paused site-wide for this hour — an emergency " +
          "ceiling, not a normal one. Write to the editorial desk if you meet it." },
      { status: 429 },
    );

  // An agent that runs unattended asks for client_credentials and gets a
  // secret; an interactive connector asks for authorization_code and gets
  // none, because a public client cannot keep one. Both are standard, and the
  // difference is whether a person is present, not how much we trust them.
  const grants: string[] = Array.isArray(body.grant_types)
    ? body.grant_types.map(String)
    : ["authorization_code", "refresh_token"];
  const autonomous = grants.includes("client_credentials");

  const client_id = `tv_${randomBytes(16).toString("hex")}`;
  const client_secret = autonomous ? randomBytes(32).toString("base64url") : null;
  await sb("POST", "oauth_clients", {
    client_id,
    client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null,
    redirect_uris: clean,
    registered_via: autonomous ? "client_credentials" : "dcr",
    source_hash: source,
    client_secret_hash: client_secret ? sha256(client_secret) : null,
    operator: typeof body.operator === "string" ? body.operator.slice(0, 200) : null,
    carta_version: CARTA_VERSION,
  });

  return NextResponse.json(
    {
      client_id,
      client_name: body.client_name ?? undefined,
      redirect_uris: clean,
      // No secret, and no expiry on the registration itself. A public client
      // cannot keep a secret, so PKCE is the proof of possession and issuing a
      // "confidential" credential to a desktop app would be theatre.
      ...(client_secret
        ? {
            client_secret,
            token_endpoint_auth_method: "client_secret_post",
            grant_types: ["client_credentials"],
            note:
              "Store this secret in your own configuration — it is shown once and kept " +
              "here only as a hash. Exchange it at the token endpoint for a short-lived " +
              "access token whenever you need one. No person is involved at any point, " +
              "which is the point: you registered, you agreed to the Carta by doing so, " +
              "and everything you submit is judged on its merits rather than on who sent it.",
          }
        : {
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          }),
      carta_version: CARTA_VERSION,
      carta: "https://www.terraveler.com/magna-carta — read it; it is the only entry requirement",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
