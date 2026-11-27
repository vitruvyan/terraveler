# Editorial newsroom: executable textual graph

TerraVeler's product direction is an encyclopedic workshop: a human publisher
sets direction and authorizes publication; AI specialists contribute reviewed,
source-linked artifacts to a voyage dossier. The current implementation supports
a complete private textual graph. Production activation, live execution and
image work remain separate acceptance steps; code presence is not activation
evidence.

## Included

- Ten creation templates in `/desk/team`: managing editor, historical reporter,
  ethnohistorian, itinerary researcher, photo editor, diary writer, caption writer,
  editorialist, copy editor and fact checker. Names, model and instructions remain
  editable. Templates do not grant tools or publication authority.
- Seven textual specialties map to the existing bounded generic handlers:
  history, ethnohistory and itinerary use research; diary and editorial use
  writer; copyedit and factcheck use reviewer. Iconography and caption remain
  planned and cannot be enabled: a text corpus is not visual inspection.
- Specialties are immutable metadata for each configuration version. Reopening a
  configuration restores its specialty. Planned specialties cannot be enabled by
  omitting that metadata. The four operational role kinds remain unchanged.
- Preparation asks the managing editor for one to four research proposals only.
  `composeEditorialPlan` deterministically adds one diary and one editorial,
  both dependent on every research item, plus one copyedit and one factcheck for
  each writer. This is an explicit contract, not repair of malformed model
  output. The independent preparation reviewer receives the composed plan.
- Plan dispatch retains the legacy diary/factcheck pilot and accepts the full
  textual graph. It requires exactly one enabled agent for every specialty used,
  binds each reviewer to exactly one draft, and preserves the governed dossier
  source or approved voyage corpus gate.
- A completed `changes-requested` review set automatically schedules a revised
  writer task and fresh reviews, with the prior draft and all reviewer issues as
  context. Research is not rerun. At most two revisions per writer are allowed;
  a third non-ready review set, or any `blocked` verdict, stops at `attention`.
  Results remain immutable and review composition retains source task/result IDs.
- `editorial_graph_status` considers only the latest revision of each work item
  and reaches `awaiting-editor` only when every latest review is
  `ready-for-editor`. Neither verdict nor revision publishes content.
- Itinerary research can contain 1–40 structured waypoint candidates. SQL passes
  the same route to every dependent writer, and reviewers require exact equality
  with that research. The private preview maps these points in sequence with
  chronology, source links, confidence and uncertainty. Candidate points and
  connecting lines are not verified geography or reconstructed navigation tracks.
- Immutable task assignment to an explicit agent key plus specialty remains
  available for eligible unassigned tasks. Claim honors assigned identity,
  including pause/role changes and recovered attempts. A different enabled agent
  of the same role is not a fallback.
- Assignment metadata accompanies the worker context and its Motus task record.
  The first claim pins the exact agent version/model. Assignment itself does not
  pin a version or enqueue work.

## Operator deployment

Apply migrations to canonical VPS PostgreSQL, never Supabase Auth. Back up the
database and stop editorial workers while migrating. After the existing planning
and dispatch migrations, apply them in this order:

1. `supabase/editorial_dossier_sources.sql`;
2. `supabase/editorial_textual_newsroom.sql`;
3. `supabase/editorial_task_retry.sql`;
4. `supabase/editorial_graph_revisions.sql`;
5. `supabase/editorial_waypoints.sql`.

The textual-newsroom migration replaces save, assignment, dispatch and graph-status
definitions and expects the dossier-source helpers. Do not reapply older definitions
afterward. No migration is performed by a frontend deploy. Deploy the updated
preparation API together with the migration and configure one enabled agent for each
textual specialty used. With both reviewer specialties enabled, set
`EDITORIAL_PLAN_REVIEWER_AGENT_KEY` to the exact factcheck agent; generic role
selection is intentionally ambiguous and fails closed.

The editor-only POST `/api/desk/projects/retry` recovers one exhausted planned
task without changing its run, plan, attempt history or dependencies. It accepts
exactly `task_id`, `expected_attempt`, `request_id` and a bounded `reason`. The
task must be in `attention` because its attempt budget is exhausted. Each new
request authorizes one additional attempt, up to the existing hard maximum of
five, and appends an immutable `editor-retry-authorized` event. Repeating identical
arguments and request ID replays the receipt; changed intent conflicts. Automatic
lease recovery does not authorize this operation, and the worker role cannot execute it.

The editor-only POST `/api/desk/projects/assign` accepts exactly:

```json
{"task_id": 123, "agent_key": "historian-a", "specialty": "history", "request_id": "assignment-unique-0001"}
```

The task must be queued, never claimed, compatible with the specialty, and the
agent must currently be enabled in the matching operational role. Retries must
reuse identical arguments and request ID; changed intent conflicts. Pausing the
agent prevents claim without silently selecting another agent. The Projects UI
offers a named-agent picker for eligible unassigned tasks. Coordinator assignment
actions are still future work.

## Remaining acceptance work

1. Apply the migration and activate the verified textual agents, then run one
   controlled private preparation, dispatch and worker execution.
2. Inspect both drafts and all four reviews by immutable result ID in the private
   preview. Do not treat fixture benchmark success as live historical quality.
3. Implement image discovery, real image fetch and inspection through Limen,
   rights receipts and dedicated iconography/caption artifacts before enabling
   either media specialty.
4. Add a versioned structured voyage candidate containing narrative, itinerary,
   waypoint diaries, media and population sections, plus an exact-version human
   publication bridge.

No autonomous image assessment, population entity storage or exact-version
publication bridge is claimed. Existing publication checks and human authority
remain unchanged.

## Private reading preview

The editor needs to see the assembled result before authorizing it, not evaluate
an opaque task ledger. `/desk/projects/<topic>/preview` resolves a saved writer
result to `?result=<immutable-result-id>`. The editor session is required before
any data read. The page is dynamic, private/no-store and noindex; it writes
nothing to the public atlas, sitemap, corpus or publication tables. It reads
existing append-only results; `editorial_waypoints.sql` is required upstream to
carry itinerary candidates into writer context and enforce route preservation.

The current writer contract produces title, paragraphs, citations, source records
and, when supplied by itinerary research, structured waypoints. The preview renders
these as a reading edition using the site's public TitlePage typography. It includes
paragraph-linked sources, a private MapLibre candidate map, waypoint chronology,
confidence and uncertainty, and a review matched to that exact writer task. It
excludes source passages, raw model envelopes and trace internals; malformed
waypoint records are omitted and counted. Missing images and population sections
are explicitly declared. This is not yet a complete voyage preview.

A revision request sends a typed draft_result_id to the existing project chat.
The server resolves that result within the project, stamps its identity into the
persisted question and supplies inspected_draft rather than the latest draft to
the coordinator. A reply without a task receipt is not presented as scheduled work.
The existing coordinator can start a new research/writing/review pipeline, not
edit arbitrary content or publish. It does not yet provide deterministic rewriting
of the whole inspected draft; the bounded brief is still LLM-generated.

Human publication must promote precisely the inspected candidate, never another
or latest version. Do not add an apparent Publish button until this exact-version
bridge and the existing content gates are connected end to end.
