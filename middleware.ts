import { NextRequest, NextResponse } from "next/server";

/**
 * MCP 2026-07-28 compatibility shim.
 *
 * Terraveler's product MCP handler predates the stateless 2026 era and is
 * deliberately kept intact while clients migrate. Modern clients probe a
 * server with `server/discover` before deciding whether to use the new
 * stateless protocol or fall back to the legacy `initialize` handshake.
 *
 * Intercepting only that probe gives us a safe dual-era deployment:
 *   - 2026 clients discover the modern revision and then call the existing
 *     stateless tools/list and tools/call handlers directly;
 *   - older clients continue to use initialize exactly as before.
 *
 * No session state is introduced here. The existing /api/mcp route is already
 * request/response and stateless, which is the important architectural
 * property the 2026 revision standardises.
 */

const MODERN = "2026-07-28";
const LEGACY = "2025-06-18";

const SERVER_INFO = {
  name: "terraveler",
  title: "Terraveler — an atlas of geo-history",
  version: "0.7.0",
  websiteUrl: "https://www.terraveler.com",
  description:
    "A curated geo-history atlas where agents may read openly and contribute through governed editorial capabilities.",
};

const INSTRUCTIONS =
  "Terraveler is readable without authentication. Use search_atlas, get_voyage and get_place to explore it. " +
  "Writing is capability-gated: contribution, peer review and appeals require OAuth scopes and never grant publication authority. " +
  "Before drafting, read get_contract (the Magna Carta of the Seas). Every factual claim must be sourced; quotations are verbatim or absent.";

function jsonRpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function middleware(req: NextRequest) {
  if (req.method !== "POST") return NextResponse.next();

  const methodHeader = req.headers.get("mcp-method");
  if (methodHeader !== "server/discover") return NextResponse.next();

  const msg = await req.json().catch(() => null);
  if (!msg || Array.isArray(msg) || msg.method !== "server/discover") {
    return jsonRpcError(msg?.id, -32600, "Invalid server/discover request");
  }

  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: msg.id ?? null,
      result: {
        supportedVersions: [MODERN, LEGACY],
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        // Discovery is identical for every user and changes only with the
        // server contract, so clients may safely cache it for an hour.
        ttlMs: 3_600_000,
        cacheScope: "public",
        _meta: {
          "io.modelcontextprotocol/serverInfo": SERVER_INFO,
        },
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "MCP-Protocol-Version": MODERN,
      },
    },
  );
}

export const config = {
  matcher: ["/api/mcp"],
};
