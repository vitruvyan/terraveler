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

Then refresh PostgREST's schema cache:

```bash
docker restart terraveler_postgrest
```

The application contains a temporary non-atomic fallback if the new functions
are not visible yet. That prevents an app-first deploy from breaking, but it is
a deployment bridge, not the intended steady state. Do not declare the modern
write path production-ready until the OAuth-native functions are visible through
PostgREST.

The new functions do not remove or replace the legacy functions. Rolling the web
application back therefore restores the old path without a database rollback.

## Pre-merge gates

GitHub Actions must be green on the current PR head. It runs:

```text
npm ci
npm test
npm run build
runtime MCP smoke
```

The runtime smoke launches the production Next build and verifies discovery,
the modern tool catalogue, anonymous capability introspection, OAuth challenge
semantics and routing-header/body mismatch rejection.

## Deployment order

1. Keep PR #19 in draft until CI and preview builds are green.
2. Apply `supabase/mcp_oauth_write_functions.sql` to the Terraveler database.
3. Restart/refresh PostgREST so the new RPCs are visible.
4. Deploy the web application.
5. Run the HTTP smoke suite against production.
6. Run client-level smoke tests: existing Claude path first, Gemini CLI modern
   OAuth second, then an OpenAI MCP-capable host where write linking is available.
7. Only after the existing Claude path and at least one modern non-Anthropic path
   pass should the PR leave draft state / be merged.

## CIMD security boundary

CIMD is supported only through `lib/cimd.ts`. The resolver requires a stable
HTTPS document URL, blocks non-public DNS results, pins the chosen public IP for
the HTTPS request, disables redirects, imposes a 3 second timeout and 64 KiB
response ceiling, validates client id and redirect URIs strictly, and caches a
validated snapshot for a bounded period.

Do not replace this with a generic `fetch(client_id)` helper.

## Authority invariants

Release blockers:

- model/vendor name never grants a capability;
- `publish` is never an OAuth scope or public MCP capability;
- human-backed connections share the human tandem's contributor standing;
- autonomous connections are explicitly recorded as autonomous;
- an agent cannot review its own draft;
- Stage-0 and the editorial workflow remain unchanged;
- modern writes authenticate Bearer/contributor identity, never a conversation-
  supplied API key.

## Remaining compatibility debt

The 2025 handler still contains the legacy API-key implementation and duplicates
some scope/quota declarations. The modern facade derives authority from
`lib/agentCapabilities.ts`; regression tests pin that registry to the legacy
handler so the two cannot silently diverge during the compatibility window.

Do not delete the legacy implementation in this release. Retire it only after
supported legacy clients have moved to the modern path and their contributor
identity/standing migration has been tested.

## Why Orbis stays out of this PR

Terraveler already has real editorial semantics, source policy, agent identities
and observable failure modes. That makes it more useful as an acceptance vertical
for Orbis than as an early dependency on Orbis while Orbis and full Motus
integration are still moving.

Keeping this release standalone gives the later Orbis work a control group: the
same submissions, reviews, provenance and MCP requests can be run through both
architectures and compared rather than judged by impression.

## Later Orbis integration

Once Orbis' interfaces and Motus integration are stable enough, integrate behind
explicit ports so the same Terraveler acceptance corpus can run in two modes:

```text
standalone Terraveler   -> current services / Motus subset
Orbis-backed Terraveler -> Orbis cognition + shared Motus contracts
```

The goal is to prove that Orbis can host a real cultural vertical without
changing Terraveler's public MCP contract, evidence policy or editorial
semantics.
