import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  MCP_RESOURCE, SCOPES, constantTimeEqual, parseScopes, pkceMatches, redirectAllowed,
} from "../lib/oauth";

/**
 * The authorization server's decisions, pinned.
 *
 * A red-team report ended "there are currently no OAuth-specific tests", which
 * was true and is the reason several of the defects it found were possible:
 * every one of them is a decision that looks right when read and is wrong when
 * exercised.
 *
 * What is here is what can be decided without a database — the predicates that
 * say yes or no. The flows that need one (atomic redemption, replay, scope
 * step-up, the full peer-review journey) are exercised against the live server
 * and are named at the bottom so their absence is a statement rather than an
 * oversight.
 */

test("a redirect URI matches exactly or not at all", () => {
  const registered = ["https://chat.example.com/callback"];
  assert.ok(redirectAllowed(registered, "https://chat.example.com/callback"));
  // Every one of these is a prefix or a suffix of the registered URI, and
  // every one of them is how an open redirect becomes a code-stealing one.
  for (const attempt of [
    "https://chat.example.com/callback/../../steal",
    "https://chat.example.com/callback?next=https://evil.example",
    "https://chat.example.com/callback#x",
    "https://chat.example.com.evil.test/callback",
    "https://chat.example.com/callbackx",
    "https://chat.example.com/callbac",
  ]) {
    assert.equal(redirectAllowed(registered, attempt), false, attempt);
  }
});

test("PKCE accepts the verifier that produced the challenge and nothing else", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.ok(pkceMatches(verifier, challenge));
  assert.equal(pkceMatches(randomBytes(32).toString("base64url"), challenge), false);
  // A `plain` client sends the verifier as the challenge. S256 must refuse it,
  // because accepting it would silently downgrade every client that tried.
  assert.equal(pkceMatches(verifier, verifier), false);
});

test("constant-time comparison still compares", () => {
  assert.ok(constantTimeEqual("abc", "abc"));
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false, "different lengths are not equal");
  assert.equal(constantTimeEqual("", "x"), false);
});

test("scopes are filtered to what this server grants", () => {
  assert.deepEqual(parseScopes("contribute review"), ["contribute", "review"]);
  assert.deepEqual(parseScopes("contribute publish admin"), ["contribute"],
    "an unknown scope is dropped, never granted");
  assert.deepEqual(parseScopes(""), ["contribute"], "asking for nothing asks to contribute");
  assert.deepEqual(parseScopes("publish"), ["contribute"],
    "there is no publish scope — publication is a human act outside this system");
  assert.deepEqual(parseScopes("review review"), ["review"], "duplicates collapse");
});

test("no scope named publish exists", () => {
  // Stated as its own test because it is a promise the consent screen makes to
  // a person: an agent cannot publish, whatever it asks for.
  assert.equal((SCOPES as readonly string[]).includes("publish"), false);
});

test("the resource identifier is the MCP endpoint itself", () => {
  // Audience binding compares against this. If it ever drifts from the URL a
  // client derived its metadata from, every token stops working — which is the
  // failure mode the spec's exact-match rule is designed to force.
  assert.equal(MCP_RESOURCE, "https://www.terraveler.com/api/mcp");
});

test("every write tool declares a scope, and no read tool does", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  const map = route.match(/const SCOPE_FOR[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(map, "SCOPE_FOR not found");
  const guarded = [...map[1].matchAll(/^\s*([a-z_]+):\s*"(\w+)"/gm)].map((m) => [m[1], m[2]]);
  // The catalogue and the enforcement drifted apart once already: the server
  // refused what the tools/list contract said was open.
  for (const [tool, scope] of guarded) {
    assert.ok((SCOPES as readonly string[]).includes(scope), `${tool} names an unknown scope`);
    // Search inside the tool's own block rather than assuming which field comes
    // first — the assertion is "this tool advertises that scope", and pinning
    // the order made it fail the day annotations were added, which is a test
    // reporting on its own regex instead of on the contract.
    const start = route.indexOf(`{ name: "${tool}",`);
    assert.ok(start > 0, `${tool} is enforced but has no tool definition`);
    const block = route.slice(start, route.indexOf('{ name: "', start + 10));
    assert.ok(block.includes(`securitySchemes: OAUTH("${scope}")`),
      `${tool} is enforced at '${scope}' but does not advertise it in tools/list`);
  }
  assert.ok(guarded.length >= 7, "expected at least the seven writing tools");
});

test("every tool declares what a call costs if it goes wrong", async () => {
  /**
   * A host reads these to decide how much friction to put in front of a call.
   * Declaring nothing leaves it to assume the worst — and an external Scribe's
   * client refused a read-only queue listing before the request ever left the
   * machine, which no amount of correctness on this end could have fixed.
   */
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  const names = [...route.matchAll(/\{ name: "([a-z_]+)",/g)].map((m) => m[1]);
  assert.ok(names.length >= 20, "expected the full catalogue");
  for (const tool of names) {
    const start = route.indexOf(`{ name: "${tool}",`);
    const block = route.slice(start, route.indexOf('{ name: "', start + 10));
    assert.ok(block.includes("annotations: {"), `${tool} declares no annotations`);
    assert.ok(/readOnlyHint: (true|false)/.test(block), `${tool} does not say whether it writes`);
  }
});

test("credentials are optional in every tool schema", () => {
  // While these were required, a client's own schema validation refused the
  // call before the server could challenge it — so the 401 that starts the
  // OAuth flow was unreachable for exactly the clients that needed it.
  return import("node:fs/promises").then(async ({ readFile }) => {
    const route = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
    assert.equal(route.includes('"handle", "api_key"'), false,
      "a tool still requires the legacy credentials");
  });
});

/**
 * Not covered here, and covered against the running server instead:
 *
 *   - two concurrent redemptions of one authorization code — exactly one wins
 *   - two concurrent refreshes — exactly one family survives
 *   - a spent code replayed WITHOUT the verifier does not revoke anything
 *   - a spent code replayed WITH the verifier does revoke
 *   - a rotated refresh re-presented inside the grace window is a retry
 *   - a valid token of the wrong scope gets 403, not 401
 *   - a token minted for another resource is refused here
 *   - the whole peer-review journey, which no contributor has ever completed
 */

test("discovery answers at the address the specification derives", async () => {
  /**
   * RFC 9728 puts the resource's own path after the well-known segment: a
   * resource at /api/mcp publishes its metadata at
   * /.well-known/oauth-protected-resource/api/mcp. Only the root form existed,
   * so a client following the spec asked for the derived address, got a 404,
   * and had nothing left to follow — discovery ended before it began.
   */
  const { access } = await import("node:fs/promises");
  for (const p of [
    "../app/.well-known/oauth-protected-resource/route.ts",
    "../app/.well-known/oauth-protected-resource/api/mcp/route.ts",
    "../app/.well-known/oauth-authorization-server/route.ts",
    "../app/.well-known/oauth-authorization-server/api/mcp/route.ts",
  ]) {
    await access(new URL(p, import.meta.url));
  }
});
