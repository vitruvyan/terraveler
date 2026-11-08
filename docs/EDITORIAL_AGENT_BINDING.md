# Durable tasks and agent configurations

This implements the binding portion of roadmap step 3. Production research,
writing and review handlers remain unregistered. No model calls start from
this change; tests inject responses. The operator chooses local or explicitly
authorized cloud routes through Limen, never a direct-provider fallback.

## Installation

Apply on canonical VPS PostgreSQL, in order:

1. `supabase/editorial_workflow.sql`
2. `supabase/editorial_team.sql`
3. `supabase/editorial_agent_binding.sql`

The operator already reported applying the first two. The third is new and has
not been applied from this development environment. It replaces claim, renewal
and completion functions. **Do not reapply the older function definitions
afterwards.** Reapplying the binding migration itself preserves history.
Stop old workers before migrating and deploy the matching worker. An old
unbound running task cannot renew or complete under this protocol; after
expiry/recovery its next attempt can acquire a valid binding.

## Assignment and authority

An unbound queued task is eligible only when a current enabled configuration
matches its role. First claim chooses in stable agent-key order. Without one,
the task stays queued and no attempt is consumed. The transaction records an
immutable `editorial_task_agents` link to the exact configuration version.

The claim returns only key, version, name, role, logical model and instructions
as `agent_config`. These fields enter the successful native Motus trace
unchanged. Credentials and save-request internals are excluded. The workflow
detail API exposes binding metadata without instruction bodies or lease tokens.

| Change | Bound task behavior |
| --- | --- |
| Model or instruction edit | Retry retains the original version, model and instructions |
| Pause | No new claim, renewal or acceptance of a new result |
| Role change | Tasks of another role wait; no silent reassignment |
| Enable again with compatible role | Eligible again, using the original pinned configuration |
| Lost completion response | Exact receipt retry returns the accepted result, even after a later pause |

Pausing takes effect at the next authority check. The parent worker renews
periodically and checks again before completion. On loss of authority it
terminates computation and discards output. This is not instantaneous remote
cancellation and cannot retract an external request already sent. The default
heartbeat is 20 seconds. The existing attempt ceiling still applies; exhausted
work requires attention. Administrative reassignment is later work.

Task locks and the same identity lock used by configuration saves serialize
authority checks. Database time is checked after locks, so waiting cannot revive
an expired lease. Frozen history and current permission are separate.

Assignment is a deterministic starting policy, not intelligent routing or load
balancing. A configuration can serve multiple executions. Global/per-agent
quotas and coordinator selection belong to later scheduling work.

## Limen generation port

`orchestration/editorial_gateway.py` prepares generation requests for future role
handlers. It uses the pinned model/instructions plus fixed source rules and
returns candidate material marked `not-verified`. It has no tools, retrieval or
publication authority and is not a complete research/review handler.

Server configuration: `EDITOR_LIMEN_BASE_URL`, `EDITOR_LIMEN_API_KEY`,
`EDITOR_LIMEN_DATA_CLASS`. Use a scoped Limen virtual key, never its master key
or an Anthropic provider key. The model comes from the task, not a mutable model
environment variable. Requests assert documents mode and the configured class;
Limen must authorize the route.

Redirects, denials, timeouts and malformed JSON fail closed. Input/output and
request time are bounded. Failures do not return provider bodies or raw error
messages; configuration repr omits the key. Generated text cannot authorize
publication or establish verification.

## Verification

```sh
npm run test:editorial-db
python3 -m unittest orchestration.test_editorial orchestration.test_editorial_gateway -v
npm test
npx tsc --noEmit
npm run build
```

SQL tests use embedded PostgreSQL, not multi-connection contention on the VPS.
Worker tests use real subprocesses/native Motus with a fencing oracle; gateway
tests inject HTTP responses. No live LLM, production database or deployed
gateway is used. Model validation and runtime deployment remain pending.
