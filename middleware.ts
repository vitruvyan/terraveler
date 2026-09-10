import { NextRequest, NextResponse } from "next/server";
import { LEGACY_ONLY_TOOLS, TOOL_SCOPE } from "@/lib/agentCapabilities";

/**
 * MCP 2026-07-28 compatibility facade.
 *
 * The product handler below /api/mcp is intentionally left on the proven 2025
 * implementation while the wire protocol changes around it. Modern requests
 * are proxied through this facade so we can add 2026 discovery, response
 * identity, a clean tool catalogue and first-class agent identity bootstrap
 * without disturbing Claude/other legacy clients.
 *
 * The old handler's transactional write RPCs authenticate handle+api_key before
 * its OAuth fallback can run. Modern bearer-authenticated writes therefore use
 * /api/agent/write, which calls OAuth-native sibling RPCs.
 */

const MODERN = "2026-07-28";
const LEGACY = "2025-06-18";
const CAPABILITIES_PATH = "/api/agent/capabilities";
const WRITE_PATH = "/api/agent/write";
const MODERN_NATIVE_WRITES = new Set([
  "claim_gap",
  "propose_idea",
  "submit_draft",
  "suggest_feature",
  "suggest_content",
  "submit_review",
]);

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
  "Agents are first-class Terraveler identities: an agent's standing belongs to the agent, not to a human account, model or runtime. " +
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
    "Explain this connection's effective Terraveler authority: persistent agent identity, optional human association, OAuth scopes, allowed and denied capabilities, standing and quota. Publication is never an agent capability.",
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

/** The 2025 get_contract response appends the registration token/API-key lane.
 * Keep that exact text for legacy clients, but never teach a 2026 client to
 * leave OAuth and carry a secret after it has already connected correctly. */
function moderniseContract(payload: any) {
  const items = payload?.result?.content;
  if (!Array.isArray(items)) return payload;
  const marker = "\n\n---\n\n## Registering";
  for (const item of items) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    const at = item.text.indexOf(marker);
    if (at < 0) continue;
    item.text = item.text.slice(0, at) +
      "\n\n---\n\n## Agent identity and authority\n\n" +
      "On modern MCP, do not call register and do not ask a human for an API key. " +
      "Terraveler gives agents persistent identities independent of human accounts and model vendors. " +
      "An interactive human may associate a connection, while an unattended agent may self-enrol; " +
      "either way standing belongs to the agent. The OAuth connection carries scoped authority, not identity ownership. " +
      "Call get_capabilities to inspect the agent id, standing and current connection authority.";
  }
  return payload;
}

function bodyMeta(msg: any): Record<string, any> {
  return msg?.params?._meta ?? {};
}

/** SEP-2243: modern routing headers mirror the JSON-RPC request. */
function modernEnvelopeError(req: NextRequest, msg: any): string | null {
  const method = req.headers.get("mcp-method");
  const version = req.headers.get("mcp-protocol-version");
  const name = req.headers.get("mcp-name");
  if (!method || !version) return "Mcp-Method and MCP-Protocol-Version are required on 2026 requests";
  if (version !== MODERN) return `unsupported modern protocol version '${version}'`;
  if (!msg || Array.isArray(msg) || msg.method !== method)
    return "Mcp-Method does not match the JSON-RPC body";

  const metaVersion = bodyMeta(msg)["io.modelcontextprotocol/protocolVersion"];
  if (metaVersion != null && metaVersion !== version)
    return "MCP-Protocol-Version does not match params._meta protocolVersion";

  const bodyName = msg?.params?.name ?? msg?.params?.uri ?? msg?.params?.taskId;
  if (bodyName != null && !name) return "Mcp-Name is required for this named request";
  if (name != null && bodyName == null) return "Mcp-Name was supplied for a request with no mirrored name";
  if (name != null && String(bodyName) !== name) return "Mcp-Name does not match the JSON-RPC body";
  return null;
}

function authHeaders(req: NextRequest) {
  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  return headers;
}

async function capabilitySnapshot(req: NextRequest) {
  return fetch(new URL(CAPABILITIES_PATH, req.url), {
    method: "GET",
    headers: authHeaders(req),
    cache: "no-store",
  });
}

async function proxyLegacy(req: NextRequest, transform?: (payload: any) => any) {
  const headers = new Headers(req.headers);
  headers.delete("mcp-method");
  headers.delete("mcp-name");
  headers.delete("mcp-protocol-version");
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

  const resultChallenges = payload?.result?._meta?.["mcp/www_authenticate"];
  const challenge = upstream.headers.get("www-authenticate") ??
    (Array.isArray(resultChallenges) && typeof resultChallenges[0] === "string" ? resultChallenges[0] : null);
  const status = challenge && payload?.result?.isError && upstream.status === 200
    ? 401
    : upstream.status;

  const outHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": upstream.headers.get("cache-control") ?? "no-store",
    "MCP-Protocol-Version": MODERN,
  });
  if (challenge) outHeaders.set("WWW-Authenticate", challenge);
  return NextResponse.json(payload, { status, headers: outHeaders });
}

async function modernWrite(req: NextRequest, msg: any, name: string) {
  const upstream = await fetch(new URL(WRITE_PATH, req.url), {
    method: "POST",
    headers: new Headers({
      ...Object.fromEntries(authHeaders(req).entries()),
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ name, arguments: msg?.params?.arguments ?? {} }),
    cache: "no-store",
  });
  const data = await upstream.json().catch(() => ({ text: "ERROR: modern write handler returned invalid JSON", isError: true }));

  if (!upstream.ok) {
    const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store",
      "MCP-Protocol-Version": MODERN });
    const challenge = upstream.headers.get("www-authenticate");
    if (challenge) h.set("WWW-Authenticate", challenge);
    return NextResponse.json(data, { status: upstream.status, headers: h });
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id: msg.id ?? null,
    result: {
      content: [{ type: "text", text: String(data.text ?? "") }],
      isError: Boolean(data.isError),
      _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    },
  }, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
    "MCP-Protocol-Version": MODERN } });
}

export async function middleware(req: NextRequest) {
  if (req.method !== "POST") return NextResponse.next();

  const method = req.headers.get("mcp-method");
  if (!method) return NextResponse.next(); // 2025-era client: unchanged.

  const msg = await req.clone().json().catch(() => null);
  const envelopeError = modernEnvelopeError(req, msg);
  if (envelopeError) return jsonRpcError(msg?.id, -32020, envelopeError);

  if (method === "server/discover") {
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
      return {
        ...payload,
        result: {
          ...(payload.result ?? {}),
          tools: modern,
          ttlMs: 300_000,
          cacheScope: "public",
        },
      };
    });
  }

  if (method === "tools/call") {
    const name = req.headers.get("mcp-name") ?? "";
    if (name === "get_capabilities") {
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

    if (name === "get_contract") return proxyLegacy(req, moderniseContract);

    if (TOOL_SCOPE[name] && req.headers.get("authorization")) {
      const boot = await capabilitySnapshot(req);
      if (!boot.ok) {
        const detail = await boot.text();
        return jsonRpcError(msg?.id, -32001, `Agent identity bootstrap failed: ${detail}`, 403);
      }
      if (MODERN_NATIVE_WRITES.has(name)) return modernWrite(req, msg, name);
    }
    return proxyLegacy(req);
  }

  return proxyLegacy(req);
}

export const config = {
  matcher: ["/api/mcp"],
};
