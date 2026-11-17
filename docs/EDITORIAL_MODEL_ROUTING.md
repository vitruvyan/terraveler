# Editorial model routing (TerraVeler)

Keep the existing `local-default` credentials. Additional models are application
configuration, not a new policy engine. Use Limen's registered exact model
routes; for each alias configure a distinct group/profile allowing the exact
local model for the `editorial` local_only class, and issue a virtual key with
that group and only that model. Do not reuse a key with the original group:
Limen can substitute a policy's model for the requested model. Never grant
wildcard model access to the editorial clients. Use the existing provider
catalogue to discover candidates, and explicitly authorize generative models
only. A wildcard route on the provider is infrastructure, not permission.

Set the same additional alias-to-key map in the Vercel server environment and
the worker environment (separate keys for each client may be used, provided
they bind the same exact routes). Variable: `EDITOR_LIMEN_MODEL_KEYS`, a single
JSON object, e.g. `{"editorial-writer":"<scoped virtual key>"}`. The existing
`EDITOR_LIMEN_MODEL` (default `local-default`) and `EDITOR_LIMEN_API_KEY`
continue to bind the legacy route. Aliases and key values must be unique.
Never commit or print real secrets. An unknown alias fails closed.
An invalid map fails closed; no fallback to another model.

Team queries `/v1/models` with each route's key, exposes only the exact
configured model if visible, and omits inaccessible aliases. Catalogue
visibility is not an inference/health guarantee. The preparation endpoint
and worker select the same exact model credential based on the agent
configuration (including its version). Worker candidate evidence records
the requested model and the model reported by the response. The latter
is not an independent verification of the physical provider route.
Verify the actual `served_model` in the corresponding Limen decision evidence
before declaring multi-model operation validated.

Deployment: provision routes, policy groups and keys in the dedicated
TerraVeler Limen instance; do not alter Orbis. Test all exact routes, negative
cross-route requests and policy evidence. Configure both clients, redeploy
and rebuild the worker. Do not activate editorial dispatch/worker gates
until the MCP path and permissions have been checked. No database migration.

## Bounded inference budgets (consolidated from #123)

Worker production configuration defaults to a 120-second gateway socket timeout
and 4096 output tokens (including reasoning tokens). Optional
`EDITOR_LIMEN_TIMEOUT_SECONDS` (positive, at most 120) and
`EDITOR_LIMEN_MAX_TOKENS` (integer 512–8192) remain bounded. Explicit test-port
construction retains its previous 30-second socket default. The existing
300-second worker execution deadline and lease heartbeats are unchanged.

Preparation has two serial 100-second inference budgets, 5000 output tokens per
call, and a 300-second Vercel function duration declaration. Its #124 standalone
or fenced JSON parser and safe diagnostic categories remain unchanged. Both
clients reject explicit `finish_reason: length`, even if the partial output
happens to parse as JSON. No retry or additional concurrent inference is added.

These are client budgets, not guarantees of platform or proxy capacity. The
Vercel plan, ingress proxy, gateway and model server can impose shorter limits;
verify them and measure realistic editorial tasks before enabling dispatch.
This change introduces no migration and does not enable any execution gate.
