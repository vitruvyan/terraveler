# Agentic editorial roadmap

Goal: agents assemble contributions into one sourced editorial result; the
editor checks progress, intervenes on genuine problems and authorizes publication.
Limen stays upstream, agent administration belongs to TerraVeler, Motus executes,
and canonical VPS PostgreSQL retains state. No Orbis tenancy redesign here.

## 1. Agent team administration — implemented in code

- Versioned configurations: stable key, name, role, logical model, specific
  instructions and available/paused setting. No stored credentials per agent.
- Editor-only `/desk/team`, linked from the Desk, with create and edit controls.
- Model IDs come from the scoped Limen key's catalogue. Available configurations
  require a visible model; paused drafts can be saved while Limen is unavailable.
- Configuration does not start work. Execution requires an explicitly enabled
  worker and a configured model route. No invented running state.

Acceptance: unauthorized users cannot read or change configurations; retries do
not duplicate versions; concurrent edits conflict; past versions cannot change;
pausing remains possible while the gateway is unavailable.

Deploy: apply `supabase/editorial_team.sql` to canonical VPS PostgreSQL, not
Supabase Auth. It requires the `terraveler_service` role. No live migration is
performed by opening or building the frontend. Task claims bind eligible configurations through step 3. The registry is separate from
external MCP contributor accounts and the public copyable prompt registry:
it stores internal execution configurations, not identities or credentials.

## 2. Verify the dedicated Limen deployment

- Initialize the pinned private submodule, build private wheels and image.
- Provision server credentials, a restricted virtual key and permitted data classes.
- Choose local models or explicitly authorized cloud routes, then verify catalogue,
  generation and policy denial. Preserve local-only restrictions where applicable.
- Configure protected TLS connectivity from Vercel and validate the Desk request.

Acceptance: a real approved call passes through Limen; a refused request never
retries directly; no administrative credential reaches the browser. See
`LIMEN_INTEGRATION.md`. The operator reported the pinned Limen checkout and
Motus wheels built successfully. Runtime configuration, image startup and a
usable model route are still unverified. Live LLM testing is deferred; it does
not block work on durable assignment and mocked request contracts.

## 3. Bind durable tasks to agent versions — implemented in code

- Select an eligible agent for each role; snapshot its exact configuration
  version into the task's execution context and successful trace.
- Implement production handlers with structured outputs and scoped tools.
- Separate immutable system/source rules from editable agent instructions.
- Define suspension semantics, model availability, cancellation and recovery.
- Enforce tool allowlists in code; prompt text cannot grant capabilities.

Acceptance: a recovered task cannot silently switch to a newer configuration;
disabled agents cannot take new tasks; late outputs cannot overwrite a newer
attempt; no configuration receives publication or unrestricted tool authority.

Implementation progress: immutable version binding, pause/role checks, trace
context, scoped Limen generation, opt-in role handlers and database-only source
retrieval are implemented. See `EDITORIAL_AGENT_BINDING.md` and
`EDITORIAL_PIPELINE.md`. Production execution remains unverified.

## 4. Automate research, writing and independent review — implemented in code

- Research consolidates explicitly linked contributions with source provenance.
- Writing produces one versioned draft from accepted research results.
- Review checks sources, quotations, rights and editorial requirements.
- Bounded repair cycles send unresolved issues to the editor with an explanation.

Acceptance: one test dossier reaches a reviewable result across process restart;
unsupported claims remain visible and prevent readiness for publication. Model
success is not factual verification. User publication authorization is retained.

## 5. Group proposals into understandable dossiers — implemented in code

- Show one dossier per explicit topic, with its contributions nested beneath it.
- Display goal, latest draft, progress, blocker and next responsible role.
- Keep proposed topic associations reviewable; do not merge similar titles blindly.
- Keep research, reviewed drafts and published voyages distinct.

Acceptance: the editor can understand the state without assembling contributions
or interpreting raw submission types. Historical source material remains reachable.

## 6. Chat with the coordinator — implemented in code

- Ground the chat in the selected dossier and durable work state.
- Translate authorized requests into typed, idempotent tasks or proposed edits.
- Show what was recorded, who owns it and its status after session restart.
- Keep publishing as an explicit human-authorized operation.

Acceptance: a request creates a recoverable job rather than an untracked promise;
configuration changes cannot bypass source policies or publication authority.

## Delivery status

The code now includes dossier views, explicit pipeline scheduling with bounded
repair, candidate research/writing/review handlers, durable coordinator requests
and an optional continuous worker container. These are implementation milestones,
not evidence that an autonomous newsroom is running in production.

Pending operator verification: remaining canonical database migrations, deployed
frontend and gateway configuration, worker startup and DB permissions, an
available authorized LLM route, one real end-to-end dossier with restart/recovery,
and explicit human publication. No live LLM result or production deployment is
claimed. Use `EDITORIAL_PIPELINE.md` for the activation order.

## Verification and delivery

Each step is a separate reviewable increment with meaningful tests and deployment
status. Backend SQL requires executable database tests; agent handlers require
recovery/authority tests; UI changes require visual and interaction checks. A
production claim requires observed runtime verification, not only a passing build.

Local checks: `npm test`, `npm run test:editorial-db`, `npx tsc --noEmit`,
`npm run build`. Browser QA after building: `node test/qa_team_ui.cjs` (requires
an installed Playwright Chromium, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). It starts
an isolated local app and identity fixture, intercepts team data and exercises
auth, paused creation, outage, lost-response retries and edit conflicts. It never
uses the production database or a model.

The offline regression suite also exercises a durable coordinator request through
actual role handlers and PostgreSQL scheduling, including a requested rewrite,
new worker processes, stale-lease rejection and the editor-ready boundary.
Browser interaction fixtures: `node test/qa_editorial_projects.cjs`. Research is
currently scoped to explicitly linked voyages with approved, ingested corpus
fragments; discovery of missing material is not silently replaced by generation.
An editor may explicitly commission another run after a reviewed candidate is
ready; the previous run and draft remain historical records.
