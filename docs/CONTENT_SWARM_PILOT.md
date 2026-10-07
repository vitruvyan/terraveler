# Pizarro content swarm pilot

This is a private editorial research pilot: three GPT-4.1 researcher roles and
one separate GPT-4.1 review call, orchestrated by the existing native Motus
runtime. One explicit correction round may add three revised researcher calls
and a review, for at most eight paid calls. The human-authorized lifetime API allowance is **USD 2**, separate from
the Moltbook outreach pilot. Roles run sequentially. They have no shell, browsing,
database, messaging, submission or publication tools.

The first three missions prepare route passages for Motux/Vilcas, a proposed
Cajamarca image caption, and a paragraph introducing a later indigenous account.
The deliverables are English drafts, with exact source quotations, provenance,
limitations and review findings. They are not submissions already in the Desk.

## Run and inspect

Requires Python 3.10+ on Linux and `vitruvyan_motus` (the existing pinned wheel is
`ingest/wheels/vitruvyan_motus-0.14.0-py3-none-any.whl`). No new agent framework or
OpenAI SDK is needed. The runner reuses `scripts/outreach_core.py` for transport
and conservative accounting; it does not reuse the outreach ledger.

```bash
# Validate the source bundle and estimate; no API request.
python3 scripts/content_swarm.py --sources scripts/fixtures/content-swarm-pizarro.json

# Run the explicitly authorized pilot, or reuse completed cached calls.
python3 scripts/content_swarm.py --sources scripts/fixtures/content-swarm-pizarro.json --run

# Explicit correction of a completed first dossier rejected by its reviewer.
# Uses the same lifetime budget; repeats use the cache, not another round.
python3 scripts/content_swarm.py --sources scripts/fixtures/content-swarm-pizarro.json --run --revise
```

Credentials are read locally from environment/dotenv files using the existing
secret loader. `OPENAI_API_KEY` takes precedence; the pre-existing outreach API
key variable is a compatibility fallback. Credentials never enter the source
bundle, model input, dossier or Motus state.

Artifacts are stored under the ignored `out/content-swarm/` directory:

- `dossier.md` and `dossier.json`: drafts, evidence and separate automated review.
- `dossier-revision-1.md` and `.json`: the single explicit correction round;
  original outputs and attempt identities are retained.
- `budget.sqlite`: lifetime budget, source/mission fingerprint and durable paid
  attempt journal; private source text and generated drafts may occur in cached
  responses here.
- `spec.json` and `traces/`: graph specification and native Motus execution traces,
  with digests instead of source/draft words.

Every request reserves a conservative input bound and its output ceiling before
calling OpenAI. Actual token usage settles the reservation, without assuming any
cache discount. Errors retain reserves and halt the pilot. Provider usage beyond
the reserve persistently blocks the ledger. Calls are never retried automatically;
started/uncertain attempts require operator reconciliation, not another `--run`.
Keep the output directory: deleting the ledger or journal discards this protection.
Do not replace it to restart spending under the same authorization.

An exclusive lock prevents overlapping runs. Completed results are reused only
when their fingerprints match. Changing prompts, missions or the source bundle
does not silently purchase replacement results. Exit codes: 0 for preview or a
complete dossier awaiting a human; 2 for a dossier needing revision; 1 for a
stopped/failed run.

## Source basis and limits

This first pilot uses a **human-curated, fixed corpus**, not autonomous archive
discovery. Source hosts and PD/CC license labels are checked locally; these checks
do not independently prove the supplied license. Before preparing this bundle we
inspected each item, its rights statement and its edition. There is no open-web
spider or new ingestion into the canonical knowledge database.

- Motux: Francisco de Xerez in Markham's 1872 translation, printed p.32 / PDF
  page60. The Commons scan is a **1970 Burt Franklin reprint**. Only the historical
  body text is supplied; the modern imprint is not ingested. Attribution and
  edition must remain visible. Four days of rest are supported; an exact arrival
  date is not. Map stages4 and5 duplicate the same place.
- Vilcas: Pedro Sancho, chapterVIII of Means's 1917 English translation, Gutenberg
  ebook26602. Translator note45 identifies the narrative's `Bilcas` as `Vilcas`.
  This is a translated participant account, not an original manuscript: the
  translator's preface says the manuscript is lost. The selected chapter does not
  verify the map's existing `1533-10` arrival date.
- Image: Commons `Atawallpa_Pizarro_tinkuy.jpg`, credited to Guaman Poma. Metadata
  is CC BY-SA4.0; the image separately carries PD-old-100-expired / PDM1.0. It is
  **early seventeenth-century retrospective iconography**, not a 1532 eyewitness
  image. The available asset is only 400×569 pixels. Cajamarca placement is a
  proposed editorial association. The manuscript page mapping was not verified.
- Indigenous perspective: selected paragraphs of the conquest chapter in
  Wikisource revision1665689, a hosted CC BY-SA4.0 transcription of Guaman Poma's
  later chronicle. The supplied passage is Spanish, with indigenous terms. Its
  narrated speech is evidence of the author's portrayal, not proof of Atahualpa's
  exact historical words. The transcription has editorial caveats, and the
  narrative contains chronological divergences.

Sources and asset links are resolved from the vetted bundle, never invented by
the model. Mechanical checks demand contiguous quotes with original case and
punctuation (whitespace may differ), then copy the raw/readable span using the
existing `ingest/verbatim.py`. The separate review examines meaning, attribution,
dates, place associations and summaries. Exact quotation matching alone cannot
establish that a historical assertion is true. Review roles using the same model
also share possible biases.

`awaiting-human` means the automated checks and review passed; it does not mean
published, ingested, embedded or authorized by an editor. A rejected/incomplete
review fails closed to `needs-revision`. No research draft is placed in the
public atlas by this runner.

## Verification

```bash
PYTHONPATH=scripts:ingest python3 -m unittest test_content_swarm test_outreach_core
python3 -m vitruvyan_motus.contract.validate graphspec out/content-swarm/spec.json
# Supply the actual completed JSONL file from traces/ below.
python3 -m vitruvyan_motus.contract.validate jsonl RUN.jsonl --spec out/content-swarm/spec.json
```

Use the runtime's actual trace version. The installed 0.14.0 kernel emits schema
3.1.0; the older 1.1 reference in the repository charter must not be used to relabel
its output. The graph declares replay `none`: network, cached responses and local
ledger effects are not re-executed by pure-node replay. Contract validation checks
the trace structure; it is not a claim that model answers were verified by replay.

## Observed pilot result (7 October 2026)

The authorized pilot completed the four initial calls and four explicit revision
calls. Cumulative usage-based accounting was **USD 0.113418**, with no pending
reservations and USD 1.886582 remaining under the original ceiling. Both completed
Motus traces passed contract validation with the graph specification.

All three missions still required revision after the correction round. Real
outputs included changed quotations, quotations drawn from provenance notes
rather than historical source text, unsupported prose and an overlong quotation.
The reviewer also needed an explicit reminder that summaries can paraphrase:
only quotation fields must be verbatim. The pilot did not produce a publication
approval, autonomous archive discovery or a complete corrected voyage. These
results are retained privately in `out/content-swarm/`; the runner does not hide
failed drafts or repeat spending until it gets a pass.

The expanded editorial audit of all seventeen existing route records found a
separate problem in the historical data: out-of-order events, conflated side
expeditions, wrong modern place identifications, duplicated stops and quotations
that did not support their associated event. Private route, media/ethnography and
review artifacts are prepared under the same output directory. This is separate
evidence-based editorial work; it must not be described as accepted output of
the rejected GPT-4.1 drafts.
