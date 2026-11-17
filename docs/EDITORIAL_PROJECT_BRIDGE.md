# Canonical dossier ↔ public contribution work item

Issue #125 selectively recovers PR #104's continuity requirement without adopting
its parallel project lifecycle or automatic approval backfill. `editorial_topics`
remains the canonical editorial dossier. `editorial_gaps` remains the existing
public Chartroom/MCP contribution work item, including its established claim,
quota, reservation, expiry and audit behavior. The bridge is an association,
not a scheduler, second state machine or publication decision.

## Explicit reconciliation

Apply `supabase/editorial_project_bridge.sql` on canonical VPS PostgreSQL after
`editorial_pipeline.sql` and the Chartroom migrations, following existing backup
and migration procedures. No historical data is backfilled. Reapplying the
migration does not create work items or rewrite links.

The editor first attaches an approved proposal to the intended existing dossier
through the current Projects `attach` operation. Then call:

```http
POST /api/desk/projects/bridge
Content-Type: application/json

{"topic_id":1,"submission_id":111,"request_id":"cabeza-project-bridge-001","gap_id":null}
```

Use actual existing IDs. The example is a request shape, not evidence that these
records are attached or that reconciliation has run on production.

The endpoint requires editor authentication, same-origin requests when an Origin
is present, bounded JSON and a strict schema. The SQL RPC independently requires
an approved `idea` already attached to that exact topic. It never creates a new
topic, guesses relations from a title, enqueues a task or publishes content.

One dossier maps to one public work item. Additional approved ideas attached to
the same dossier reuse that work item. `gap_id` can explicitly select an existing
public work item for reconciliation. Without it, a legacy work item is reused
only by its exact `source_submission_id`; otherwise the RPC creates one with the
approved idea's title and a generic notice that research remains to be done.
It does not copy private objectives, source bodies or drafts into the description.

The unique topic/gap association and request ledger are immutable. Request IDs
replay their recorded identity and reject changed intent. New requests require
current approval. Existing work item's claim/status is not altered. Source rows
are locked before the topic row to match the existing attachment lock ordering.
PGlite tests cover sequential idempotency and integrity; they do not constitute
live PostgreSQL multi-session concurrency testing.

This is intentionally an explicit editor reconciliation step. Approval alone
still does not silently create a work item. The future commissioning integration
can call the same typed operation after choosing a dossier; do not introduce a
second automatic lifecycle in a UI callback or a new approval migration.

## Public read and MCP status

`GET /api/projects/<gap_id>` returns a whitelisted public projection only for a
linked work item whose origin is still an approved idea attached to the same
dossier. The output includes the public title/description, identifiers, observed
claim status and next-step guidance. A rejected/revoked origin is not returned.
Missing linkage returns 404; backend/schema failures return 503, not an invented
empty project. Responses use `Cache-Control: no-store`.

`getSubmissionProject` supplies the same projection to MCP submission status.
It returns null when no currently public link exists, and throws on read failure.
The caller must preserve the difference between unlinked and unavailable.
No helper authorizes a claim: it directs agents to `list_gaps` and `get_contract`
for current eligibility and the unchanged `claim_gap` flow. Claimed or done work
is not proof of an internal worker running or a voyage being published.

This increment provides a stable public API, not a `/project/<id>` page. The
founder-approved PR #119 Living Newsroom prototype remains untouched; a later
adapter can consume this contract and existing dossier/task APIs. Never make
private plans, task results or draft text public by reusing an admin response.

## Validation

- `test/editorial-project-bridge.test.ts`: strict request/RPC shape, response
  whitelist, revocation, null/error distinction, private write authentication,
  origin protection and public read-only/error behavior.
- `test/editorial-project-bridge-sql.test.mjs`: no backfill/enqueue/publication,
  exact retries, multiple contributions in one dossier, explicit legacy reuse,
  claim preservation, invalid approval/type/membership rejection, conflicting
  links, broad-default-privilege revocation, append-only history and reapplication.

No provider inference, live database mutation or UX deployment is required by
these tests. The legacy PR remains the historical comparison source; its old
bulk SQL and UI should not be merged as-is.
