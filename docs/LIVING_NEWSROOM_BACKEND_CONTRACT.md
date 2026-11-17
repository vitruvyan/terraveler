# Living Newsroom: backend integration boundary

Reference: issue #125 and PR #119. This document specifies reuse boundaries for
the next integration, not a new runtime or approval workflow. PR #119 remains a
fixture-only preview and is not modified by the backend consolidation.

## Reuse the canonical records

| Screen concept | Existing record/API | Authority and caveat |
|---|---|---|
| Briefing / admin overview | GET /api/desk/dashboard | Editor-only; unavailable sources are not zero activity |
| Wall ideas | Existing submissions and /api/contribute or governed agent write seam | No second proposal store; approval is not task execution or publication |
| Project / dossier | GET/POST /api/desk/projects | editorial_topics and immutable topic submission snapshots; attachment groups by stable identity |
| Preparation | POST /api/desk/projects/prepare | Versioned plan, MCP orientation and independent review; enabled gates and supported models required |
| Plan history | GET/POST /api/desk/projects/plan | Exact persisted versions; proposing is not permission to execute |
| Planned work graph | GET/POST /api/desk/projects/dispatch | Exact plan, specialist bindings and dependency graph; optional bounded pilot |
| Team / models | /api/desk/team | Configurations and scoped catalogue; enabled/configured does not mean running/healthy |
| Conversation | /api/desk/projects/chat | Existing typed actions and persistent messages; no arbitrary tool authority |
| Draft review | Existing private project preview and immutable result IDs | Never expose the private draft or matching review through public project data |
| Public work association | POST /api/desk/projects/bridge; GET /api/projects/[gapId] | Explicit canonical association; existing claims remain authoritative |
| External crew / standing | /api/crew and existing contributor identity | Standing reflects observed governance records; last seen is not work completed |

The API list above is a map of existing contracts, not a promise every handler
or feature flag is activated. Inspect each route's method/auth/body contract
before connecting the UI. Production UX replacement still needs founder approval.

## Public contribution continuity recovered from #104

After attaching an approved idea with the existing project action, the editor
may call:

```json
{
  "topic_id": 1,
  "submission_id": 111,
  "request_id": "project-bridge-cabeza-0001"
}
```

An optional `gap_id` selects a known existing public work item explicitly. The
server verifies current approval, idea type and exact dossier membership. It
must not infer membership from a similar title. A repeated request preserves
intent; changed topic/submission/selected gap is a conflict. The migration does
not reconcile historical records automatically.

Public lookup exposes only a whitelisted project association and existing
public work metadata. The association does not expose dossier objectives,
private artifacts, prompts, source bodies, raw logs, tokens or email addresses.
MCP get_submission_status may point to this resource without granting claim
permission. Agents consult the existing list_gaps/get_contract/claim_gap flow,
which retains standing, quotas, reservations and ownership checks.

## One event projection, two server-enforced audiences

The event projection is the remaining backend/frontend seam. It is NOT added
as a running event service by this consolidation. Build it from existing
immutable task events, accepted results, preparation/graph records and approved
contribution audit records; do not duplicate them into an unrelated newsroom
activity lifecycle.

A shared event DTO should carry stable origin/id, persisted timestamp, canonical
project reference, event category and evidence/artifact reference. Projection
version and cursor rules must be specified before clients depend on it.

- The admin endpoint requires editor authorization and returns only operational
  fields needed by the UI. Sanitize logs at the server; authentication is not
  permission to expose credentials, raw provider responses or private reasoning.
- The public endpoint uses a strict server allowlist and only associated public
  work/approved contributions. Do not download an admin stream and hide fields
  in JavaScript. Do not infer public permission from a client toggle.
- Show external agent work only when TerraVeler observed a contribution, claim,
  review or other recorded action. Provider identity and last-seen activity are
  not evidence of research or completion.
- A research journal is an evidence-linked summary/artifact, not hidden
  chain-of-thought or a stream invented for visual effect.
- Approved evidence and governance records determine reputation. Synthetic
  activity remains labelled preview fixtures, never production telemetry.
- Missing/failed reads must produce an explicit unavailable state. Polling is
  sufficient initially; add SSE only after event ordering, redaction and retry
  semantics are stable.

## Marginal notes and exact revision identity

Use the existing contribution seam, preserving article ID, immutable draft or
published revision ID, and a stable block/paragraph anchor. A note targets the
revision actually read. Do not attach solely by paragraph text or current
position, silently move notes to later revisions, or create a second unreviewed
publishing path. Define orphaned/changed-block behavior during integration.

## Acceptance before replacing preview fixtures

- Same canonical topic appears in Projects, the public work item and the
  applicable submission status; no guessed relations or duplicate dossiers.
- Refresh/new session preserves work and identifies the next authorized action.
- Public requests cannot obtain drafts, objectives, prompts, private logs or
  operator/model credentials, even by querying raw API paths.
- Editor can inspect a complete private artifact and matching revision-specific
  review, then request a change in context. No chat action silently publishes.
- Existing claim/standing tests and publication gates remain unchanged.
- Preview-only routes and production pages preserve their current behavior
  until a separately approved integration is deployed.
