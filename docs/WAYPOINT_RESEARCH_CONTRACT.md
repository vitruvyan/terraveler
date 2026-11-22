# Waypoint research contract v1

Terraveler prepares each waypoint as an evidence dossier before writing its
narrative. This contract applies to new waypoint research, enrichment and
correction. It does not retrospectively certify existing atlas records.

The pilot is Motux/Motupe. The reusable implementation is
`scripts/waypoint_research.py`; structural definitions are in
`contracts/waypoint-research-v1.schema.json`. Both the input and every handoff are
versioned. English is canonical. The result remains a private editorial proposal
until a human authorizes publication.

## Required sequence

1. **Prepare and verify the research packet.** Identify the waypoint and its
   editorial questions. Pin the source URLs, consulted edition/revision, rights,
   retrieval status and time, available exact text or metadata, image candidates,
   bibliography, and known gaps. A missing date or site is an explicit research
   outcome, never permission to invent one.
2. **Search and read.** GPT-4.1 has bounded, read-only function tools. The runner
   executes `source_search` through the existing public Terraveler MCP source
   adapters, alongside verified packet snapshots. `source_read` takes a returned
   candidate handle: the model cannot choose an arbitrary URL, endpoint, method
   or shell command. Only permitted source kinds and hosts are fetched. Commons
   descriptions and PDF transcriptions in this pilot are locally prepared,
   inspected snapshots; these are not a new Commons/PDF live-fetch adapter.
   All verified input snapshots and link-only study metadata are available to
   extraction even when the model does not request them again. The trace labels
   this as operator-supplied material, separately from model-requested tool reads.
3. **Extract atomic fact proposals.** A proposal records its subject, property,
   statement, category, evidence IDs and temporal, geographical and population
   scope. Source evidence is copied by the program. Exact copying establishes
   fidelity to the supplied text; it does not establish entailment or truth.
4. **Check structure and provenance.** Validate source membership, offsets,
   hashes, typed metadata, allowed scopes and references. Export the complete
   fact proposals and mechanical findings. These remain proposals.
5. **Independently review the facts and assets.** A reviewer other than the
   proposing model checks every statement against its selected evidence,
   including attribution, relationships, qualifiers and uncertainty. Review
   captions, image relevance, study use and gap text too. The reviewer may
   correct or reject a proposal. The approved objects and allowlists are pinned
   in a separate review artifact; model self-assessment is insufficient.
6. **Compose by selecting IDs.** Only after a matching review exists may a
   composition call select approved fact IDs into fixed sections. It cannot
   author new text, quotations, URLs, dates, coordinates or captions. Python
   renders the reviewed statements unchanged, plus pinned image/bibliography
   metadata and gap templates. All pinned gaps must remain visible.
7. **Inspect the assembled dossier.** Check that the rendered card preserves
   the approved statements, source roles and caveats. Human publication remains
   a separate decision; an independent agent review is not that authorization.

## Handoff contract

The JSON Schema defines `input_pack`, `fact`, `facts_result`, `review` and
`composition`. Runtime checks enforce the relationships that JSON Schema cannot
express. Schema validation and semantic review are distinct outcomes.

| Artifact | Required binding and meaning |
|---|---|
| Input packet | `protocol`, waypoint ID/task, licensed snapshots, typed provenance, candidate media, link-only bibliography and scoped gaps. Its canonical digest is frozen before paid calls. |
| Effective source packet | Input digest plus the actual read snapshots, program-created evidence IDs and tool-result digests. It records both successful and failed access; a search result is not proof that a document was read. |
| Fact proposals | At most twelve atomic facts with subject/property, evidence IDs and three scopes, plus referenced gap IDs. `facts_sha` binds the complete result, including limitations. |
| Independent review | Effective `sourcepack_sha`, `facts_sha`, `approved_content_sha`, corrected/approved fact objects, reviewer identity and allowed fact/media/study IDs. `human_approved` must be false. |
| Composition | Fixed section keys and ID lists only. IDs must be approved, unique and compatible with their section. `gap_ids` must equal the pinned required gaps. |
| Final card | Program-rendered approved text and metadata, source evidence, gaps, access limits, review lineage, execution trace and the lifetime budget. |

`approved_content_sha` binds the approved facts, selected media, selected studies
and all packet gaps. Protocol fingerprints also pin the schema, prompts, tools,
limits and rendering rules. A missing or mismatched review stops the composition
before a new provider call. Changes to reviewed statements or assets require a
new review; they cannot silently reuse the old approval.

Reviewer independence is a procedural responsibility: the gate records the
reviewer's declared identity and role, but does not cryptographically prove that
the reviewer is a different person or model. The operator must assign a separate
reviewer and preserve its review findings.

## Running a waypoint

Preview validates the packet and payload bounds without credentials, network
requests or purchases:

```sh
python3 scripts/waypoint_research.py --sourcepack scripts/fixtures/waypoint-motux-v1.json --research
```

Add `--run` for the explicitly authorized research phase. Inspect the resulting
`out/content-swarm/waypoint-pattern-v1/motux/facts.json`, independently review its
proposals, and save the schema-compliant review with its matching content hashes.
Then run composition with that review:

```sh
python3 scripts/waypoint_research.py --sourcepack scripts/fixtures/waypoint-motux-v1.json --compose --review out/content-swarm/waypoint-pattern-v1/motux/independent-review.json --run
```

The source packet and implementation are frozen by the first paid call. A cache
resume makes no new provider purchase. A stopped or uncertain run is inspected;
changing a namespace to evade the stop is prohibited.

### Reviewed checkpoint recovery

Ordinary discovery uses a strict provider response schema for its completion
signal. The first Motux experiment, using JSON-object output, returned
`done: true` alongside an unsolicited card and correctly stopped. That card
contains unsupported claims and is rejected in full.

This specific completed checkpoint may be recovered after independent inspection:
`--recovery` supplies a review pinning the old and new implementation hashes, the
original manifest, unchanged source/schema/prompt/tool/rendering fingerprints,
exact completed discovery/tool rows and the offending completion digest. The
program discards only the unsolicited completion fields and records that decision.
It reuses discovery exclusively from caches and extracts facts only from the
original evidence packet. It neither repairs nor trusts the rejected card.

The original manifest, paid responses, tool caches, failed trace and implementation
snapshot remain unchanged. A separate immutable successor records the recovery.
The same namespace, lifetime ledger and six-call ceiling apply; there are no new
discovery purchases, automatic retries or hidden budget resets. Missing, stale,
uncertain or differently scoped checkpoints cannot use this exception. Recovered
research and composition both require the same pinned `--recovery` artifact.

## Evidence and scope rules

- Participant accounts, translator notes, later chronicles, modern geographical
  records, photograph metadata and scholarly context have different authority.
  They must retain their semantic role. `source-text` describes storage rather
  than eyewitness status.
- A translator's Motux–Motupe identification is an attributed editorial fact. It
  does not supply the historical camp's coordinates. A modern town coordinate
  remains a modern reference point.
- A relative duration such as four days does not establish an arrival date.
  Edition dates and image dates must not become expedition dates.
- A named chief, locality or modern regional label cannot establish the identity
  of every population encountered. Regional or later studies retain their period,
  place, population and consultation level.
- A study's bibliography or abstract about research questions cannot support
  detailed findings. Copyrighted scholarship remains link-only: record its
  citation, consulted locator and reviewed original scope note, without adding
  its full text to the corpus or embedding it.
- An image needs item-level rights, credit, dimensions and reviewed relevance.
  Description rights and underlying asset rights stay separate. A modern image
  must be labelled modern context. Metadata access and successful image retrieval
  are separate statuses; a blocked asset is not reported as downloaded.
- A gap says what the consulted evidence does not establish. It must not assert
  that no evidence exists anywhere. Known gaps are reviewed and mandatory in
  composition. A discovery that resolves one requires explicit reconciliation of
  the input packet and review, not contradictory text or an automatic new run.

## Tool, budget and audit boundaries

The runner reuses native Motus, the public MCP source-search/fetch path, private
source snapshots and the existing lifetime ledger at
`out/content-swarm/budget.sqlite`. It uses the original shared run lock and paid
attempt journal. The ceiling remains USD 2 across all pilot versions; a new
output folder is not a new allowance.

The waypoint namespace has at most six provider calls: up to four bounded
tool-discovery rounds, one fact extraction and one composition. Tool follow-ups
count as provider calls. Inputs, outputs, search candidates, tool invocations and
source views have fixed limits. Every paid call reserves a conservative amount
before purchase. Uncertain attempts or unresolved reservations stop all later
calls. Completed calls and tool observations resume from their verified caches;
there is no automatic retry, revision loop or namespace rollover.

The model has no publication, database mutation, messaging, enrollment, shell or
credential tool. The packet and source text are untrusted data. Discovery does
not enlarge the ingestion whitelist or approve an unknown licence. The public
source registry remains the authority for its own adapters; the pilot further
narrows fetched kinds/hosts.

Motus traces carry digests and effect records rather than source or draft prose.
Use the installed kernel's actual schema version. Contract validation establishes
trace structure and lineage; it is not semantic verification or historical truth.
This effects-based graph declares replay `none`.

## Regression and acceptance

`scripts/fixtures/waypoint-pattern-holdouts.json` preserves semantic failures from
the earlier experiment: material transferred from houses to a fortress, territorial
extent transferred to a valley, invented authorial intent or psychology, modern
coordinates turned into a camp, later regional scholarship turned into encounter
identity, wrong-place photographs, licence mixing and abstract aims turned into
findings. Faithful paraphrases and genuinely justified unknowns are positive cases.

These are editorial regression cases, not a claim that software detects meaning.
The previous reviewer matched eight calibration verdicts and still passed three
drafts with unsupported prose. The v1 guarantee instead is that only independently
reviewed text and metadata reach the final card unchanged.

Tests must demonstrate:

- Unknown, duplicate, unapproved or incompatible IDs and extra composition prose
  are rejected; the composer cannot omit required gaps or rewrite approved facts.
- Missing/stale/tampered reviews, source spans or asset bindings fail closed.
- Off-whitelist sources, unreturned handles and unapproved tools cannot be read.
- Rights, modern/historical location roles and study scopes remain distinct.
- Bounds, private permissions, global budget holds, crash/cache behavior and native
  Motus trace structure hold on the real runner.

The pilot's historical completeness, actual source accessibility, semantic review
findings and unresolved questions must be reported separately from passing tests.

## Observed Motux pilot

The controlled run used eight independently checked seed records: six spans from
the same Xerez/Markham volume, a modern Wikipedia excerpt and Commons image
metadata, plus one link-only study record. The model made seven reads of supplied records and no
fresh MCP search. All 114 operator-provided evidence records were available to
extraction; this experiment tests the handoff and fidelity controls, not autonomous
source discovery. The unsolicited discovery card was discarded through the exact
checkpoint recovery described above.

Eight fact proposals passed mechanical checks. Independent review found two
supported raw statements and six requiring substantive statement or scope
revision. Seven corrected or clarified atoms were approved; the agricultural atom
was rejected because its fixed subject narrowed regional evidence to inhabitants
near Motux. The composer selected IDs only. The program retained the seven
approved statements unchanged, all six gaps, a provisional modern image candidate
and the scoped bibliography record. These remain private editorial proposals.

Five new provider calls added USD 0.077950 to the existing usage ledger. The
lifetime total is USD 0.334666 across nineteen completed calls, with no pending
reservations and the original USD 2 ceiling. These figures use the ledger's
conservative token rates, without cached-input discounts. Research and composition
were then resumed with provider/source requests disabled: no new calls, charges
or changes to the fact, card and gate bytes occurred.

The photograph's actual bytes and capture date remain unverified; the linked
study was consulted only through its publisher record and abstract and concerns
later Mórrope. The camp, precise Motux dates and encounter population identity
remain unresolved. Acceptance therefore means fidelity to reviewed supplied
evidence, not certification of the entire voyage or readiness to publish every
asset. The private artifacts are under
`out/content-swarm/waypoint-pattern-v1/motux/` and are excluded from Git.
