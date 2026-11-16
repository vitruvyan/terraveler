# MCP-first editorial preparation

Status: foundation draft; runtime gate not active. No database migration in this
increment. No production content, worker, publication or source analysis started.

## Required end state

Every new content dossier must first pass Wikipedia orientation and editorial
planning. Wikipedia provides a starting structure; the managing editor adds
missing questions (including itinerary uncertainty and indigenous perspectives).
Work items specify a question, deliverable, specialty, dependencies and evidence
requirements. Routine preparation is agentic; only genuine problems reach the
human. Human publication remains a separate exact-version decision.

Every source analysis must pass through TerraVeler MCP. A listed URL, model
assertion, local seed bundle or direct SQL read is not evidence of MCP consultation.

## Implemented foundation

MCP get_wikipedia_outline reuses the active source registry and governed redirect
checks. It returns one article's readable text, section hierarchy, candidate
external links and exact revision ID from a single MediaWiki parse response.
The text, section and external-link limits have independent truncation flags.
A SHA-256 fingerprint describes the normalized returned snapshot, not an external
proof or persisted receipt. Unsafe URLs and missing/incomplete revisions fail;
there is no browser/direct-source fallback. HTML becomes text, never executable
markup. Empty section trees may identify stubs; the planner must assess suitability.

External links are not automatically a bibliography, consulted sources or
rights-cleared materials. They must be separately inspected through MCP.
The article revision URL provides attribution/version identity; template output
can change independently of the article revision, so the snapshot hash and later
stored bytes are also necessary.

Technical reference: https://www.mediawiki.org/wiki/API:Parsing_wikitext
One action=parse response supplies sections, text, revid and externallinks.

## Next implementation slices, required before runtime activation

1. Trusted append-only MCP consultation records on canonical VPS PostgreSQL.
   Server code owns tool identity, input fingerprint, exact returned bytes/hash,
   retrieval time, governance evidence, upstream revision and coverage. Agents
   reference receipt IDs; they cannot submit a JSON claim that they used MCP.
   A read proves access to content, not intellectual analysis or truth.
2. Persist versioned reconnaissance, editorial plan and independent plan review.
   Each section and work item references trusted consultations. A missing page,
   ambiguous topic, access failure and insufficient article are distinct typed
   outcomes. An access error must not be relabeled as confirmed page absence.
3. Introduce bounded preparation/bootstrap tasks that can run before a plan.
   They cannot write content or grant publication. The planner may propose a
   complementary-source outline only under an explicit exception policy, not
   a caller-supplied skip_wikipedia boolean. Do not add an escape hatch silently.
4. Enforce valid plan/version pinning in enqueue, claim, completion and planning
   dispatch, including editorial_start, editorial_start_pipeline, direct enqueue,
   chat and MCP draft paths. Preserve existing running/historical tasks explicitly.
   Database row locks must prevent plan/version races; idempotent retries retain
   original consultation/plan references. Re-running old migrations cannot restore
   a service RPC bypass.
5. Replace editorial_sources.py direct rag_docs reads with an MCP corpus-reading
   tool preserving current scope, rights and governance checks. Local seed bundles
   must also be served through MCP if they are eligible for new work.
6. Show preparation status and the plan in Projects, then dispatch specialists.
   Test article selection, ambiguity, unavailable MCP, truncation, missing receipts,
   revoked governance, direct-RPC bypasses, stale plan versions and session recovery.
   Run an end-to-end dossier before claiming the new process is operational.

Do not activate a global execution block until the bootstrap path and migration
are tested together. Do not grandfather new specialist work through a legacy route.

## Selective recovery from open PRs

- #101: retain fact-first review, approved fact IDs, immutable checkpoints and
  bounded retry ideas. Its local snapshot/study shortcuts do not satisfy MCP-only
  consultation; adapt before recovery. Do not copy its old AGENTS/SKILLS wholesale.
- #104: preserve proposal -> public Chartroom work -> stable page/agent next step,
  but link these to the canonical editorial dossier rather than building an
  unrelated parallel project identity. No public project page may expose drafts.
- #103: generated world events are unrelated to mandatory preparation. Regenerate
  and validate against current main separately, not as part of this change.
- #112: preserve architectural findings as a dated audit, update completed work
  and link its remaining gaps to this plan. Do not misrepresent old findings as
  current runtime certification.

Old PRs remain open until useful content is recovered or explicitly excluded.

## Verification

Five offline tests cover atomic revision identity, snapshot hashing, independent
limits, malformed/empty responses, governed single-call behavior and destination
rejection. They are authored but not run in the current executor-unavailable
session. CI must validate TypeScript, the full test suite and MCP catalogue parity.
This PR is not a production-ready mandatory gate.
