#!/usr/bin/env node

import { createHash } from "node:crypto";

const endpoint = process.env.MCP_PROBE_URL || "https://www.terraveler.com/api/mcp";
const startedAt = new Date().toISOString();
let requestId = 0;
let protocolVersion = null;
const operations = [];

const digest = (value) => createHash("sha256").update(value).digest("hex");

async function post(payload, label) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); }
    catch { throw new Error(`${label}: response was not JSON (HTTP ${response.status})`); }
  }
  operations.push({ label, http_status: response.status, elapsed_ms: elapsedMs, sha256: digest(raw) });
  return { response, body };
}

async function rpc(method, params, label = method) {
  const id = ++requestId;
  const { response, body } = await post({ jsonrpc: "2.0", id, method, params }, label);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  if (body?.error) throw new Error(`${label}: ${body.error.message || JSON.stringify(body.error)}`);
  if (body?.id !== id) throw new Error(`${label}: response id did not match request id`);
  return body?.result;
}

function structured(result, label) {
  if (result?.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  throw new Error(`${label}: structuredContent is missing`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "terraveler-read-only-probe", version: "1.0.0" },
  });
  assert(initialized?.protocolVersion === "2025-06-18", "initialize: protocol negotiation failed");
  protocolVersion = initialized.protocolVersion;

  const notification = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, "initialized");
  assert(notification.response.status === 202, "initialized: expected HTTP 202");

  const listed = await rpc("tools/list");
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of ["search_atlas", "get_voyage", "get_place", "get_context_events"])
    assert(byName.get(name)?.outputSchema, `tools/list: ${name} has no outputSchema`);

  const searchResult = await rpc("tools/call", {
    name: "search_atlas", arguments: { query: "columbus", limit: 12 },
  }, "search_atlas");
  const search = structured(searchResult, "search_atlas");
  assert(Array.isArray(search.results), "search_atlas: results is not an array");
  const voyageHit = search.results.find((item) => item?.type === "voyage" && item?.voyage);
  assert(voyageHit, "search_atlas: no voyage result with a canonical slug");

  // The slug is discovered from search, never copied into the probe. This is
  // the relation external reports previously broke by inventing a plausible
  // but nonexistent identifier.
  const slug = voyageHit.voyage;
  const voyageResult = await rpc("tools/call", {
    name: "get_voyage", arguments: { slug },
  }, "get_voyage");
  const voyage = structured(voyageResult, "get_voyage");
  assert(voyage.slug === slug, "get_voyage: returned slug differs from search result");
  assert(Array.isArray(voyage.stages), "get_voyage: stages is not an array");

  const contextResult = await rpc("tools/call", {
    name: "get_context_events", arguments: { slug, limit: 10 },
  }, "get_context_events");
  const context = structured(contextResult, "get_context_events");
  assert(context.slug === slug, "get_context_events: returned slug differs from search result");
  assert(Number.isInteger(context.found), "get_context_events: found is not an integer");
  if (context.events) assert(context.events.length === context.found, "get_context_events: count mismatch");

  const invalidResult = await rpc("tools/call", {
    name: "get_voyage", arguments: { slug: `${slug}-does-not-exist` },
  }, "invalid_slug");
  assert(invalidResult?.isError === true, "invalid_slug: nonexistent voyage was accepted");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    endpoint,
    started_at: startedAt,
    protocol_version: initialized.protocolVersion,
    server: initialized.serverInfo,
    advertised_tools: tools.length,
    discovered_slug: slug,
    voyage_stages: voyage.stages.length,
    context_events: context.found,
    operations,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, endpoint, started_at: startedAt,
    error: String(error?.message || error), operations }, null, 2)}\n`);
  process.exitCode = 1;
});
