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
and validated saves. It is not a public receipt-write API. The optional preparation endpoint below adds a model-generated proposed plan and an independent review. No UI form, execution approval or dispatch is added here. Proposed plans do not
create tasks, validate historical content, or authorize publication. Routine
plan review is intended to be agentic, not an extra human approval queue.

## Bounded preparation increment

After the receipt migration and editorial team migration, apply
`supabase/editorial_preparation.sql` to canonical VPS PostgreSQL. Leave
`EDITORIAL_PREPARATION_ENABLED` off until integration tests pass. Configure
`EDITORIAL_MCP_URL` as the canonical HTTPS /api/mcp endpoint, receipt recording
on that server, scoped Limen and one enabled coordinator and reviewer
(or explicit EDITORIAL_PLANNER_AGENT_KEY / EDITORIAL_PLAN_REVIEWER_AGENT_KEY).
The private POST /api/desk/projects/prepare takes topic_id, expected_version,
request_id and optional wikipedia_url. Without an explicit URL discovery via MCP
auto-selects only a unique exact title; other matches are returned as candidates.
The orientation must have a recorded receipt in canonical PostgreSQL. The
managing editor and reviewer operate on that snapshot and the exact proposed plan.
SQL atomically saves the proposed plan and independent review with pinned
agent version IDs, rejecting changed/paused configurations and invented claims
of completed source analysis. A review verdict is not execution authorization.

The preparation attempt is bounded and synchronous; failed or timed-out
attempts do not enqueue work. Replaying a saved request returns its receipt;
retrying an interrupted request may repeat MCP calls or inference. A durable
bootstrap queue, model-level resolution of ambiguous topics and persisted
failure history remain outstanding. Existing execution is not yet gated;
do not enable mandatory policy yet.

## Task-scoped MCP corpus increment

Apply `supabase/editorial_mcp_corpus.sql` after the workflow, source governance
and RAG migrations. This internal tool is absent from the public catalogue and
requires a dedicated configured key, independent of Limen or database keys.
Set server EDITORIAL_MCP_CORPUS_WORKER_ID to the actual worker identity. Only an
active matching research attempt may read its dossier's approved voyage scope.
The database returns a bounded PD/CC corpus snapshot and immutable receipt
with current endpoint and policy IDs; no source URL, scope or text is accepted
from the caller. Each attempt permits at most three consultations.

Set EDITORIAL_MCP_CORPUS_ENABLED=1 and the same dedicated secret on the server
and worker after validation. The enabled worker uses only this MCP port,
without fallback to direct corpus SQL; its result retains receipt metadata.
Defaults remain disabled. The legacy worker is intentionally unchanged until
mandatory plan dispatch, source discovery for new topics, and completion-time
receipt/policy validation are implemented. This tool is not a general search
engine or a publication decision.

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

## Plan-pinned textual dispatch (production activation separate)

Apply editorial_plan_dispatch.sql after the existing editorial, preparation and
corpus migrations, then editorial_dossier_sources.sql,
editorial_textual_newsroom.sql, editorial_task_retry.sql,
editorial_graph_revisions.sql and editorial_waypoints.sql in that order. The private
/api/desk/projects/dispatch accepts an exact topic_id, plan_id and request_id.
The editor-only /api/desk/projects/retry can grant one additional attempt to an
exhausted planned task in attention, with an expected-attempt check, idempotency
and an immutable authorization event; it does not reset history or create a new run.
Set EDITORIAL_PLAN_DISPATCH_ENABLED and EDITORIAL_MCP_CORPUS_ENABLED only after
integration, with the worker configured for MCP. The database retains the legacy
history/diary/factcheck pilot and supports one to four textual research items,
one diary and one editorial, plus one copyedit and one factcheck for each writer.
Every specialty used must have exactly one enabled specialist configuration.
The planner proposes only research; deterministic code composes the fixed
downstream graph before independent review.

Dispatch records every dependency, pins exact plan and agent versions, isolates
results from other graphs, and uses the existing worker leases and private
preview. Unsupported specialisms or shapes fail closed; they are not silently
dropped. A changes-requested review set creates a new writer revision only after
all reviews targeting that draft are complete. The revised writer receives the
immutable prior draft and composed issues with their source review IDs; fresh
review tasks are created after the new draft completes. Research stays at
revision zero. Two automatic revisions per writer are the hard limit: another
changes-requested set then leaves the run in attention. Any blocked review set
stops without revision. Only latest-revision reviews determine awaiting-editor;
no verdict publishes. The graph status endpoint is private and is not yet
integrated in Projects UI.

The waypoint migration aggregates itinerary candidates in bounded graph context
and requires dependent writer drafts to preserve exactly the researched route.
Reviewers enforce that equality. Limen receives a closed itinerary schema; SQL
caps context at 40 waypoints and 40,000 bytes. The preview maps only sanitized
committed candidates with their sources and uncertainty, never raw model envelopes.
Points and connecting lines are not verified geography or publication authority.

During an approved maintenance window, stop workers, resolve active legacy
work and apply the migrations. The owner-only editorial_enable_plan_gate()
then refuses any new legacy internal task insertion. The flag is off by default.
This gate covers the internal durable task path, not the external contributor
MCP submit/publication flows, which remain separate. Do not enable until the
complete pilot and UI integration are verified. Existing completed history is
retained. No external publication authority is created.

The graph integration test uses fresh Python processes for the actual three
handlers and the MCP corpus client, with offline model/transport fixtures and
PGlite SQL. It is not evidence of a live Cabeza de Vaca dossier or VPS readiness.

## Governed Commons image consultation (`wikimedia_api`)

`search_commons_images` and `fetch_commons_image` (lib/commonsImages.ts) give the
editorial flow a governed path to Wikimedia Commons images. Commons stays
registered with mixed licensing, so no domain decision makes a file usable:
each file is verified from the Commons API's own licence metadata. Public
domain, CC0, CC BY and CC BY-SA are accepted; non-commercial, no-derivatives,
non-free, GFDL-only and unrecognized licences are refused with an explicit
reason, never relabelled.

- A search result is a candidate, not a consultation, and records nothing.
- `fetch_commons_image` returns one revision-bound snapshot (page and revision
  IDs, SHA-1, original on upload.wikimedia.org, thumbnail on upload or
  thumb.wikimedia.org without tracking parameters, licence, artist, credit,
  Commons' recorded date, description, restrictions). With receipt recording
  enabled it is stored in `editorial_mcp_consultations` under its own tool;
  migration `supabase/editorial_commons_images.sql` validates the per-file
  licence, hosts and identity in SQL. A Commons receipt can never pass as a
  text-source receipt.
- Commons' `DateTimeOriginal` is a claim recorded on Commons. It is often the
  upload or scan date of a reproduction (a 1591 engraving can carry 2015), so
  it never proves that an image is contemporary with an event.
- Nothing here inspects pixels or describes an image. Selection, ranking and
  captions belong to the Photo editor and Image text editor specialists, which
  are not yet executable.
