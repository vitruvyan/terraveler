# Living Newsroom — preview-only UX laboratory

Open /living-newsroom on the Vercel Preview deployment directly; no Terraveler editor session is required for this fixture-only route. Vercel deployment protection, if configured, still applies. The original /specimen/living-newsroom route retains the existing editor session gate. Local development is also permitted. Production deliberately returns not found. The current desk, atlas, log and crew remain unchanged.

This increment is a design prototype, not an editorial backend. All records are static fixtures. Interactions are in memory and reset on refresh. No new database, requests to editorial APIs, external agent calls, or publication operations. Timeline replay is labelled, not live; the public toggle is a simulation within the private lab, not an authorization boundary.

## Demo walkthrough

1. Desk: briefing, project drill-down, Wall and inbox counters.
2. Wall: create an idea; discuss with local comments; save, dismiss and restore; accept into a sandbox project. A fixture project indicates Wikipedia orientation and plan as its next step, without executing it.
3. Crew: filter members by origin; expand profile; replay, pause, resume and filter events; compare editor/public projections.
4. Reading excerpt: use the official favicon in the paragraph margin, accessible via keyboard or touch; compose a note. Open inbox to resolve/reopen it.
5. Responsive: check paper theme, 390px phone and desktop; check no overflow, visible focus and reading margins.

## Integration after design approval

Audit existing proposal and contribution APIs, immutable draft IDs, paragraph anchors, dossier tasks, receipts, and /api/crew before choosing a durable event projection. Do not add a parallel proposal or identity store. Never imply agent work from last-seen alone; external actions must be observed in Terraveler. Enforce server-side public redaction, source rights and approval gates. Reuse actual contribution composer and official favicon; do not replace the existing reading UI until integration is tested.

The new route is the interactive specimen for the proposed screens and their empty/decision states. Global CSS and the current routes are not changed. Do not merge this design PR until the user approves the preview and integration is planned.

## Connected increment — November 18

- /living-newsroom remains the original unauthenticated fixture laboratory.
- /living-newsroom/live is the connected editor preview. Session checked/renewed through /api/desk/me; /api/desk/newsroom-preview independently checks requireEditor on every read. No private response is embedded in a public page or cached. /living-newsroom/chartroom requests only existing public /api/crew; no private API requests. All three routes are closed in production.
- Reuse readAdminDashboard, editorial topics, dispatch view, existing submission/decision and contributor records. Existing workflow links deliberately reuse the real authorized controls; the new preview itself is read-only. Wall ideas are not a new store. Open tasks and registry limited to 100, event window 80, intents 60, graph runs 100. Unavailable independent reads are explicitly distinguished from empty arrays. Poll every 45 seconds while visible.
- Admin task-event projection is a bounded preview adapter, not a raw Linux stream or a production public event service. Strict selected fields, no detail, trace, lease token, worker id, prompts or provider output. Task's immutable agent binding is an association, not evidence of the event author. Public activity uses observed governance records only. No synthetic internal activity or new public permissions.
- Research journal and durable revision-bound notes remain unconnected. Evidence-linked summaries and reviewed public discoveries require a separate persisted contract. No chain-of-thought, no shell actions, no migrations or model calls.
- Verify on preview: guest direct fixture and Chartroom; anonymous/ordinary account denied editor records; editor login opens connected desk, wall, projects, crew and inbox; collapse/expand cards and inspect filtered events; distinguish missing DB views from empty state; mobile layout and existing project links. Existing production pages are unchanged. Hosted build/tests pending.

## Illustrated wall increment

The fixture and connected wall share WallArtwork and a curated local cover registry (lib/editorialWallArtwork.ts). Known topics have explicit art assignments; unmatched/ambiguous topics use a generic original cartographic motif. Existing public-domain maps and their source links are reused as labelled contextual illustrations where appropriate, never as evidence for the proposal. The four original color covers (Zheng He, Aksum, Ibn Battuta, Piri Reis) are staged separately as optimized WebP files; only keys listed in editorialWallArtworkGenerated.ts are enabled, so the preview does not request absent assets. Once the artwork pack is committed the existing UI uses those images without further changes. Do not treat generated interpretations as primary-source illustrations or automatically publish them inside voyages.

The private proposal projection reads only bounded description/idea text and the existing contributor handle, in addition to the existing title/type/status/date. No additional storage or write API. The fixture's composer and four local idea actions are interactive; the connected Wall links to the real proposal and decision controls. Production behavior is unchanged.
