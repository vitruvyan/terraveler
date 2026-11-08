# Durable editorial work: first increment

The dossier is the shared identity of an editorial subject. Several approved
submissions can enter one dossier through an **explicit topic key**. Similar
titles do not silently merge articles. Each linked contribution retains its
approved submission snapshot and receives an intake research task. The shared
objective and title are immutable in this increment: changed scope needs a
deliberate future versioning operation, not an accidental overwrite on retry.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| Canonical VPS PostgreSQL | Dossiers, source snapshots, tasks, leases, results, execution traces and task history |
| Motus worker | Auditable execution of a registered task handler |
| Redis Streams | Existing event bus; not required for correctness of the new polling worker |
| Next.js Desk API | Editor-only bootstrap and bounded status reads |
| Human editor | Final publication authorization through the existing publishing process |

Kafka is not needed for this increment. A second event platform adds deployment
and recovery work without replacing transactional state or idempotent consumers.
Reconsider it only with measured throughput, retention or independent-consumer
requirements that the existing bus cannot meet.

## Install and enable

1. Review and apply `supabase/editorial_workflow.sql` to the **canonical VPS
   PostgreSQL**, after `governance_schema.sql`. Never apply it to the Supabase
   identity project. The runtime role is `terraveler_service`.
2. Reload the PostgREST schema (the migration sends the reload notification).
3. Set `EDITORIAL_WORKFLOW_ENABLED=1` on the Next.js server to allow bootstrap.
   Without it the POST fails closed. GET is authenticated and returns 503 when
   the schema is missing. Neither endpoint invokes a model.
4. Configure and register real worker handlers separately, using
   `EDITORIAL_WORKER.md`. No production model handler is included or activated
   by applying this migration. An unconfigured worker must not claim work.

Authenticated editor request to `POST /api/desk/workflow`:

```json
{
  "submission_id": 111,
  "topic_key": "cabeza-de-vaca-1527-1536",
  "title": "Cabeza de Vaca and Estebanico",
  "objective": "Reconcile the approved Spanish sources and Haniel Long interpretation into one sourced draft."
}
```

This is an example, **not an assertion about submission 111 in production**.
Only an approved submission is eligible. Repeating identical input reuses its
topic and task. Attaching another approved submission with the same topic key,
title and objective adds its snapshot and intake task to the shared dossier.
Conflicting metadata or a source already attached elsewhere is rejected.

`GET /api/desk/workflow` lists up to 100 dossiers, newest first. Use returned
`next_before` as `?before=...` for the next page. `?topic_id=...` returns a
dossier, task status page and up to 100 recent result metadata records; it does
not download trace bodies. Its cursor paginates tasks, and `results_truncated`
explicitly indicates a potentially incomplete result summary. The database is
the authoritative store of full artifacts and history. This increment does not
add UI controls or expose worker RPCs to browsers or MCP agents.

## Recovery and limits

Claims use database time and a unique lease token per attempt. Renewal,
completion and failure are fenced by that token and lease expiry. A worker
returning late cannot overwrite the next attempt. A completion repeated after
a lost response returns the existing result only for matching token, artifact
and trace. History and artifacts are append-only for ordinary operation;
database owners can still alter schema, so this is not independent notarization.

Expired claims can be requeued, with an attempt ceiling that ultimately sends
the task to `attention`. Failed predecessors block dependent work. Generated
results remain candidates; a completed reviewer task cannot authorize a
publication. This foundation has no automatic research → writing → review
scheduler, retrieval/research tools, model selection or editorial quality
policy yet. Those are the next increment, built on this durable protocol.

Run `npm test`, `npm run test:editorial-db`, TypeScript checks and the Python
worker tests before deployment. SQL tests use an embedded PostgreSQL engine;
they do not substitute for deployment verification against the VPS/PostgREST.
Disable new bootstrap and stop workers to roll back behavior; preserve the
additive tables and their history rather than dropping recorded work.
