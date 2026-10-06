import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilitySnapshotUrl } from "../lib/agentCapabilities";

test("enrollment diagnostics execute the anonymous → registration → token → authenticated transition", async (t) => {
  const vars = {
    POSTGREST_URL: "https://data.example.test",
    POSTGREST_SERVICE_KEY: "fixture-service-key",
    MCP_SECURITY_PEPPER: "fixture-pepper-with-at-least-thirty-two-characters",
    MCP_EXTERNAL_ENROLLMENT_ENABLED: "true",
    MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED: "true",
  };
  const prior = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  const { GET } = await import("../app/api/agent/capabilities/route");
  const { POST: register } = await import("../app/api/oauth/register/route");
  const { POST: token } = await import("../app/api/oauth/token/route");
  const { POST: mcp } = await import("../app/api/mcp/route");
  const { middleware } = await import("../middleware");
  const { NextRequest } = await import("next/server");

  // Only the VPS HTTP boundary is stubbed. Registration, token issuance,
  // bearer resolution, identity bootstrap and both MCP adapters run normally.
  const tables: Record<string, any[]> = Object.fromEntries([
    "contributors", "agent_accounts", "oauth_clients", "agent_connections", "oauth_tokens",
    "mcp_security_audit", "human_agent_links", "contributor_standing",
  ].map((name) => [name, []]));
  let nextId = 1;
  let discardBindingWrite = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/agent/capabilities") {
      assert.equal(init?.cache, "no-store");
      return GET(new Request(url, { headers: init?.headers }));
    }
    assert.equal(url.origin, vars.POSTGREST_URL, "application data must use the VPS plane");
    const path = url.pathname.replace("/rest/v1/", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "rpc/mcp_security_consume_limit") return Response.json([{ allowed: true }]);
    if (path === "rpc/mcp_security_acquire_lease") return Response.json(true);
    if (path === "rpc/mcp_security_release_lease") return Response.json(null);
    assert.ok(Object.hasOwn(tables, path), `unexpected data request: ${path}`);
    const rows = tables[path];
    const matches = (row: any) => [...url.searchParams].every(([key, value]) => {
      if (["select", "limit"].includes(key)) return true;
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("ilike.")) return String(row[key]).toLowerCase() === value.slice(6).toLowerCase();
      if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
      if (value === "is.null") return row[key] == null;
      assert.fail(`unsupported fixture filter: ${key}`);
    });
    let result: any[];
    if (method === "POST") {
      result = (Array.isArray(body) ? body : [body]).map((row) => ({ id: nextId++, ...row }));
      rows.push(...result);
    } else {
      result = rows.filter(matches);
      if (method === "PATCH" && !(discardBindingWrite && body.agent_account_id)) {
        result.forEach((row) => Object.assign(row, body));
      }
    }
    if (path === "agent_connections") result = result.map((row) => ({
      ...row, contributors: tables.contributors.find((c) => c.id === row.contributor_id),
    }));
    return Response.json(result);
  };
  const jsonRequest = (path: string, body: unknown) => new Request(`https://app.example.test${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const capabilityRequest = (access?: string, asked?: string[]) => new Request(
    capabilitySnapshotUrl("https://app.example.test", asked),
    { headers: access ? { authorization: `Bearer ${access}` } : {} },
  );
  let credentials: any;
  let issued: any;
  const allScopes = ["contribute", "review", "appeal"];
  const assertNoSecrets = (data: unknown) => {
    const text = JSON.stringify(data);
    for (const secret of [vars.POSTGREST_SERVICE_KEY, vars.MCP_SECURITY_PEPPER, credentials?.client_secret, issued?.access_token,
      ...tables.oauth_tokens.map((row) => row.token_hash)]) {
      if (secret) assert.equal(text.includes(secret), false, "diagnostics must not include credentials or hashes");
    }
    assert.doesNotMatch(text, /data\.example\.test/);
  };

  await t.test("anonymous comparison contract precedes real registration and token exchange", async () => {
    const res = await GET(capabilityRequest());
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control")!, /no-store/);
    const before = await res.json();
    assert.equal(before.mode, "anonymous");
    assert.equal(before.onboarding_transition.state, "before-enrollment");
    assert.deepEqual(before.allowed, ["read"]);
    const enrollment = await register(jsonRequest("/api/oauth/register", {
      voyager_name: "xuanzang", grant_types: ["client_credentials"], client_name: "Offline transition fixture",
    }));
    assert.equal(enrollment.status, 201);
    credentials = await enrollment.json();
    assert.ok(credentials.agent_id);
    const exchange = await token(jsonRequest("/api/oauth/token", {
      grant_type: "client_credentials", client_id: credentials.client_id,
      client_secret: credentials.client_secret, scope: allScopes.join(" "),
    }));
    assert.equal(exchange.status, 200);
    issued = await exchange.json();
    const after = await (await GET(capabilityRequest(issued.access_token, allScopes))).json();
    assert.equal(after.agent_id, credentials.agent_id);
    assert.equal(after.agent_id, issued.agent_id);
    assert.equal(after.enrollment, "self");
    assert.equal(after.human_linked, false);
    assert.equal(after.standing.rank, "cabin-boy");
    assert.deepEqual(after.allowed, ["read", ...allScopes]);
    assert.deepEqual(after.onboarding_transition.requested_scopes, allScopes);
    assert.deepEqual(after.onboarding_transition.granted_scopes, allScopes);
    assert.deepEqual(after.onboarding_transition.reflected_scopes, allScopes);
    assert.equal(after.onboarding_transition.credential_bound, true);
    assert.equal(after.onboarding_transition.permissions_current, true);
    assert.equal(after.onboarding_transition.requested_scopes_satisfied, true);
    assert.equal(after.publish, false);
    assert.ok(after.not_allowed.includes("publish"));
    assertNoSecrets(after);
  });

  await t.test("global write pause preserves enrollment, binding, standing and grants", async () => {
    process.env.MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED = "false";
    t.after(() => { process.env.MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED = "true"; });
    const data = await (await GET(capabilityRequest(issued.access_token, allScopes))).json();
    assert.equal(data.agent_id, credentials.agent_id);
    assert.equal(data.onboarding_transition.state, "after-enrollment");
    assert.equal(data.onboarding_transition.credential_bound, true);
    assert.equal(data.onboarding_transition.permissions_current, true);
    assert.deepEqual(data.scopes, allScopes);
    assert.deepEqual(data.allowed, ["read"]);
    assert.deepEqual(data.onboarding_transition.reflected_scopes, []);
    assert.deepEqual(data.onboarding_transition.mutation_blocked_scopes, allScopes);
    assert.deepEqual(data.onboarding_transition.missing_scopes, []);
    assert.match(data.onboarding_transition.note, /paused globally/);
    assertNoSecrets(data);
  });

  await t.test("missing requested grants cannot claim complete permissions even during a pause", async () => {
    const stored = tables.oauth_tokens.find((row) => row.kind === "access");
    const original = stored.scopes;
    stored.scopes = ["contribute"];
    for (const enabled of ["true", "false"]) {
      process.env.MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED = enabled;
      const data = await (await GET(capabilityRequest(issued.access_token, allScopes))).json();
      assert.deepEqual(data.onboarding_transition.granted_scopes, ["contribute"]);
      assert.deepEqual(data.onboarding_transition.missing_scopes, ["review", "appeal"]);
      assert.equal(data.onboarding_transition.requested_scopes_satisfied, false);
      assert.equal(data.onboarding_transition.permissions_current, false);
      assertNoSecrets(data);
    }
    stored.scopes = original;
    process.env.MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED = "true";
  });

  await t.test("no original scope baseline means comparison is unknown", async () => {
    const data = await (await GET(capabilityRequest(issued.access_token))).json();
    assert.equal(data.onboarding_transition.requested_scopes, null);
    assert.equal(data.onboarding_transition.requested_scopes_satisfied, null);
    assert.match(data.onboarding_transition.note, /comparison is unknown/);
  });

  await t.test("granted scopes without a policy capability fail current-permissions diagnosis", async () => {
    const stored = tables.oauth_tokens.find((row) => row.kind === "access");
    const original = stored.scopes;
    stored.scopes = ["contribute", "publish"];
    for (const enabled of ["true", "false"]) {
      process.env.MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED = enabled;
      const data = await (await GET(capabilityRequest(issued.access_token))).json();
      assert.deepEqual(data.onboarding_transition.unreflected_scopes, ["publish"]);
      assert.equal(data.onboarding_transition.permissions_current, false);
      assert.equal(data.allowed.includes("publish"), false);
    }
    stored.scopes = original;
    process.env.MCP_EXTERNAL_CONTENT_MUTATIONS_ENABLED = "true";
  });

  await t.test("unknown, expired and revoked credentials never appear as anonymous enrollment", async () => {
    const stored = tables.oauth_tokens.find((row) => row.kind === "access");
    for (const variant of ["unknown", "expired", "revoked"]) {
      const expires = stored.expires_at;
      if (variant === "expired") stored.expires_at = "2000-01-01T00:00:00Z";
      if (variant === "revoked") stored.revoked_at = new Date().toISOString();
      const res = await GET(capabilityRequest(variant === "unknown" ? "invalid-fixture" : issued.access_token));
      assert.equal(res.status, 401);
      assert.match(res.headers.get("www-authenticate")!, /invalid_token/);
      const data = await res.json();
      assert.equal(data.error, "invalid_token");
      assert.equal(data.onboarding_transition.state, "authentication-failed");
      assert.equal(data.onboarding_transition.permissions_current, false);
      assertNoSecrets(data);
      stored.expires_at = expires;
      delete stored.revoked_at;
    }
  });

  await t.test("legacy bootstrap confirms the persisted binding on the first request", async () => {
    const conn = tables.agent_connections[0];
    const id = conn.agent_account_id;
    conn.agent_account_id = null;
    const data = await (await GET(capabilityRequest(issued.access_token, allScopes))).json();
    assert.equal(conn.agent_account_id, id);
    assert.equal(data.agent_id, credentials.agent_id);
    assert.equal(data.onboarding_transition.credential_bound, true);
    assert.equal(data.onboarding_transition.permissions_current, true);
    conn.agent_account_id = null;
    discardBindingWrite = true;
    const unbound = await (await GET(capabilityRequest(issued.access_token, allScopes))).json();
    assert.equal(unbound.onboarding_transition.state, "identity-unbound");
    assert.equal(unbound.onboarding_transition.permissions_current, false);
    discardBindingWrite = false;
    conn.agent_account_id = id;
  });

  await t.test("both MCP transports forward requested scopes and surface invalid-token errors", async () => {
    for (const modern of [false, true]) {
      for (const access of [issued.access_token, "invalid-fixture"]) {
        const req = jsonRequest("/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "get_capabilities", arguments: { requested_scopes: allScopes } } });
        req.headers.set("authorization", `Bearer ${access}`);
        if (modern) {
          req.headers.set("mcp-method", "tools/call");
          req.headers.set("mcp-name", "get_capabilities");
          req.headers.set("mcp-protocol-version", "2026-07-28");
        }
        const response = modern ? await middleware(new NextRequest(req)) : await mcp(req);
        const body = await response.json();
        assert.equal(body.result.isError, access !== issued.access_token);
        if (access === issued.access_token) {
          assert.deepEqual(body.result.structuredContent.onboarding_transition.requested_scopes, allScopes);
          assert.equal(body.result.structuredContent.onboarding_transition.permissions_current, true);
        } else assert.equal(body.result.structuredContent.error, "invalid_token");
        assertNoSecrets(body);
      }
      const req = jsonRequest("/api/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "get_capabilities", arguments: { requested_scopes: ["publish"] } } });
      if (modern) {
        req.headers.set("mcp-method", "tools/call");
        req.headers.set("mcp-name", "get_capabilities");
        req.headers.set("mcp-protocol-version", "2026-07-28");
      }
      const response = modern ? await middleware(new NextRequest(req)) : await mcp(req);
      assert.equal((await response.json()).error.code, -32602);
    }
  });
});
