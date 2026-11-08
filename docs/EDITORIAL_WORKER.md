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
