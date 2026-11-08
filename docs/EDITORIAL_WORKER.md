# Durable editorial worker — first foundation

This is a backend foundation, not an operational autonomous newsroom. It adds
recoverable task execution; it does not research, write, review or publish live
content until evidence-bound production handlers have been implemented and
reviewed. The registered production handler map is intentionally empty. A
proposal can become a dossier and a queued research task without inference
starting or an agent silently claiming it.

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

Even with opt-in, `--once` currently returns `no-handlers`. Before registering
production handlers, implement research/writer/reviewer output schemas,
source-policy enforcement, grounding checks, independent review and local
model configuration with no silent cloud fallback. Register reviewed,
importable top-level callables in `PRODUCTION_HANDLERS`; spawn requires them to
be pickleable. The worker supports dependency injection for executable tests.

There is no daemon or compose service enabled by this change. An explicit
scheduler will need to run recovery periodically and workers for supported
roles after deployment validation. Existing human publication authorization is
unchanged; completion of a reviewer task confers no publish capability.

## Current limits

- Successful tasks persist their full Motus trace with the immutable result.
  Failed/terminated attempts persist a bounded error category only; partial
  Motus traces are not yet persisted. Provider exception messages are not saved
  because they may contain credentials or sensitive endpoints.
- No auto-generated facts are accepted as verified evidence by this worker.
- No automatic handoff to the live publication pipeline, no production local
  model handler, no chat wiring, and no daemon deployment are included.
- A crash during inference loses that attempt's unsaved computation. Recovery
  restarts from the last accepted result, not from an arbitrary model token.
- PostgreSQL lease/transaction behavior is exercised separately by the SQL
  tests. Worker tests use actual spawned processes and native Motus with an
  in-memory fencing oracle; they never connect to a live database or model.
