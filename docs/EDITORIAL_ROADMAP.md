# Agentic editorial roadmap

Goal: agents assemble contributions into one sourced editorial result; the
editor checks progress, intervenes on genuine problems and authorizes publication.
Limen stays upstream, agent administration belongs to TerraVeler, Motus executes,
and canonical VPS PostgreSQL retains state. No Orbis tenancy redesign here.

## 1. Agent team administration — this increment

- Versioned configurations: stable key, name, role, logical model, specific
  instructions and available/paused setting. No stored credentials per agent.
- Editor-only `/desk/team`, linked from the Desk, with create and edit controls.
- Model IDs come from the scoped Limen key's catalogue. Available configurations
  require a visible model; paused drafts can be saved while Limen is unavailable.
- Configuration does not start work. The page explicitly reports execution as
  not connected. No made-up agents, success metrics or running state.

Acceptance: unauthorized users cannot read or change configurations; retries do
not duplicate versions; concurrent edits conflict; past versions cannot change;
pausing remains possible while the gateway is unavailable.

Deploy: apply `supabase/editorial_team.sql` to canonical VPS PostgreSQL, not
Supabase Auth. It requires the `terraveler_service` role. No live migration is
performed by opening or building the frontend. New configurations have no
effect on the existing worker until step 3. The registry is separate from
external MCP contributor accounts and the public copyable prompt registry:
it stores internal execution configurations, not identities or credentials.

## 2. Verify the dedicated Limen deployment

- Initialize the pinned private submodule, build private wheels and image.
- Provision server credentials, restricted virtual key and a local-only class.
- Choose actual local models, then verify catalogue, generation and policy denial.
- Configure protected TLS connectivity from Vercel and validate the Desk request.

Acceptance: a real approved call passes through Limen; a refused request never
retries directly; no administrative credential reaches the browser. See
`LIMEN_INTEGRATION.md`. This step is pending deployment Git access, runtime
configuration and model selection; checking in a gitlink does not activate it.

## 3. Bind durable tasks to agent versions

- Select an eligible agent for each role; snapshot its exact configuration
  version into the task's execution context and successful trace.
- Implement production handlers with structured outputs and scoped tools.
- Separate immutable system/source rules from editable agent instructions.
- Define suspension semantics, model availability, cancellation and recovery.
- Enforce tool allowlists in code; prompt text cannot grant capabilities.

Acceptance: a recovered task cannot silently switch to a newer configuration;
disabled agents cannot take new tasks; late outputs cannot overwrite a newer
attempt; no configuration receives publication or unrestricted tool authority.

## 4. Automate research, writing and independent review

- Research consolidates explicitly linked contributions with source provenance.
- Writing produces one versioned draft from accepted research results.
- Review checks sources, quotations, rights and editorial requirements.
- Bounded repair cycles send unresolved issues to the editor with an explanation.

Acceptance: one test dossier reaches a reviewable result across process restart;
unsupported claims remain visible and prevent readiness for publication. Model
success is not factual verification. User publication authorization is retained.

## 5. Group proposals into understandable dossiers

- Show one dossier per explicit topic, with its contributions nested beneath it.
- Display goal, latest draft, progress, blocker and next responsible role.
- Keep proposed topic associations reviewable; do not merge similar titles blindly.
- Keep research, reviewed drafts and published voyages distinct.

Acceptance: the editor can understand the state without assembling contributions
or interpreting raw submission types. Historical source material remains reachable.

## 6. Chat with the coordinator

- Ground the chat in the selected dossier and durable work state.
- Translate authorized requests into typed, idempotent tasks or proposed edits.
- Show what was recorded, who owns it and its status after session restart.
- Keep publishing as an explicit human-authorized operation.

Acceptance: a request creates a recoverable job rather than an untracked promise;
configuration changes cannot bypass source policies or publication authority.

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
