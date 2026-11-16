# Editorial newsroom: first executable assignment increment

TerraVeler's product direction is an encyclopedic workshop: a human publisher
sets direction and authorizes publication; AI specialists contribute reviewed,
source-linked artifacts to a voyage dossier. This increment does not implement
the complete parallel newsroom or activate any production agents.

## Included

- Ten creation templates in `/desk/team`: managing editor, historical reporter,
  ethnohistorian, itinerary researcher, photo editor, diary writer, caption writer,
  editorialist, copy editor and fact checker. Names, model and instructions remain
  editable. Templates do not grant tools or publication authority.
- Templates label missing specialist tools and start paused. Specialties are saved as immutable metadata for each configuration version.
  Reopening a configuration restores its specialty. Planned specialties cannot
  be enabled by omitting that metadata. The four operational role kinds remain.
  A configured specialist name still does not certify unimplemented tools.
- Immutable task assignment to an explicit agent key plus specialty. Only history,
  diary and factcheck currently map to generic executable handlers. Other named
  specialties are rejected by assignment until their handler contracts exist.
- Claim honors the assigned identity, including pause/role changes and recovered
  attempts. A different enabled agent of the same role is not a fallback.
  The first claim pins the exact agent version/model as before. Assignment itself
  does not pin a version or enqueue work. Existing unassigned tasks retain legacy
  role selection, so this is not yet automatic specialist scheduling.
- Assignment metadata accompanies the worker context and its Motus task record.

## Operator deployment

Apply `supabase/editorial_specialists.sql` AFTER workflow, team, binding, pipeline
and chat migrations on canonical VPS PostgreSQL (not Supabase Auth). The migration
replaces editorial_claim; do not reapply older claim definitions afterward.
Back up the database and stop editorial workers while migrating. No migration is
performed by a frontend deploy. This change does not configure model aliases,
change the scoped Limen key, start workers, or publish content.

Also apply `supabase/editorial_agent_specialties.sql` after the specialists migration.
This revokes the service role’s old save RPC; deploy the updated Team API together
with this migration. The old RPC remains callable by the owner-backed wrapper,
which preserves versioning, specialty constraints and idempotency.

The editor-only POST `/api/desk/projects/assign` accepts exactly:

```json
{"task_id": 123, "agent_key": "historian-a", "specialty": "history", "request_id": "assignment-unique-0001"}
```

The task must be queued, never claimed, compatible with the specialty, and the
agent must currently be enabled in the matching operational role. The operation
uses `editorial_assign_specialist` and records an immutable receipt. Retries must
reuse identical arguments and request ID; changed intent conflicts. Pausing the
agent prevents claim without silently selecting another agent. The Projects UI now offers a named-agent picker for eligible unassigned tasks.
It filters paused, wrong-role and explicitly incompatible-specialty agents; a
successful assignment is immutable and removes the picker. Coordinator assignment
actions are still future work.

## Next acceptance slices

1. Expose explicit local model aliases in Limen and the scoped key, and verify
   actual served-model evidence for two assignments. Current local-default-only
   deployment does not provide multi-model operation.
2. Extend persisted specialties into implemented capability contracts and expose
   assignment through bounded coordinator typed actions. Versioned specialty
   persistence and the project assignment picker are now implemented.
3. Add multi-dependency task graphs and artifact checkpoints for parallel source,
   itinerary, image and ethnohistory work, with bounded hardware concurrency.
4. Adapt governed discovery/extraction, vision-based image assessment, population
   context contracts and the exact-version candidate/submission publication bridge.

No autonomous discovery, image assessment, ethnohistorical entity storage,
parallel specialist scheduler or exact-version publication bridge is claimed by
this increment. Existing publication checks and human authority remain unchanged.

## Private reading preview

The editor needs to see the assembled result before authorizing it, not evaluate
an opaque task ledger. `/desk/projects/<topic>/preview` now resolves the latest
saved writer result to `?result=<immutable-result-id>`. The editor session is
required before any data read. The page is dynamic, private/no-store and noindex;
it writes nothing to the public atlas, sitemap, corpus or publication tables.
No new migration is needed for the preview: it reads existing append-only results.

The current writer contract produces only title, paragraphs, citations and source
records. The preview renders those as a reading edition using the site's public
TitlePage typography. It includes paragraph-linked sources and a review matched
to that exact writer task; it excludes source passages, raw model envelopes and
trace internals. Missing itinerary, waypoint diary, images and population sections
are explicitly declared. This is not yet a complete voyage preview.

A revision request sends a typed draft_result_id to the existing project chat.
The server resolves that result within the project, stamps its identity into the
persisted question and supplies inspected_draft rather than the latest draft to
the coordinator. A reply without a task receipt is not presented as scheduled work.
The existing coordinator can start a new research/writing/review pipeline, not
edit arbitrary content or publish. It does not yet provide deterministic rewriting
of the whole inspected draft; the bounded brief is still LLM-generated.

Next acceptance target: agents must produce a versioned, structured voyage
candidate containing narrative, itinerary, waypoint diaries, media with complete
credits/rights, population sections and unresolved gaps. Render that candidate
through the same public voyage components inside the private preview. Human
publication must promote precisely that inspected candidate, never another/latest
version. Do not add an apparent Publish button until this exact-version bridge
and the existing content gates are connected end to end.
