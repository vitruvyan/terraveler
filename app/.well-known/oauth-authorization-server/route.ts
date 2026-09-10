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
 * Interactive MCP clients are public clients, so no client_secret is issued and
 * PKCE is mandatory. Autonomous agents use client_credentials and therefore
 * authenticate at the token endpoint with the one-time client secret minted at
 * registration.
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
      // Kept for 2025-era clients. MCP 2026 clients should prefer CIMD below.
      registration_endpoint: `${SITE}/api/oauth/register`,
      client_id_metadata_document_supported: true,
      revocation_endpoint: `${SITE}/api/oauth/revoke`,
      scopes_supported: ["contribute", "review", "appeal"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      // MCP 2026-07-28 / RFC 9207. Every authorization response carries `iss`
      // and clients validate it before redeeming a code.
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${SITE}/connect`,
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
