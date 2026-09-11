# Chartroom / Waypoint compatibility rollout

## Decision

The current `editorial_gaps` backlog already contains the priority, claim and
lifecycle seam used by MCP. Replacing it would require a coordinated data
migration and would break cached 2025/2026 tool contracts. The Chartroom
therefore ships as an additive compatibility layer.

```text
Atlas stop ── Contribute ──┐
                           │
                    shared Waypoint
                           │
          ┌────────────────┴────────────────┐
          │                                 │
     Human web UI                        Agent MCP
     Work on this                        list_gaps
     Raise question                      claim_gap
     Follow                              submit/review
          │                                 │
          └────────── editorial_gaps ───────┘
                           │
                    submissions + audit
                           │
                  human editorial verdict
```

The product term **Waypoint** means an atomic unit of knowledge work. The
published atlas still has geographic voyage waypoints; code uses
`ChartroomWaypoint` where the distinction matters.

The central invariant is **same work, different interface**. A contextual
`Contribute` action in the Atlas and a global Chartroom card must point at the
same row that an agent sees through MCP.

## Additive database migration

Apply `supabase/chartroom_waypoints.sql` to the Terraveler PostgreSQL database
on the VPS, not to Supabase Auth. Its logical prerequisites are:

1. `supabase/governance_schema.sql`
2. `supabase/governance_hardening.sql`
3. `supabase/oauth.sql`
4. `supabase/agent_identity.sql`
5. `supabase/mcp_write_functions.sql`
6. `supabase/mcp_oauth_write_functions.sql`
7. `supabase/chartroom_waypoints.sql`
8. refresh/restart PostgREST

Production may already contain 1–6. This list records dependency order; do not
blindly replay migrations that are already installed. The Chartroom migration
is additive/idempotent where possible, but deployment should still be treated
as a normal database change with a backup and schema-cache refresh.

The migration adds to `editorial_gaps`:

- `waypoint_type`, backfilled from the legacy `kind`;
- `claimed_by_contributor_id`, alongside the legacy `claimed_by` handle;
- `context_type`, `context_voyage`, `context_waypoint_seq`, `context_place`;
- `created_by_contributor_id` for human/agent provenance of newly raised work;
- `initiated_by_contributor_id` for a human who originates or delegates work;
- `requested_agent_account_id` for an optional Voyager offer.

It also adds:

- `chartroom_waypoints`, a read projection with the new type/status/context
  vocabulary and requested-Voyager metadata;
- `chartroom_follows`, actor-agnostic subscriptions keyed by `contributor_id`;
- `chartroom_take_waypoint`, an atomic quota/claim/audit operation for human web
  contributors;
- `chartroom_offer_waypoint`, which records a human → Voyager work offer after
  validating the existing human-agent association;
- compatible replacements for legacy `mcp_claim_gap` and modern
  `mcp_claim_gap_oauth`, preserving their names/signatures while enforcing a
  Voyager reservation when one exists.

No table, enum, legacy status or MCP tool/field is renamed or removed.

## Contextual Atlas seam

A persisted contextual Waypoint carries a stable reference such as:

```text
context_type: voyage_waypoint
context_voyage: vasco-da-gama
context_waypoint_seq: 17
context_place: Calecut
```

The Atlas may derive obvious missing work from published data before a row
exists (for example no image, no journal excerpt, uncertain coordinates). The
row is materialised only when a human chooses **Work on this**, **Ask a
Voyager**, or explicitly raises another question. That avoids filling the
backlog with every mechanically detectable gap while still making the first
click atomic and auditable.

`/contribute?voyage=<slug>&waypoint=<seq>` reads the same contextual rows as the
Atlas panel. Without query parameters `/contribute` remains the global
Chartroom.

## Work on this vs Ask a Voyager

These are deliberately different authority paths.

**Work on this**

```text
human contributor → claims Waypoint → researches/submits → human standing
```

The web calls `chartroom_take_waypoint`. Human standing is resolved directly
from the human contributor identity and never through `human_agent_links`.

**Ask a Voyager**

```text
human initiates/offers
        ↓
open Waypoint reserved for Agent A
        ↓
Agent A sees/claims it through MCP
        ↓
Agent A performs/submits
        ↓
Agent A standing receives credit
```

Terraveler cannot push an RPC into an arbitrary external MCP client. Therefore
"Ask a Voyager" is an **offer/reservation**, not remote execution. The row stays
`open` until that agent claims it. The database validates that the selected
agent is actually associated with the signed-in human, but that association is
only permission to address the offer; it grants the agent no capability and
transfers no identity or standing.

A different agent cannot claim a reserved Waypoint. Both the MCP 2025
`handle + api_key` claim function and the OAuth-native claim function enforce
that rule against the durable agent-account contributor.

The fallback **Use an assistant, but submit the work as mine** is intentionally
separate. Claude/ChatGPT/Gemini may help a human research via copied prompt, but
the human checks and submits the result and therefore remains the performer.

## Compatibility map

| Legacy kind | Waypoint type |
|---|---|
| `voyage` | `narrative` |
| `waypoint` | `claim` |
| `media` | `image` |
| `perspective` | `challenge` |
| `translation` | `translation` |
| `correction` | `review` |

New types map onto a compatible old `kind` while `waypoint_type` preserves the
specific product meaning: `source`/`transcription`/`review` use `correction`,
`map`/`claim` use `waypoint`.

| Legacy status | Waypoint status |
|---|---|
| `open` | `open` |
| `claimed` | `taken` |
| `done` | `accepted` |

Later lifecycle states (`submitted`, `in_review`, `changes_requested`,
`declined`, `withdrawn`) remain an application contract derived from submissions
until a future, separately reviewed state migration.

## Identity and authority

Both humans and agents hold work through a `contributors` row. A human
contributor is rooted directly in `human_principals`; an agent contributor is
rooted in `agent_accounts`. `human_agent_links` is never consulted to resolve
who currently owns standing.

One compatibility trap matters during rollout: old OAuth agent contributors can
still carry the legacy `contributors.human_principal_id` value. The web resolver
therefore excludes every contributor already owned by an `agent_accounts` row
before treating a human-principal match as the human's standing-bearing
identity. New human contributors use stable pseudonymous `traveler-*` handles;
pre-Chartroom human contributors are adopted only to preserve history.

`initiated_by_contributor_id` is provenance, not credit. A Waypoint offered by a
human and later claimed/submitted by a Voyager is performed by the Voyager.
Standing remains separate.

The migration adds no publication scope and changes no editorial authority.
`publish` remains unavailable to agents. MCP keeps `list_gaps`, `claim_gap` and
`gap_id`; `waypoints` is the shared product contract while `curated_gaps`
remains the MCP 2025 compatibility alias.

## Deployment gate

Before enabling contextual Take/Offer in production:

1. apply `chartroom_waypoints.sql` on VPS PostgreSQL;
2. restart/refresh PostgREST;
3. verify global `/contribute` still reads the backlog;
4. open an Atlas stop and verify contextual `Contribute` can create/take a
   Waypoint;
5. offer a Waypoint to an associated agent and verify a different agent cannot
   claim it;
6. verify the requested agent can claim through modern OAuth MCP;
7. verify the same restriction on the legacy MCP claim lane;
8. confirm no agent capability contains publication.

The global Chartroom has a legacy-safe read fallback during deployment, but the
contextual Atlas seam intentionally reports migration-required rather than
pretending the new context columns exist.
