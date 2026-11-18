# Backend consolidation — issue #125

Baseline: main `df7186a8dc28a9a9d09ace5e1f27d344e71d8265` (17 November 2026).
This consolidation preserves the preview-only Living Newsroom in PR #119.
It does not replace production UX, activate workers, call models, run production
migrations or change publication authority.

## Disposition

| PR | Decision | Boundary |
|---|---|---|
| #123 | Selectively recover inference budgets and worker truncation tests on current main | Preserve #124 bounded JSON parsing/diagnostics and #122 exact model-scoped keys; supersede the conflicting branch after recovery |
| #104 | Recover public contribution continuity as an explicit canonical dossier association | No parallel project state, automatic backfill or old page/CSS; preserve existing claim eligibility and publication gates |
| #101 | Revalidate offline; keep open until production receipt integration is implemented | Preserve original source/trace lineage; do not import the direct-provider pilot as production research; see PR101_DECISION.md |
| #112 | Already closed as historical audit | Original commit remains accessible; operational documents supersede its implementation snapshot |
| #103 | Generated catalogue work is outside this backend consolidation | Event-level historical review is separate from CI; no automatic merge |
| #119 | Preserve intact, including preview-only and fixture labels | API integration follows backend verification; production replacement requires founder approval |

## Recovered inference behavior

Preparation permits two serial 100-second model calls and declares a 300-second
function duration. Worker production defaults are 120 seconds and 4096 tokens,
with bounded configuration. Explicit length termination is rejected even for
parseable JSON. No automatic retries or additional inference are introduced.
A proxy, hosting plan or model server may impose a lower limit; tests do not
prove production throughput. See EDITORIAL_MODEL_ROUTING.md.

## Public contribution bridge

The existing `editorial_topics` dossier is canonical. The new association links
it to a public `editorial_gaps` work item; it stores no additional project state.
An editor explicitly reconciles an approved idea already attached to a dossier.
Multiple approved ideas in the same dossier share the same public work item.
Existing public gaps can be selected explicitly, rather than duplicated.

No migration backfill or automatic consequence of every approval is introduced.
Approval, attachment, public work-item association, task dispatch and publication
remain distinct observed actions. The bridge creates no editorial task and
cannot authorize publication. A work item marked done is not proof of publication.

The old `claim_gap` path remains authoritative for identity, standing, quotas,
reservations and claim lifetime. A public project link is not claim authority.
MCP submission status reports the association but does not invent a new
`allowed_actions` permission. Source links in a proposal remain candidates.

Migration order and exact API request/response semantics are documented in
LIVING_NEWSROOM_BACKEND_CONTRACT.md. Apply only to canonical VPS PostgreSQL;
Supabase remains identity-only. New API reads must distinguish unlinked records
from unavailable storage. Do not expose private plans, topic objectives, tasks,
results, drafts, model credentials or raw audit findings through public views.

## Rollout and acceptance

1. Revalidate on current main; preserve #119 branch content byte-for-byte.
2. Apply the additive association migration during the established deployment
   procedure; it creates schema only, not historical projects or tasks.
3. Commission one approved idea through existing attachment, then explicitly
   create/reuse its public bridge with a stable request ID.
4. Verify public lookup and MCP status from a fresh session, including negative
   cases and unavailable database behavior. Check existing claim rules unchanged.
5. Use already implemented preparation, dispatch, worker and private preview
   contracts for the pilot; do not infer their activation from this PR.
6. Integrate the approved Living Newsroom in a separate change using those APIs
   and one event projection. Do not copy fixture data into persistent records.

Publication and complete live multi-specialist generation are not certified by
this consolidation. Exact-version human publication, image rights evidence,
ethnohistory, durable preparation recovery and complete external/internal plan
gating retain their existing outstanding status unless independently verified.

## Local validation of this consolidation

- 589 application tests passed with the offline fetch preload.
- 12 PGlite tests passed across receipt/plan, plan dispatch and project bridge.
- 32 Python gateway/handler/corpus/source tests passed without provider calls.
- Production build and TypeScript checks passed; independent review found no
  confirmed remaining blocker in the consolidated runtime changes.
- The #101 historical runner separately passed 29 offline tests; this does not
  certify its production integration or explain its old Jenkins failure.

An initial general-suite run was rejected by automatic review for a potential
external source request. The final application command preloads a guard that
rejects unmocked external `fetch` before transport; loopback TLS fixtures cannot
follow redirects. This is test isolation for fetch-based clients, not an OS
network sandbox. No live source analysis or inference is claimed by these tests.

No production migration, workflow flag activation, VPS change or PR #119 merge
was performed. Hosted checks and protected-branch requirements still apply.
