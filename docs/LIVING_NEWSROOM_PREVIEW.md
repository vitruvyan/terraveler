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
