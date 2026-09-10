import { NextRequest, NextResponse } from "next/server";
import { LEGACY_ONLY_TOOLS, TOOL_SCOPE } from "@/lib/agentCapabilities";

/**
 * MCP 2026-07-28 compatibility facade.
 *
 * The product handler below /api/mcp is intentionally left on the proven 2025
 * implementation while the wire protocol changes around it. Modern requests
 * are proxied through this facade so we can add 2026 discovery, response
 * identity, a clean tool catalogue and lazy contributor bootstrap without
 * disturbing Claude/other legacy clients.
 */

const MODERN = "2026-07-28";
const LEGACY = "2025-06-18";
const CAPABILITIES_PATH = "/api/agent/capabilities";

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
  "Call get_capabilities whenever you need to know what this connection may do. " +
  "Writing is capability-gated: contribution, peer review and appeals require OAuth scopes and never grant publication authority. " +
  "Before drafting, read get_contract (the Magna Carta of the Seas). Every factual claim must be sourced; quotations are verbatim or absent.";

const CAPABILITY_TOOL = {
  name: "get_capabilities",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  securitySchemes: [{ type: "noauth" }],
  _meta: { securitySchemes: [{ type: "noauth" }] },
  description:
    "Explain this connection's effective Terraveler authority: anonymous/human-backed/autonomous mode, OAuth scopes, allowed and denied capabilities, standing and quota. Publication is never an agent capability.",
  inputSchema: { type: "object", properties: {} },
};

function jsonRpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", "MCP-Protocol-Version": MODERN } },
  );
}

function cleanModernTool(tool: any) {
  if (!tool?.inputSchema?.properties) return tool;
  const properties = { ...tool.inputSchema.properties };
  delete properties.handle;
  delete properties.api_key;
  return { ...tool, inputSchema: { ...tool.inputSchema, properties } };
}

async function capabilitySnapshot(req: NextRequest) {
  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  return fetch(new URL(CAPABILITIES_PATH, req.url), {
    method: "GET",
    headers,
    cache: "no-store",
  });
}

/** Call the legacy stateless handler without the 2026 routing headers, then
 * stamp the result with the server identity required by the modern era. */
async function proxyLegacy(req: NextRequest, transform?: (payload: any) => any) {
  const headers = new Headers(req.headers);
  headers.delete("mcp-method");
  headers.delete("mcp-name");
  headers.delete("content-length");
  const body = await req.text();
  const upstream = await fetch(req.url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });
  const raw = await upstream.text();
  let payload: any;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { return new NextResponse(raw, { status: upstream.status }); }

  payload = transform ? transform(payload) : payload;
  if (payload?.result && typeof payload.result === "object") {
    payload.result._meta = {
      ...(payload.result._meta ?? {}),
      "io.modelcontextprotocol/serverInfo": SERVER_INFO,
    };
  }

  const outHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": upstream.headers.get("cache-control") ?? "no-store",
    "MCP-Protocol-Version": MODERN,
  });
  const challenge = upstream.headers.get("www-authenticate");
  if (challenge) outHeaders.set("WWW-Authenticate", challenge);
  return NextResponse.json(payload, { status: upstream.status, headers: outHeaders });
}

export async function middleware(req: NextRequest) {
  if (req.method !== "POST") return NextResponse.next();

  const method = req.headers.get("mcp-method");
  if (!method) return NextResponse.next(); // 2025-era client: unchanged.

  if (method === "server/discover") {
    const msg = await req.json().catch(() => null);
    if (!msg || Array.isArray(msg) || msg.method !== "server/discover")
      return jsonRpcError(msg?.id, -32600, "Invalid server/discover request");

    return NextResponse.json({
      jsonrpc: "2.0",
      id: msg.id ?? null,
      result: {
        supportedVersions: [MODERN, LEGACY],
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ttlMs: 3_600_000,
        cacheScope: "public",
        _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
      },
    }, { headers: {
      "Cache-Control": "public, max-age=3600",
      "MCP-Protocol-Version": MODERN,
    } });
  }

  if (method === "tools/list") {
    return proxyLegacy(req, (payload) => {
      const tools = Array.isArray(payload?.result?.tools) ? payload.result.tools : [];
      const modern = tools
        .filter((t: any) => !LEGACY_ONLY_TOOLS.has(String(t?.name)))
        .map(cleanModernTool);
      if (!modern.some((t: any) => t?.name === CAPABILITY_TOOL.name)) modern.unshift(CAPABILITY_TOOL);
      return { ...payload, result: { ...(payload.result ?? {}), tools: modern } };
    });
  }

  if (method === "tools/call") {
    const name = req.headers.get("mcp-name") ?? "";
    if (name === "get_capabilities") {
      const msg = await req.json().catch(() => null);
      if (!msg || Array.isArray(msg)) return jsonRpcError(msg?.id, -32600, "Invalid tools/call request");
      const snapshot = await capabilitySnapshot(req);
      const data = await snapshot.json().catch(() => ({ error: "capability lookup failed" }));
      return NextResponse.json({
        jsonrpc: "2.0",
        id: msg.id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
          isError: !snapshot.ok,
          _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
        },
      }, { status: 200, headers: { "Cache-Control": "no-store", "MCP-Protocol-Version": MODERN } });
    }

    // The first authenticated write no longer needs a separate `register` tool.
    // The bearer connection is enough to materialise/reuse its contributor.
    if (TOOL_SCOPE[name] && req.headers.get("authorization")) {
      const boot = await capabilitySnapshot(req);
      if (!boot.ok) {
        const detail = await boot.text();
        return jsonRpcError(null, -32001, `Agent identity bootstrap failed: ${detail}`, 403);
      }
    }
    return proxyLegacy(req);
  }

  // Ping and future request/response methods still go through the proven handler,
  // but receive the 2026 server identity stamp on their response.
  return proxyLegacy(req);
}

export const config = {
  matcher: ["/api/mcp"],
};
