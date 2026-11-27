# Durable editorial worker — first foundation

The worker implements recoverable, explicitly enabled candidate research, writing
and review. It has no publication authority. The operator runbook and migration
order are in [EDITORIAL_PIPELINE.md](EDITORIAL_PIPELINE.md). Live gateway/model
execution and production deployment remain unverified.

## Authority and state

Apply `supabase/editorial_workflow.sql` to the **canonical VPS PostgreSQL**,
not the Supabase Auth database. SQL owns dossier membership, task dependencies,
lease tokens, deadlines, bounded attempts, immutable accepted results and
recovery. Each RPC is one short transaction. Workers never keep a transaction
or database connection open during model inference.

The worker polls PostgreSQL using `editorial_claim`, `editorial_renew`,
`editorial_complete`, `editorial_fail` and `editorial_recover`. A future Redis
notification can reduce wake-up latency; it cannot establish ownership or
replace a periodic PostgreSQL scan. Kafka is not required for this increment.

Only registered roles are sent to claim. An empty registry leaves the backlog
untouched. Each task is executed as a native Motus `GraphSpec`/`Runtime` graph
with a recorded effect: the trace proves what was supplied and returned, not
that claims are historically correct or verified by pure replay. A generated
result must never be relabelled verified just because the run succeeded.

For plan-dispatched writer tasks, a completed changes-requested review set can
schedule a revision automatically. The worker treats it as a new immutable task,
not an in-place result update: input includes the previous draft, composed review
issues and source review IDs, while the normal graph context supplies research.
Fresh review tasks follow the revised draft. Scheduling stops on blocked or after
two revisions; there is no unbounded worker loop and no automatic publication.

Itinerary research uses a closed waypoint schema: unique IDs and sequences, finite
bounded coordinates, valid partial dates, known source IDs and explicit uncertainty
for approximate or reconstructed locations. Only the itinerary researcher proposes
this route. SQL passes it unchanged to dependent writers, and reviewers reject a
draft whose route differs. The preview renders these as private candidates, not
verified geography; connecting lines are sequence guides, not navigation tracks.

The handler receives explicit task/topic/source/dependency context, excluding
the worker's lease token. Its output and full successful Motus trace are saved
by the parent through one fenced completion RPC. A late process cannot accept
its own output. A fresh renew plus the completion RPC's token/expiry check
protect the gap between inference and persistence. If a DB request fails, the
worker stops; expired work remains recoverable in PostgreSQL. If completion
committed but its response was lost, PostgreSQL's idempotent completion accepts
an exact retry; no external side effect should be repeated to "fix" it.

Each handler runs in a spawned child process; the parent renews the lease while
inference runs and terminates the child on timeout or lease loss. This enforces
a task deadline. It is **not a security sandbox**: handlers are trusted Python
code and must expose read-only, policy-enforced retrieval/model tools. Only the
parent commits an editorial result. No publish, git, filesystem mutation or
unrestricted tool runner belongs in a handler. External calls still need their
own connect/read deadlines.

## Running and verification

Install the same pinned dependencies used by the repository:

```sh
python -m pip install officers/wheels/vitruvyan_motus-0.14.0-py3-none-any.whl psycopg2-binary==2.9.10
python -m unittest orchestration.test_editorial -v
```

Default invocation makes no DB connection and claims nothing:

```sh
python -m orchestration.editorial --once
```

After the migration, use canonical database service credentials through the
normal libpq `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` environment
configuration. Do not copy credentials into prompts, source or traces. Recovery
is explicit and does not run any model:

```sh
EDITORIAL_WORKER_ENABLED=1 python -m orchestration.editorial --recover
```

This recovers only expired leases. A task that exhausted its attempt budget needs
the separate editor-only `/api/desk/projects/retry` authorization after the cause
has been resolved. That operation grants one additional attempt and records an
immutable audit event; neither path is an automatic model retry.

With only the worker gate enabled, `--once` returns `no-handlers`. Set
`EDITORIAL_HANDLERS_ENABLED=1` as well to register the reviewed top-level role
handlers. `EDITORIAL_HANDLER_ROLES` optionally restricts claims to a comma-separated
subset of `research,writer,reviewer`. Limen configuration and eligible versioned
agents are also required. No direct-provider fallback is available.

`--serve` explicitly opts into continuous polling and periodic expired-lease
recovery. SIGTERM/SIGINT interrupt the idle wait; an in-progress task first ends
or reaches its bounded deadline. The optional `compose.editorial.yml` profile
provides this entry point, disabled by default and without automatic restart.

## Current limits

- Successful tasks persist their full Motus trace with the immutable result.
  Failed/terminated attempts persist a bounded error category only; partial
  Motus traces are not yet persisted. Provider exception messages are not saved
  because they may contain credentials or sensitive endpoints.
- No auto-generated facts are accepted as verified evidence by this worker.
- No automatic handoff to the live publication pipeline is included. Candidate
  completion and coordinator chat never authorize publication. The optional
  worker deployment still needs live operator verification.
- A crash during inference loses that attempt's unsaved computation. Recovery
  restarts from the last accepted result, not from an arbitrary model token.
- PostgreSQL lease/transaction behavior is exercised separately by the SQL
  tests. Worker tests use actual spawned processes and native Motus with an
  in-memory fencing oracle; they never connect to a live database or model.

## Photo editor (iconography)

Every composed plan carries one fixed `iconography-images` research item that
depends on all textual research. Its handler (orchestration/editorial_iconography.py)
does not read the textual corpus:

1. the configured model proposes two to four short Commons search queries from
   a bounded summary of the researched findings and waypoint places (full
   research snapshots are not sent);
2. `search_commons_images` returns candidates with per-file licence decisions
   (public domain, CC0, CC BY, CC BY-SA only);
3. up to twelve usable candidates are read with `fetch_commons_image`, each
   recording its own consultation receipt; recording must be enabled, otherwise
   the task fails with `editorial-image-receipt-required`;
4. the model selects zero to eight images, citing only those receipt IDs
   (schema enum) and judging from metadata alone: depiction class, relevance and
   caution. It cannot see the images;
5. trusted code copies each receipt's exact snapshot into the result.

SQL (`supabase/editorial_iconography.sql`) accepts the result only if every
selection equals a `fetch_commons_image` receipt recorded after the attempt's
claim, with an exact snapshot and digest, a closed depiction class and no
quotation marks. An empty selection must state why. Only the caption writer may
depend on the iconography item; textual writers never receive image selections
as research.

## Image text editor (caption)

The fixed `captions` writer depends only on `iconography-images`. SQL gives it,
and its copyedit and factcheck reviewers, the receipt-re-verified image
selection instead of research. Its draft is a `draft` with `format: "captions"`,
so bounded revisions and the review composition work unchanged: one caption
(≤600 characters) and alt text (≤300) per selected image, in selection order,
paraphrase only, written from Commons metadata and the Photo editor judgment.
Each entry carries an `image` block (URLs, size, artist, credit, Commons date,
licence, depiction) that trusted code copies from the selection and SQL
recomputes with `editorial_image_display`; a model can never write it. An empty
selection yields an empty caption draft without a model call. Caption reviewers
must name the receipt ID in each issue and may not ask for images to be added.

The Desk preview shows these as plates from the same plan run as the draft being
read (thumbnails only from upload/thumb.wikimedia.org), labelling the date as
Commons' and the depiction as the Photo editor's judgment.

Commons' recorded date is a claim, often a scan or upload date. A sample of
eight real Commons images showed nomic-vision zero-shot labels reliable for
period works but wrong for every modern image, so no visual classification is
used; depiction is a metadata judgment for editor and fact-check review.
