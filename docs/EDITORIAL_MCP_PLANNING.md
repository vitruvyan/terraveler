# MCP-first editorial preparation

Status: draft; receipt and proposed-plan persistence added. Runtime execution gate
not active. New migration targets canonical VPS PostgreSQL only. No production
content, worker, publication or source analysis started.

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

## Receipt and proposed-plan persistence

Apply `supabase/editorial_mcp_plans.sql` after the current editorial migrations
on canonical VPS PostgreSQL. Back up the database and stop editorial workers for
the coordinated migration. No migration is performed by a frontend deploy.
`npm run test:editorial-mcp-plans` runs the dedicated PGlite suite; Jenkins runs
it after the application tests.

Recording defaults off. After migration and operator review, set
`EDITORIAL_MCP_RECEIPTS_ENABLED=1` on the MCP server and redeploy. The two source
read tools then return `consultation` (opaque ID, database-computed snapshot and
argument hashes, server timestamp). Disabled recording returns null/disabled and
cannot satisfy a receipt-backed plan. An enabled storage failure fails the tool,
never silently returns an eligible unrecorded read.

The stored `response_text` is the exact serialized source snapshot, excluding
its receipt envelope. Only trusted server code holds the service authority to
record it. Public callers cannot submit source bytes, a digest or a receipt ID
to forge a consultation. Private tables are append-only, including update,
delete and truncate, with service SELECT only and writes through fenced RPCs.
This is operational history, not proof against a schema-changing owner.

Persistence is stricter than reading: only effective domain-trusted PD/CC sources
are eligible for raw-text retention, using the existing live registry or explicit
seed PD/CC decisions. Unknown, mixed, revoked, item-verified and link-only sources
cannot have their text stored by this increment. Storage-safe fetch mode checks
this at each redirect hop before fetching, and again before persistence. It does
not turn a per-item source fetch into permission to ingest copyrighted text.
Per-item verified receipts and metadata-only/link-only handling remain future
work. Receipts prove server-mediated reads, not model comprehension, historical
truth, or perpetual rights/governance clearance.

`editorial_save_plan` stores an immutable **proposed** version in an existing
dossier. It requires a complete Wikipedia receipt with a usable section tree,
checks work-item IDs, questions, deliverables, specialties, source receipts and
an acyclic dependency graph, and locks version allocation. Request IDs preserve
exact retries and reject altered intent. Empty source lists represent questions
still awaiting research, never completed analysis. Invalid/truncated orientation
is rejected; missing/ambiguous/insufficient Wikipedia needs a typed exception
workflow rather than a caller-controlled bypass.

The editor-only GET/POST `/api/desk/projects/plan` supports bounded private reads
and validated saves. It is not a public receipt-write API. No UI form, automatic
planner, plan approval or execution dispatch is added here. Proposed plans do not
create tasks, validate historical content, or authorize publication. Routine
plan review is intended to be agentic, not an extra human approval queue.

## Remaining slices before mandatory execution

1. Add bounded agent preparation/bootstrap tasks, plus versioned independent
   plan review and typed missing/ambiguous/unavailable-source outcomes. Preparation
   cannot grant itself execution or publication rights.
2. Pin validated plan versions at enqueue, claim and completion, including
   editorial_start, editorial_start_pipeline, chat, direct RPC and MCP draft
   entry points. Test bypasses, races, stale versions and explicit legacy history.
3. Replace editorial_sources.py direct corpus SQL reads with a governed MCP
   corpus-reading tool preserving current scope and evidence checks. Local seed
   snapshots must also be served through MCP for new work.
4. Record/revalidate policy version and per-item rights evidence at use time;
   add retention limits/deduplicated snapshots and actor quotas before enabling
   high-volume anonymous receipt collection. Current opt-in ledger stores each
   eligible successful consultation separately.
5. Show the plan/preparation stage in Projects, dispatch the specialist graph,
   and run an end-to-end dossier through the existing private preview. No claim
   of mandatory execution compliance is valid until these boundaries pass.

Do not activate a global block until bootstrap and migration are tested together.
Do not grandfather new work silently or introduce a skip_wikipedia flag.

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

The initial orientation increment passed hosted Jenkins and Vercel at feb3e361.
This follow-up adds application tests for server receipts, strict plans, private
API behavior, retention-policy rejection and redirect boundaries. The PGlite
suite exercises hashes, permissions, immutable history, version conflicts,
idempotent replay, missing/truncated receipts, cycles and malformed inputs.
No test requires live source fetches or model generation. Final validation is
recorded in the PR; no production migration or activation is implicit.
