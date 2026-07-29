import { NextResponse } from "next/server";

/**
 * RFC 9728 — what this resource is and who issues tokens for it.
 *
 * The first thing an MCP client fetches when a write is refused. Everything
 * else in the flow is discovered from here, which is the whole point: a person
 * pastes one URL and the client works the rest out, instead of a human
 * carrying a secret into a model's environment and trying to stay in sync with
 * its rotations.
 *
 * `resource` must be the exact origin the client derived the MCP URL from.
 * A client compares the two and refuses a mismatch, which is what stops a
 * server pointing clients at somebody else's authorization server.
 */
export const runtime = "nodejs";
export const dynamic = "force-static";

const SITE = "https://www.terraveler.com";

export function GET() {
  return NextResponse.json(
    {
      resource: `${SITE}/api/mcp`,
      authorization_servers: [SITE],
      scopes_supported: ["contribute", "review", "appeal"],
      bearer_methods_supported: ["header"],
      resource_documentation: `${SITE}/connect`,
      resource_name: "Terraveler — an atlas of geo-history",
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
