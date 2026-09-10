# Universal agent onboarding — deploy runbook

This runbook covers the MCP 2026 / OAuth interoperability layer introduced by
`feat/universal-agent-onboarding`. It deliberately does **not** introduce Orbis
as a runtime dependency. Terraveler remains a standalone baseline so a later
Orbis integration can be measured against a known-good vertical.

## What is changing

The public MCP endpoint remains:

```
https://www.terraveler.com/api/mcp
```

Two protocol eras coexist:

- requests without modern MCP routing headers continue to the existing 2025
  handler unchanged;
- MCP 2026-07-28 requests are handled by the compatibility facade, which adds
  `server/discover`, header/body validation, cache hints, server identity,
  capability introspection and OAuth-native writes.

Modern interactive clients use OAuth. They never need `handle`, `api_key`,
`recovery_code`, `register` or `rotate_key` in their tool catalogue. Older
clients retain that compatibility lane.

## Database prerequisite

The existing OAuth schema must already be present (`oauth.sql`, its hardening /
atomic follow-ups, and `autonomous.sql` where autonomous agents are enabled).
The legacy atomic MCP functions in `mcp_write_functions.sql` must also exist.

Apply the new migration:

```bash
docker exec -i terraveler_postgres \
  psql -U terraveler -d terraveler \
  < supabase/mcp_oauth_write_functions.sql
```

Then refresh PostgREST's schema cache. The deployment historically does this by
restarting the service/container:

```bash
docker restart terraveler_postgrest
```

The application contains a temporary non-atomic compatibility fallback if the
new functions are not visible yet. That fallback prevents an app-first deploy
from breaking, but it is a deploy bridge, not the desired steady state. The
steady state is the OAuth-native SQL functions.

The new functions do **not** remove or replace the legacy functions. Rolling the
web application back therefore restores the old path without a database
rollback.

## Pre-merge gates

GitHub Actions must pass all of these on the PR head:

```text
npm ci
npm test
npm run build
runtime MCP smoke
```

The runtime smoke launches the production Next build and verifies:

- `server/discover` negotiates MCP `2026-07-28`;
- the modern catalogue contains `get_capabilities`;
- the modern catalogue does not expose `register`;
- anonymous `get_capabilities` reports read-only authority and no publish
  capability;
- an unauthorised protected call returns HTTP 401 and an OAuth challenge;
- a routing-header/body mismatch returns JSON-RPC `-32020`.

## Deployment order

1. Keep PR #19 in draft until CI and preview builds are green.
2. Apply `supabase/mcp_oauth_write_functions.sql` to the Terraveler database.
3. Restart/refresh PostgREST so the new RPCs are visible.
4. Deploy the web application.
5. Run the HTTP smoke suite against production.
6. Run client-level smoke tests in this order: existing Claude path first,
   Gemini CLI modern OAuth second, then an OpenAI MCP-capable host where write
   linking is available.
7. Only after the existing Claude path and at least one modern non-Anthropic
   path pass should the PR leave draft state / be merged.

## Client-level acceptance

### Claude / 2025 compatibility

- existing connector still lists tools;
- public read works;
- a protected write still starts the existing OAuth flow;
- an already authorised connection still retains its contributor/standing.

### Gemini CLI / MCP 2026

- `server/discover` succeeds;
- OAuth discovery finds Terraveler metadata;
- callback validates the RFC 9207 `iss` parameter;
- no API key is requested from the user;
- first protected action creates/reuses a contributor automatically;
- `get_capabilities` reflects the granted scope.

### OpenAI-capable MCP host

- public reads require no auth;
- protected tool advertises its scope and returns a standards-compatible
  challenge;
- if the host supports write linking, approval completes without exposing a
  Terraveler secret to the conversation.

Do not weaken a write into a read or bypass OAuth to accommodate a host UI.
Client limitations are not Terraveler permissions.

## CIMD security boundary

CIMD is supported only through the guarded resolver in `lib/cimd.ts`. Its
outbound fetch is deliberately constrained:

- HTTPS document URL only, stable/non-root, no userinfo, query or fragment;
- DNS resolution must produce public addresses only;
- the chosen public address is pinned for the HTTPS request to resist DNS
  rebinding while SNI/TLS still verifies the declared hostname;
- local/private/link-local/CGNAT/metadata/documentation/reserved address ranges
  are rejected;
- redirects are not followed;
- 3 second timeout;
- 64 KiB response ceiling;
- strict client id / redirect URI / public-PKCE metadata validation;
- bounded one-hour metadata cache in `oauth_clients`.

Do not replace this with a generic `fetch(client_id)` helper.

## Authority invariants

The following are release blockers if violated:

- model/vendor name never grants a capability;
- `publish` is never an OAuth scope or public MCP capability;
- human-backed connections share the human tandem's contributor standing;
- autonomous connections are explicitly recorded as autonomous;
- an agent cannot review its own draft;
- the Stage-0 gate and existing editorial workflow remain unchanged;
- modern writes authenticate the Bearer/contributor id, never a conversation-
  supplied API key.

## Remaining compatibility debt

The 2025 handler still contains the legacy API-key implementation and duplicates
some scope/quota declarations. The modern facade derives authority from
`lib/agentCapabilities.ts`; regression tests pin that registry to the legacy
handler so the two cannot silently diverge during the compatibility window.

Do **not** delete the legacy implementation in this release. Retire it only when
supported legacy clients have moved to the modern path and their contributor
identity/standing migration has been tested. Until then, compatibility is a
feature; duplication is controlled debt.

## Later Orbis integration

Do not replace Terraveler's domain rules with Orbis in this change. Once Orbis'
interfaces and Motus integration are stable enough, integrate behind explicit
ports so the same Terraveler acceptance corpus can run in two modes:

```text
standalone Terraveler   -> current services / Motus subset
Orbis-backed Terraveler -> Orbis cognition + shared Motus contracts
```

The target is not merely “Terraveler uses Orbis”. The target is to prove that
Orbis can host a real cultural vertical **without changing Terraveler's public
MCP contract, evidence policy or editorial semantics**.
