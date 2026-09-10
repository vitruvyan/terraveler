import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isPublicIp, validateCimdClientId } from "../lib/cimd";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("CIMD client ids are stable HTTPS document URLs", () => {
  assert.ok(validateCimdClientId("https://agent.example/oauth/client.json"));
  for (const bad of [
    "http://agent.example/oauth/client.json",
    "https://agent.example/",
    "https://user:pass@agent.example/oauth/client.json",
    "https://agent.example/oauth/client.json#fragment",
    "https://agent.example/oauth/client.json?version=1",
    "https://agent.example/oauth/../admin",
    "https://agent.example/oauth/%2e%2e/admin",
  ]) assert.equal(validateCimdClientId(bad), null, bad);
});

test("CIMD SSRF policy rejects local, private, metadata and documentation ranges", () => {
  for (const ip of [
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1",
    "::1", "fc00::1", "fe80::1", "2001:db8::1",
  ]) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicIp(ip), true, ip);
});

test("CIMD fetch is pinned and bounded rather than a generic server-side fetch", async () => {
  const cimd = await read("../lib/cimd.ts");
  assert.match(cimd, /lookup\(url\.hostname, \{ all: true, verbatim: true \}\)/);
  assert.match(cimd, /records\.some\(\(r\) => !isPublicIp\(r\.address\)\)/);
  assert.match(cimd, /lookup: .*pinned\.address/s);
  assert.match(cimd, /CIMD redirects are not followed/);
  assert.match(cimd, /MAX_BYTES = 64 \* 1024/);
  assert.match(cimd, /TIMEOUT_MS = 3000/);
});

test("authorization metadata prefers CIMD while DCR remains as fallback", async () => {
  const metadata = await read("../app/.well-known/oauth-authorization-server/route.ts");
  assert.match(metadata, /client_id_metadata_document_supported:\s*true/);
  assert.match(metadata, /registration_endpoint:/,
    "DCR remains during the deprecation window for older MCP hosts");

  const page = await read("../app/oauth/authorize/page.tsx");
  const approve = await read("../app/api/oauth/approve/route.ts");
  assert.match(page, /resolveOAuthClient\(client_id\)/);
  assert.match(approve, /resolveOAuthClient\(String\(client_id\)\)/);
});
