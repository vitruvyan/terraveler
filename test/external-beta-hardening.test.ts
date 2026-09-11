import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isPublicIp } from "../lib/cimd";
import { domainOk } from "../lib/gate";
import { readLimitedJson } from "../lib/externalBetaSecurity";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("CIMD rejects private, link-local and IPv4-mapped loopback addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fe80::1", "::ffff:7f00:1"])
    assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("1.1.1.1"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

test("agent citation URLs require an allowed scheme, host and safe port", () => {
  assert.equal(domainOk("https://www.gutenberg.org/ebooks/1"), true);
  assert.equal(domainOk("javascript:alert(1)"), false);
  assert.equal(domainOk("https://user:pass@gutenberg.org/book"), false);
  assert.equal(domainOk("https://gutenberg.org:8443/book"), false);
  assert.equal(domainOk("https://gutenberg.org.evil.example/book"), false);
});

test("body limit checks actual bytes even without Content-Length", async () => {
  const tooLarge = new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ value: "é".repeat(20) }),
    headers: { "content-type": "application/json" },
  });
  const result = await readLimitedJson(tooLarge, 32);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test("modern and legacy mutations share database-backed beta controls", async () => {
  const [writer, legacy, security, migration] = await Promise.all([
    read("../app/api/agent/write/route.ts"), read("../app/api/mcp/route.ts"),
    read("../lib/externalBetaSecurity.ts"), read("../supabase/mcp_external_beta_hardening.sql"),
  ]);
  assert.match(writer, /MCP_EXTERNAL_BETA_REQUIRE_DB_GUARDS/);
  assert.match(writer, /beginIdempotent/);
  assert.match(writer, /acquireMutationLease/);
  assert.match(writer, /securityAudit/);
  assert.match(legacy, /LEGACY_MUTATIONS/);
  assert.match(legacy, /mutationsEnabled/);
  assert.match(security, /mcp_security_consume_limit/);
  assert.match(migration, /primary key \(agent_account_id, action, key_hash\)/);
  assert.match(migration, /agent_connections_autonomous_client_key/);
  assert.match(migration, /revoke all on mcp_security_rate_limits/);
});

test("client credential issuance serializes identity and connection repair", async () => {
  const token = await read("../app/api/oauth/token/route.ts");
  assert.match(token, /acquireMutationLease\(0, `oauth-token:/);
  assert.match(token, /enrollment: "legacy-import"/);
  assert.match(token, /releaseMutationLease/);
});

test("standing quota admission is serialized per durable contributor", async () => {
  const sql = await read("../supabase/mcp_oauth_write_functions.sql");
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp-author:' \|\| a\.id/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp-claim:' \|\| a\.id/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp-review:' \|\| a\.id/);
});

test("sensitive routes advertise no-store and the kill switch preserves public reads", async () => {
  const [writer, token, capabilities, env] = await Promise.all([
    read("../app/api/agent/write/route.ts"), read("../app/api/oauth/token/route.ts"),
    read("../app/api/agent/capabilities/route.ts"), read("../.env.example"),
  ]);
  assert.match(writer, /NO_STORE_HEADERS/);
  assert.match(token, /Cache-Control": "no-store"/);
  assert.match(capabilities, /external_mutations_enabled/);
  assert.match(env, /MCP_EXTERNAL_MUTATIONS_ENABLED=true/);
});

test("the unattended Curator bounds and revalidates agent-supplied source URLs", async () => {
  const curator = await read("../scripts/curator.py");
  assert.match(curator, /MAX_FETCH_BYTES = 30 \* 1024 \* 1024/);
  assert.match(curator, /parsed\.scheme not in \{"http", "https"\}/);
  assert.match(curator, /address\.is_global/);
  assert.match(curator, /class _SafeRedirectHandler/);
  assert.match(curator, /r\.read\(MAX_FETCH_BYTES \+ 1\)/);
  assert.match(curator, /_assert_public_source\(r\.geturl\(\)\)/);
});
