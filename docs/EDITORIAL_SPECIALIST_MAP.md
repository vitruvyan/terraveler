# One editorial team: existing components and specialist evolution

Audit reference: main b90eaeb8f05a1e491457fc5e611dab1e28e5e3e6.
This is a source-code audit and implementation proposal, not a production runtime certification.
No worker, ingestion, publication or model request was started by this audit.

## What exists

| Component | Actual implementation | Relationship to the team |
|---|---|---|
| Oculus | `ingest/oculus.py`, `ingest/pipeline_native.py`: bounded source discovery | Researcher's discovery tool; retain whitelist and governance |
| Curator of sources | `ingest/curate.py`: LLM candidate judgments, direct OpenAI request | Adapt generation through Limen, preserve scoring and evidence |
| Codex | `ingest/codex.py`: deterministic normalization, quality checks, work binding and deduplication | Shared tool, not an autonomous generative agent |
| Waypoint extraction | `ingest/extract.py`: Motus extraction, chronology, geographic checks, provenance and draft construction | Basis for itinerary specialist; outputs remain proposed coordinates/dates until checked |
| Source rights assessment | `ingest/archivist.py`, `ingest/source_governance_shadow.py`, `ingest/licence.py` | Evidence/rights tools; do not treat generic domain approval as per-item licence proof |
| Image association | `ingest/photo_associate.py`, `ingest/photo_match.py`: legacy direct OpenAI scripts | Prototype only. photo_match explicitly documents incorrect title-only image associations; not a validated visual tool |
| Private content swarm | `scripts/content_swarm.py`, fixtures and `scripts/export_pizarro_research.py` | Reuse evidence IDs, bounded attempts, review and checkpoint patterns; not a continuously running Desk worker |
| Ethnographic contributions | `app/api/mcp/route.ts` accepts ethnography research contributions; Pizarro fixtures and export have indigenous-perspective/populations material | Existing starting point for ethnohistory specialist, not a deployed reusable population dossier service |
| Pigafetta | `rag/app/chat_graph_native.py`: retrieved-source answer graph, OpenRouter generation path | Public reader assistant; separate identity and permissions from editorial coordinator |
| Officers | `officers/main.py`, `relay.py`, `dispatcher.py`: event relay, curator-desk, embedder/Archivist and Herald watches | Keep reliable event delivery, review notifications and indexing as infrastructure |
| Publisher | `orchestration/publish.py`, `orchestration/motus/nodes/publisher.py`: deterministic new-voyage graph, authorization/evidence checks, bundle and atlas writes, git push, publication trace | Final effect executor, never a general-purpose LLM tool |
| Older publication CLI | `scripts/publish_submission.py`: new voyage and waypoint enrichment, operator override flags | Inventory and converge adapters; never expose arbitrary CLI flags to agents |
| Desk editorial team | `lib/editorialTeam.ts`, `supabase/editorial_team.sql`: four role kinds and immutable versions | Extend capabilities and explicit assignment; changing a name/prompt does not add executable tools |
| Durable editorial worker | `orchestration/editorial.py`, `editorial_handlers.py`, `editorial_sources.py` | Claims pinned research/writer/reviewer tasks with leases; sequential per worker instance; current research reads governed stored corpus, not autonomous web discovery |
| Pipeline and coordinator | `supabase/editorial_pipeline.sql`, `lib/editorialCoordinator.ts` | Fixed research/write/review sequence with bounded repair; coordinator can reply or start this pipeline, not freely plan a specialist graph |

## Gaps that matter

1. Only coordinator/research/writer/reviewer are accepted by the team registry; the task handler registry has three executable roles. There are no executable image, itinerary or ethnohistory roles yet.
2. Assignment is currently role-based, not specialist/capability-based. Several agents named differently under `research` do not create reliable specialist dispatch. The binding must identify the assigned agent version and required capability explicitly.
3. A single dependency_id and the fixed scheduler do not represent the desired parallel research/image/itinerary branches and their join. Parallel workers alone do not solve this.
4. The generated article candidate is not automatically a valid publisher submission. Add an explicit structured, versioned candidate-to-submission adapter; preserve submission validation and human authorization.
5. The gateway sends a requested model from the pinned config. The deployment currently exposes local-default only. Distinct model routing must be proven using actual served-model evidence, not just the requested_model trace field or a populated dropdown.
6. Several legacy pipelines still use direct cloud providers. Do not claim local-only execution until every activated specialist uses the governed Limen port. Public Pigafetta need not migrate as an incidental change.
7. Existing artifact/lease persistence is not a complete agent memory or learned pattern system. Add bounded checkpoints and evidence-linked reusable entities explicitly; do not infer correctness from repetition.

Publication authority nuance: the existing Motus publisher accepts an audit approval
from either `curator-desk` or `editor-in-chief`. Therefore its current guard alone
does not prove a strictly human approval. The next bridge must require the explicit
editor authorization of the exact artifact version. The two publication codepaths
must converge behind that contract before autonomous preparation is activated.

## Initial eight specialists

| Specialist | Owned output | Reuse |
|---|---|---|
| Coordinator | Mission plan, assignments, dependencies, progress and escalation | Existing Desk chat and durable task protocol |
| Historical researcher | Source records and evidence-backed atomic findings | Oculus, source Curator, corpus retrieval, swarm patterns |
| Itinerary specialist | Proposed dated/geographic waypoint records and uncertainty | Existing extraction and geographic checks |
| Iconographic curator | Image candidates, rights proof, creation date, depicted event/date and attribution | Governed Commons/source tools; replace title-only visual inference |
| Diary writer | Narrative sections linked to waypoint and evidence IDs | Existing writer handler and quotation checks |
| Image editor | Caption, description and alt text with provenance | Selected asset metadata; a vision model only when the actual image is supplied |
| Ethnohistorian | Time-scoped population/context sections and encounter links | Existing ethnography contributions and population research fixtures |
| Independent reviewer | Typed issues assigned back to specialists and readiness decision | Existing reviewer plus deterministic gates; separate from source Curator and curator-desk ruling authority |

A specialist is a responsibility/capability, not necessarily a new infrastructure service or model. Preserve current four-role history while designing additive capability and task-type contracts. Do not create eight paused configurations and call the implementation complete.

## Ethnohistory contract

Separate reusable population/context identity from voyage-specific encounter claims. Each encounter needs voyage and waypoint links, time scope, evidence IDs, original source names, proposed identification, uncertainty and consultation level. Preserve competing identifications. Later indigenous accounts and modern scholarship must be labelled by their actual date and perspective, not presented as contemporary eyewitness testimony. Modern geographic proximity alone never proves encounter identity. Link-only material is not an ingested or read source. Storage and review of these entities still need implementation.

## Shared production flow

The unit of coordination is a voyage dossier; tasks target voyage, waypoint, media asset or population/context records through stable IDs. Evidence discovery, itinerary and image candidate work can run in parallel. Diary composition waits only for the required evidence of its waypoint. Captioning follows asset selection. Review operates per artifact and then across the whole voyage.

A deterministic assembler creates a versioned candidate bundle from selected reviewed artifact revisions. Content changes invalidate affected review/approval. Publication must apply to the exact validated revision and cannot be inherited silently by a later rewrite. The publisher executes the final authorized effect; an optional LLM publication preparer may identify missing fields but never bypass it.

Keep the existing source, rights, quote, chronology, coordinate and publication gates. Do not expose shells, SQL, arbitrary fetches or publisher override flags as agent capabilities. Discovery remains restricted to approved sources. Specialist prompts cannot grant capabilities.

## Delivery sequence and acceptance

1. Multi-model routing: configure explicit local aliases and scoped key permissions; prove the actual served model for two different assignments, with no silent common-default/cloud fallback. Add CPU/memory-aware concurrency and bounded queueing; start with a small concurrency limit.
2. Assignment and task graph: add capability-aware explicit assignment, immutable artifact versions, multi-dependency tasks, bounded checkpoints and a deterministic scheduler. A restart or retry must not duplicate artifacts or switch agent version; pause revokes execution.
3. Adapt existing discovery and extraction as typed specialist tools through Limen. Complete one voyage with source and itinerary branches before enabling broad daily work. No duplicate publication entry points.
4. Add iconography/caption and ethnohistory artifact contracts and their review tools. Validate date of artwork separately from depicted event, rights separately from relevance, and context separately from proven encounter identity.
5. Candidate assembly and publication bridge: run existing submission checks, present exact version to the editor and execute the existing publisher only after explicit authorization. Verify indexing and notification events afterward.
6. Coordinator autonomy: enable bounded typed planning/replanning only for implemented capabilities. Show meaningful blockers and next responsible specialist in the existing project UI. Escalate genuine missing evidence, rights conflicts, exhausted retries or resources; do not ask the editor to assemble fragments.

Acceptance pilot: one dossier survives a worker restart, has two independent branches, uses at least two verified local model routes, produces a waypoint-linked narrative plus image and ethnohistory candidates, completes bounded correction, and stops at human publication authorization. This target has not yet been demonstrated in production.
