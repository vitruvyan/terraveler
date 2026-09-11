# Chartroom / Waypoint compatibility rollout

## Decision

The current `editorial_gaps` backlog already contains the identity, priority,
claim and lifecycle seam used by MCP. Replacing it would require a coordinated
data migration and would break cached 2025/2026 tool contracts. The Chartroom
therefore ships as an additive compatibility layer.

```text
                     shared knowledge work
                              |
                    ChartroomWaypoint adapter
                       /                 \
              Web UI /account       MCP list_gaps
              Web UI /contribute    MCP claim_gap
                       \                 /
                         editorial_gaps
                              |
                    submissions + audit
                              |
                   human editorial verdict
```

The product term **Waypoint** means an atomic work item. The published atlas
still has geographic voyage waypoints; code uses `ChartroomWaypoint` where the
distinction matters.

## Additive database migration

Apply `supabase/chartroom_waypoints.sql` to the Terraveler PostgreSQL database
on the VPS after the existing governance and identity migrations, specifically:

1. `supabase/governance_schema.sql`
2. `supabase/governance_hardening.sql`
3. `supabase/oauth.sql`
4. `supabase/agent_identity.sql`
5. `supabase/chartroom_waypoints.sql`
6. refresh/restart PostgREST

Production already has the earlier migrations; this list documents the logical
prerequisites rather than instructing operators to replay them blindly.
`governance_hardening.sql` is a required prerequisite because it introduced
`editorial_gaps.claimed_by` and `claimed_at`, which the Chartroom adapter keeps
for MCP compatibility.

The Chartroom migration adds:

- nullable `editorial_gaps.waypoint_type`, backfilled from the legacy `kind`;
- nullable `claimed_by_contributor_id`, backfilled from `claimed_by`;
- `chartroom_waypoints`, a read projection with the new type/status vocabulary;
- `chartroom_follows`, actor-agnostic subscriptions keyed by `contributor_id`;
- `chartroom_take_waypoint`, an atomic quota, claim and audit operation for the
  human web workspace.

No table, enum, status or legacy column is renamed or removed. The application
continues to read legacy-safe columns, so the public pages can precede the SQL
migration. Enable the authenticated Take part and Following actions only after
the migration is applied and PostgREST has refreshed its schema cache.

## Compatibility map

| Legacy kind | Waypoint type |
|---|---|
| `voyage` | `narrative` |
| `waypoint` | `claim` |
| `media` | `image` |
| `perspective` | `challenge` |
| `translation` | `translation` |
| `correction` | `review` |

| Legacy status | Waypoint status |
|---|---|
| `open` | `open` |
| `claimed` | `taken` |
| `done` | `accepted` |

New types (`source`, `map`, `transcription`) can be written to
`waypoint_type` while a compatible legacy `kind` continues serving old clients.
Later lifecycle states (`submitted`, `in_review`, `changes_requested`,
`declined`, `withdrawn`) are defined in the application contract but remain
derived from submissions until a future, separately reviewed state migration.

## Identity and authority

Both humans and agents hold work through a `contributors` row. A human
contributor is rooted directly in `human_principals`; an agent contributor is
rooted in `agent_accounts`. `human_agent_links` is never consulted to resolve
the current contributor or its standing.

One compatibility trap matters during rollout: old OAuth agent contributors can
still carry the legacy `contributors.human_principal_id` value. The web resolver
must therefore exclude every contributor that is already owned by an
`agent_accounts` row before treating a human-principal match as the human's own
standing-bearing identity. New human contributors use a stable pseudonymous
`traveler-*` handle rather than exposing the account email as a public handle;
pre-Chartroom email-backed contributors are adopted only to preserve their
existing contribution history.

The migration adds no publication scope and changes no editorial transition.
MCP still advertises both protocol generations through the existing facade;
`list_gaps`, `claim_gap` and `gap_id` remain stable. The MCP response adds a
`waypoints` field while retaining `curated_gaps` as a compatibility alias.
