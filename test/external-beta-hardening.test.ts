import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isPublicIp } from "../lib/cimd";
import { domainOk } from "../lib/gate";
import { mutationsEnabled, readLimitedJson } from "../lib/externalBetaSecurity";

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

test("body limit checks actual streamed bytes even without Content-Length", async () => {
  const tooLarge = new Request("https://example.test", {
    method: "POST", body: JSON.stringify({ value: "é".repeat(20) }),
    headers: { "content-type": "application/json" },
  });
  const result = await readLimitedJson(tooLarge, 32);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test("external mutations fail closed unless explicitly enabled with a dedicated pepper", () => {
  const oldEnabled = process.env.MCP_EXTERNAL_MUTATIONS_ENABLED;
  const oldPepper = process.env.MCP_SECURITY_PEPPER;
  try {
    delete process.env.MCP_EXTERNAL_MUTATIONS_ENABLED;
    delete process.env.MCP_SECURITY_PEPPER;
    assert.equal(mutationsEnabled(), false);

    process.env.MCP_EXTERNAL_MUTATIONS_ENABLED = "true";
    assert.equal(mutationsEnabled(), false, "missing pepper must keep writes disabled");

    process.env.MCP_SECURITY_PEPPER = "x".repeat(32);
    assert.equal(mutationsEnabled(), true);
  } finally {
    if (oldEnabled === undefined) delete process.env.MCP_EXTERNAL_MUTATIONS_ENABLED;
    else process.env.MCP_EXTERNAL_MUTATIONS_ENABLED = oldEnabled;
    if (oldPepper === undefined) delete process.env.MCP_SECURITY_PEPPER;
    else process.env.MCP_SECURITY_PEPPER = oldPepper;
  }
});

test("database hardening serializes first-use idempotency reservations", async () => {
  const migration = await read("../supabase/mcp_external_beta_hardening.sql");
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(/);
  assert.match(migration, /primary key \(agent_account_id, action, key_hash\)/);
  assert.match(migration, /agent_connections_autonomous_client_key/);
  assert.match(migration, /revoke all on mcp_security_rate_limits/);
});

test("security defaults, middleware and runbook are fail closed", async () => {
  const [security, env, runbook, middleware] = await Promise.all([
    read("../lib/externalBetaSecurity.ts"), read("../.env.example"),
    read("../docs/MCP_EXTERNAL_BETA_SECURITY.md"), read("../middleware.ts"),
  ]);
  assert.match(security, /return enabled && securityPepperReady\(\)/);
  assert.match(env, /MCP_EXTERNAL_MUTATIONS_ENABLED=false/);
  assert.match(env, /MCP_LEGACY_MUTATIONS_ENABLED=false/);
  assert.match(middleware, /LEGACY_MUTATIONS/);
  assert.match(middleware, /MCP_LEGACY_MUTATIONS_ENABLED/);
  assert.match(runbook, /Keep both `MCP_EXTERNAL_MUTATIONS_ENABLED=false` and/);
});

test("modern agent writes require DB guards and carry replay/concurrency controls", async () => {
  const writer = await read("../app/api/agent/write/route.ts");
  assert.match(writer, /MCP_EXTERNAL_BETA_REQUIRE_DB_GUARDS/);
  assert.match(writer, /beginIdempotent/);
  assert.match(writer, /acquireMutationLease/);
  assert.match(writer, /securityAudit/);
  assert.match(writer, /case "appeal"/);
});

test("standing quota admission is serialized per durable contributor", async () => {
  const sql = await read("../supabase/mcp_oauth_write_functions.sql");
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp-author:' \|\| a\.id/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp-claim:' \|\| a\.id/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('mcp-review:' \|\| a\.id/);
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
