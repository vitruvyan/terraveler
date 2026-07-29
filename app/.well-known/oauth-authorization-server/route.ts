import { NextResponse } from "next/server";

/**
 * RFC 8414 — the authorization server's own description.
 *
 * Terraveler issues its own tokens rather than delegating to the identity
 * provider's OAuth server. The provider authenticates the human at the consent
 * step and nothing more, so the token is bound to a Terraveler contributor and
 * a Terraveler scope, and none of this depends on a feature being enabled on
 * somebody else's project.
 *
 * Public clients only, so no client_secret is issued and PKCE is not optional:
 * an MCP client is a desktop app or a browser page and cannot keep a secret.
 * S256 only — `plain` exists in the spec and protects nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-static";

const SITE = "https://www.terraveler.com";

export function GET() {
  return NextResponse.json(
    {
      issuer: SITE,
      authorization_endpoint: `${SITE}/oauth/authorize`,
      token_endpoint: `${SITE}/api/oauth/token`,
      registration_endpoint: `${SITE}/api/oauth/register`,
      revocation_endpoint: `${SITE}/api/oauth/revoke`,
      scopes_supported: ["contribute", "review", "appeal"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      service_documentation: `${SITE}/connect`,
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
