# Handoff — turning the Desk into an editorial console

For: ChatGPT / Codex, taking over front-end development.
From: Claude (Sonnet), session of 2026-11-07.
Owner: Davide (dbaldoni). He is not a developer — explain what you change and why in plain language, in his language (Italian), and keep code, commits and docs in English.

Read first, in this order: `AGENTS.md` (charter, runtime boundaries), `MAGNA_CARTA.md`,
`.claude/skills/terraveler-design/SKILL.md` (the visual law — it governs anything visual),
`SKILLS.md`, `SUBAGENTS.md`.

---

## 1. Where things stand

**Open PR [#104](https://github.com/vitruvyan/terraveler/pull/104) — not merged, not deployed.** Branch `claude/lucid-goldberg-vr35v6`. It contains:

1. Approving an `idea` now creates an Ongoing Project (`lib/ideaProject.ts`, called from `lib/deskVerdict.ts`). Before, approval changed one status and the work vanished (proposal #111, Cabeza de Vaca).
2. `get_submission_status` on an approved idea returns a `project` block (gap id, page URL, `claim_gap` as next action).
3. A stable page per project at `/project/[id]` (`app/project/[id]/page.tsx`, `lib/project.ts`).
4. Migration `supabase/gap_from_approved_idea.sql` — adds `editorial_gaps.source_submission_id` and backfills approved ideas.

**Deploy order is fixed and belongs to the owner:** apply the SQL to the canonical PostgreSQL on the VPS (Docker, `terraveler_postgres`) **before** deploying; then merge. Supabase is identity only — never target it with application SQL. Do not apply migrations yourself; you have no access to the production database and must not ask for it.

**Do not edit these files while #104 is open** (rebase onto it after merge instead): `lib/deskVerdict.ts`, `lib/ideaProject.ts`, `lib/project.ts`, `app/project/**`, `supabase/gap_from_approved_idea.sql`, the `get_submission_status` case in `app/api/mcp/route.ts`.

**Do not touch the draft gate / validation code** (`lib/gate.ts` with `stage0`, the `validate_draft` tool, `DRAFT_SUBMISSION_SCHEMA`, `lib/source-governance.ts`). Another agent owns that problem.

## 2. The UX analysis you are inheriting, checked against the code

A UX analysis of the Desk (written before `/project/[id]` existed) concluded: *the Desk is a review desk, not a content console.* **It is right.** I verified each claim:

| Claim | Verdict | Evidence |
|---|---|---|
| Sidebar has no Voyages / Projects / Drafts | **True** | `Section` type in `components/desk/DeskSidebar.tsx:13` is `overview \| submissions \| sources \| users \| waypoints \| prompts \| analytics` |
| History = every submission as a full card, no search or filter | **True** | `app/desk/page.tsx` ~599–620: `list.map` of cards; the only filter is the `?filter=` query for four counters |
| Cards lead with `#111 · idea`, slug, handles | **True** | `app/desk/page.tsx` ~619: `#{s.id} · {s.type} → {s.target_voyage}`. The title is not shown at all |
| "Source dossier 0" next to a list with many sources | **True, and a labelling bug** | `DeskSidebar.tsx:108` renders `counts.flagged` (endpoints needing review or quarantined) as the badge of the whole Dossier. It means "to examine", it reads as "how many". Say "N sources · M to examine" |
| "Waypoints, taken" is not the whole open work | **True** | `section === "waypoints"` lists `claims` only (`/api/desk/claims`). Open (unclaimed) projects appear nowhere in the Desk |
| Quarterdeck privileges the technical log over priorities | **Partly** | The overview already has counters linking to filtered queues (PR #100); the log is still long. Judge on screen, do not assume |
| The main action in the heading is "Sign out" | **True** | `app/desk/page.tsx` ~497–503 passes Sign out as the heading's only aside |
| Log references like `#111` are not links | **Not verified by me.** Check `components/desk/Quarterdeck.tsx` and the audit rendering |
| Navigation uses `history.replaceState` | **True** | `app/desk/page.tsx:291`, `:344` — the URL records the section, the Back button does not walk sections |
| Load errors are not specific | **Largely true** | Failures use `alert()`; `fetch(...).catch(() => null)` leaves lists empty, indistinguishable from "no data" |

**Two things the analysis could not know, and one it should not assume:**

- **The project page now exists** (#104). A content catalogue must link to `/project/[id]`; do not build a second project view.
- **Drafts are NOT linked to projects.** `submit_draft` carries no gap id, so no query can say "these are the drafts of project 25". The project page says so honestly. Do **not** fake the link by guessing (same claimer, nearby date, similar title). That would show a plausible falsehood on a page whose purpose is to state what the records say. See work package 5.
- "Use the relations already available" is correct for **projects** (`editorial_gaps.source_submission_id`, `claimed_by`, `status`) and for **voyages** (published atlas data). It is **not** enough for drafts or for "what is missing in a voyage".

**The existing submissions tab breaks the design law.** It is inline styles with `borderRadius: 10`, `rgba(255,255,255,0.35)`, raw px — the law caps radius at 3px and forbids raw colours. The skill's debt list already names "submissions and crew tabs" as off the system. Fixing the tab *is* the redesign; do not restyle it in place.

## 3. Product direction (agreed with the owner's intent)

Order of work: **make content findable → make it readable → make actions clear.** A cosmetic pass alone leaves the real problem untouched.

Target structure of the Desk (question each area answers):

| Area | Question |
|---|---|
| Overview ("Quarterdeck" stays as the narrative name, with "Overview" beside it) | What needs my attention? |
| Content (new) | Which voyages and projects exist, and where do they stand? |
| Reviews | Which contributions need a decision? |
| Sources & images | What do we hold, where is it used, what needs attention? |
| Contributors | Who is working on what? |
| System | Prompts, technical activity, statistics |

The centre is **one editorial page per voyage or project**, with content, tasks, contributions, sources and history linked. Reviews stay an operational queue that leads *to* that page. `/project/[id]` is the first such page; extend it rather than replacing it.

Keep the identity: parchment, typography, archival tone. Reduce header height, compact lists, explicit actions, details on demand.

## 4. Principles you may not trade away

1. **Human in the loop (AGENTS.md principle 2).** The Desk is where a human authorizes. Do not add auto-approve, bulk-approve, or a default that approves. Verdict buttons stay explicit, show what is being decided, and keep the override-with-reason path for an unclean dossier (`lib/deskVerdict.ts`, Carta §10.4).
2. **A record is not a question.** Show what is decided, derived from data; raw JSON stays below and shut (`SubmissionBrief.tsx` is the pattern).
3. **State only what the records say.** A zero is a finding and is said ("no stage carries a quotation"). Never an empty cell that looks like "nothing happened". If a link or a number is not available, say that.
4. **Audit everything.** Do not add write paths that skip `audit_log`.
5. **Design law.** Tokens only (read `:root` in `app/globals.css`); display face only at display sizes; chrome that states a fact is mono; no raw hex, no radius above 3px, no shadows on paper, drawn icons via `components/Icon.tsx`; reuse `TitlePage`, `SiteHeader`, `SiteFooter`; arrangement through `data-layout`, not media queries. Retire debt-list entries in the same commit.
6. **Boundaries.** Application data goes through `lib/backendConfig.ts` (`POSTGREST_URL`, `POSTGREST_SERVICE_KEY`). Never `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` directly. Supabase is identity only.
7. **A gated surface cannot be looked at.** The Desk needs a session, so build new views as components fed fixtures and render them in `/specimen` (the way `Quarterdeck.tsx` does). Do not look for credentials in `.env`.

## 5. Work packages, in order

Each is its own small PR. Do not bundle them.

**WP0 — Make the existing Desk tell the truth (small, do first).**
- Dossier badge: label it "N sources · M to examine", or move the flagged count to its own marker.
- Make `#id` references in the audit log and Quarterdeck links to the submission.
- Replace `alert()` failures and silent empty lists with specific, inline error states ("could not load submissions — retry"), distinct from "none yet".
- Demote Sign out to the header's quiet corner; the heading's action should be contextual.
- *Done when:* each of these is visible on a fixture in `/specimen`, with a test for the error state.

**WP1 — Submissions as a compact, searchable list.**
- One row per submission: **content title first** (from `payload`: idea title, voyage name, target), then status, owner, next step, date. `#id · type` and handles move to the detail.
- Search and filters: status, type, contributor, voyage. Filters live in the URL.
- A real detail page per submission (`/desk/submissions/[id]`) reusing `SubmissionBrief`; the long description collapses. One long proposal (#111) must not take the screen.
- Rebuild on tokens; remove the inline styles and the 10px radius. Replace `replaceState` with navigation that keeps Back working, or justify keeping it.
- *Done when:* 98 submissions fit a few screens, one can be found by title, and the page passes the design checks at 1440 and 390 px with no horizontal page scroll.

**WP2 — Content catalogue ("Projects"), from what exists.**
- A new Desk section listing projects (`editorial_gaps`: open, taken, done) with title, kind, status, owner, source proposal, linking to `/project/[id]`. Include open ones — today they are invisible in the Desk.
- Needs a new read route under `app/api/desk/` (frontend side, via `lib/backendConfig.ts`, same auth as its neighbours). Add tests.
- Published voyages may be listed from the atlas data; say clearly which list is which (project ≠ published voyage — the design law's "proposal, approved project, research, draft, published voyage" must be distinguishable).
- *Done when:* proposal #111, once the migration is applied, appears here as "Approved — waiting for an author" and opens its page.

**WP3 — Overview reordered: priorities first, log below.**
- Top: what needs a verdict, what is stalled (taken and overdue), what is approved and waiting for an author. Log underneath, shorter.
- Reduce header height. Keep "Quarterdeck".

**WP4 — Editorial preview of a draft.**
- Readable text, plates with their provenance fields, the route, differences from existing content. Extends `SubmissionBrief`. Larger; plan it before building and share the plan.

**WP5 — Drafts attached to projects. BLOCKED on an owner decision.**
- Needs `submit_draft` to carry an optional gap id. That changes the Stage-0 gate schema, which another agent owns, and the MCP tool schema, which must stay in parity across `app/api/mcp/route.ts` and `app/api/agent/write/route.ts` (`test/chartroom-mcp-parity.test.ts`).
- Do not start it. Write a short proposal (field name, validation, migration, parity impact, what the project page shows once it exists) and give it to the owner.

## 6. Open decisions for the owner (do not decide them)

- **Publication model.** (A) one human "approve" that authorizes everything after it, with agents drafting, publishing, embedding and deploying, and a way to retract; or (B) no routine human step, an editor agent decides. Claude recommended A; the Carta currently implies a human authorizes. Until the owner chooses, change nothing about publication.
- Where drafts link to projects (WP5).

## 7. How to work

- One branch and PR per work package, small. Subscribe to the PR and fix red CI yourself; never skip a test to get green.
- Before pushing: `npx tsc --noEmit`, `npm test` (518 pass today), and `npm run build` — **never while `npm run dev` is running** (it wipes `.next`). For visual work, screenshot at 1440 and 390 px. A full-page screenshot may show blank space below the viewport — scroll and capture instead of trusting it.
- Look at the result with your own eyes before saying it works. Say plainly what you did **not** verify (the live database, a real device).
- Do not touch production data, secrets, or the VPS. Anything that needs the owner's hands (applying SQL, deploying, rotating a key) goes in the PR description as an explicit step.
- End-to-end test case for all of it: **proposal #111, Cabeza de Vaca.** It was approved by the editor; after the migration it must appear in the Desk's catalogue, open its project page, and be claimable by an agent with `claim_gap`.
