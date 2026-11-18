# Live editorial debugging: preparation and a new dossier

Baseline: main b3d5772 (PR #126). Scope: topic #1 / proposal #111, Cabeza de Vaca
and Estebanico. No publication or Living Newsroom UX changes.

## What is and is not established

The operator reports MCP Wikipedia receipts, two successful Limen HTTP responses,
four active configurations, and no saved plan/preparation. HTTP 200 at Limen is
not proof of valid JSON, a valid plan, a valid independent review, or a committed
PostgreSQL transaction. Both plan and review are committed atomically by
editorial_record_preparation: a later failure can leave both tables empty.

The current development session has no VPS SSH key or application environment
credentials. Vercel's connected team lists no accessible TerraVeler project and
project/log lookups return 404. An attempted public MCP status request from this
workspace timed out at connection. That does not establish a VPS/Ollama outage.
No live inference, source analysis, key rotation or production migration was
performed here. The actual failed response/output has not been obtained, so its
root cause must not be inferred from table counts alone.

## Implemented corrections

1. The preparation route generates a correlation_id for each attempt. Safe
   structured events record preflight, history, topic, version, agents, MCP
   discovery/read, receipt, planner, plan validation, reviewer, review validation
   and persistence separately. Private errors include correlation_id and stage.
2. Transport failures distinguish safe HTTP status, timeout, oversized body and
   invalid transport JSON. Parser/schema errors remain strict; no extraction of
   arbitrary JSON fragments, defaults, deleted tasks or unearned evidence.
3. Model events contain configured alias/version, response-reported model,
   bounded response request ID when supplied, content hash/length and finish
   category. They contain no output text, prompt, reasoning or keys. A reported
   alias is not physical Ollama model proof.
4. Prompt examples now contain valid literal enum choices rather than pipe-joined
   placeholder values. This is a reproducible contract-quality correction, not
   evidence of the historical live failure's cause.
5. New dossiers can associate already recorded MCP source reads without a fake
   target_voyage. Existing graph/worker/result governance remains authoritative.

Logs are operational diagnostics, not a durable replacement for PostgreSQL
results or Motus evidence. A timed-out Vercel invocation may end before its final
log. Correlate the last completed stage with the invocation and Limen evidence.

## First collect metadata on the VPS

Run from the checkout containing this change, with Docker access:

```sh
python3 scripts/editorial_live_diagnostics.py --topic-id 1
```

It performs read-only PostgreSQL queries and reads allowlisted routing facts
inside the one selected TerraVeler Limen container. It performs no inference,
source fetch, key introspection or configuration mutation. It discovers the
container by Compose service label, avoiding the incorrect short container name.
If several match, pass --limen-container explicitly.

Output includes plan/review/task metadata, agent aliases and versions, source
receipt counts, source associations, gate state and sanitized Limen route/effect
metadata. Missing migrations/commands/traces are unavailable or unknown, not
successful phases. Never replace it with a full docker inspect, env dump or raw
trace upload: those can contain credentials and source/prompt text.

The collector follows the pinned Limen tenant evidence layout and exposes only
routing metadata. decision_model, configured_provider_model and
response_reported_model have different meanings. Match decision/effect IDs and
provider evidence before asserting the actual Ollama model for each agent.
There is no new gateway or direct Ollama route.

## Capture one authorized preparation result

After normal review/deployment, while signed into the existing editor Desk,
run one request and inspect the JSON response, not just fetch's Response status.
Keep the same request ID when recovering an uncertain completion; do not dispatch
work or repeat model calls automatically during diagnosis.

```javascript
const response = await fetch('/api/desk/projects/prepare', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    topic_id: 1, expected_version: 0,
    request_id: 'cabeza-pilot-preparation-001',
    wikipedia_url: 'https://en.wikipedia.org/wiki/Álvar_Núñez_Cabeza_de_Vaca'
  })
});
const result = await response.json();
console.log({http_status: response.status, error: result.error, detail: result.detail,
  correlation_id: result.correlation_id, stage: result.stage,
  plan_id: result.plan_id, review: result.review, replayed: result.replayed});
```

Use the current expected_version from PostgreSQL if a plan has since been saved.
The supplied URL is a candidate to verify through MCP, not a claim it has already
been consulted in this attempt. Do not bypass an ambiguity or missing article.

Filter Vercel runtime logs by route/correlation_id. Planner/reviewer model events
show how far HTTP/JSON processing got; validation and persist events show whether
SQL was reached. Check the Limen decision/effect records for the same execution
window and available gateway request IDs. A response-reported model can be a
logical alias; use the gateway route decision/configuration and provider evidence.
If prepare itself returns 200 with a plan_id but the canonical DB has no row,
verify deployment revision and data-plane configuration before retrying.

## New-dossier source intake

Apply supabase/editorial_dossier_sources.sql AFTER editorial_plan_dispatch.sql
and existing receipt/preparation/corpus migrations on canonical VPS PostgreSQL,
using the normal backup/maintenance procedure. Reapplying earlier overriding RPC
migrations afterwards would restore older behavior. Do not activate the global
plan gate as part of this migration.

Use TerraVeler MCP search_sources to discover candidates and fetch_source_text
to consult a permitted source with receipt recording enabled. Associate its real
consultation ID through editor-only POST /api/desk/projects/sources:

```json
{"topic_id":1,"consultation_id":"<actual persisted receipt UUID>",
 "title":"Source label","request_id":"cabeza-source-attachment-001"}
```

The caller cannot submit source bytes, URL, rights or a fake voyage slug. The
server checks an actual complete fetch_source_text receipt, stored hash and
current most-specific domain-trusted PD/CC policy. Wikipedia orientation receipts
and link-only/candidate metadata are not research-source receipts. Truncated or
ineligible sources fail closed. A long work may require a supported shorter
source/chapter; do not relabel an incomplete read complete.

GET /api/desk/projects/sources?topic_id=1 returns private association metadata,
not source text. The source ledger is immutable history, not permanent rights
clearance. The pilot limit is 40 total associations per dossier, including
historical sources that have since been revoked; it is not an unlimited lifecycle. Corpus reading revalidates current policy and records the exact
bounded source fragments delivered to each research attempt in the existing
MCP corpus consultation ledger. Downstream result guards verify those fragments
and their current policy again. Text is not copied to a second RAG store.

Both the existing voyage corpus and receipt-bound dossier sources remain
supported. No automatic discovery, source selection or historical verification
is implied by an association. A runnable pilot plan must still satisfy the
existing supported-specialty/dependency shape. Unsupported image, ethnohistory
or other tasks must remain visible blockers; do not silently prune a plan to
make dispatch pass. Final human publication authority is unchanged.

## Complete the live pilot only after evidence and key rotation

1. Confirm correct deployments/migrations/data plane and exact agent aliases.
2. Rotate exposed Limen keys as below; confirm each scoped route works.
3. Obtain the plan and independent review through the existing preparation API.
4. Consult and attach sufficient relevant permitted sources through MCP.
5. Dispatch the exact adequate plan through the existing enabled pilot API.
6. Observe research → writer → fact checker, lease/retry behavior and immutable
   result IDs. Inspect the complete private draft and matching review.
7. Record actual receipt/plan/run/task/result IDs and gateway routing evidence in
   issue #125. Do not publish. Keep live outcomes separate from fixture tests.

This change does not by itself prove that the live pilot has completed.

## Exposed scoped keys: rotation procedure

Treat keys accidentally shared in chat as compromised. Do not paste them again
or include them in scripts, issue comments, screenshots, logs or test fixtures.
This session cannot confirm or execute revocation without trusted operator
access; rotation remains an explicit live prerequisite.

In the dedicated TerraVeler Limen instance, identify and revoke the exposed
scoped virtual keys through the existing administrator mechanism. Do not rotate
Orbis keys or replace the gateway master/admin key indiscriminately. Provision
replacement virtual keys restricted to each exact authorized model/group and
appropriate expiry. Store them only in the external state/secrets and Vercel
production/preview configuration that actually uses the route, plus worker env
when applicable. Keep EDITOR_LIMEN_MODEL_KEYS consistent with those aliases; do
not reuse one broad key to make all routes appear available.

Redeploy/rebuild affected clients. Verify an old exposed key is denied and each
new scoped key can use its intended alias but cannot cross routes. Record only
key IDs, operation timestamps, scope/expiry metadata and verification outcomes,
never key values. Physical provider routing still requires Limen/provider
execution evidence, not merely a successful /models response.

## Verification of this change (18 November 2026)

- 62 focused application regressions passed (editorial APIs/contracts and
  submission workflow), using fixture transports.
- 11 PGlite tests passed across receipts/plans, dispatch and dossier sources;
  the new-dossier test runs the actual research/writer/reviewer Python handlers
  in fresh processes with simulated MCP and model outputs. It reaches
  awaiting-editor without a RAG row or fake target_voyage. It is not live model
  generation or verification of the full worker/Motus runtime.
- 25 Python gateway/handler/MCP tests and 5 metadata-collector tests passed.
- Production build/TypeScript passed; independent review covered source
  association, current-policy checks and preserved graph result guards.
- The general application suite was stopped by automatic review for a possible
  direct Archive.org request. Expanded isolation was evaluated but not retained
  as an unproven fix. No claim of a complete general-suite pass is made; the
  focused offline suites above completed. Hosted required checks remain gates.
- No VPS SQL changes, live inference, key revocation, production UX replacement
  or publication were performed. Exact live failure attribution and completion
  of the Cabeza de Vaca pilot remain blocked on trusted runtime access/evidence.
