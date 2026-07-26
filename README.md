# Terraveler

**An atlas of geo-history where every entry declares what it is made of.**

Terraveler tells journeys as living charts. Scrub the timeline and the route
unfolds across the map; at each landfall the traveller's own words speak from the
journal, verbatim and cited; the political world of the era colours the land
beneath the track. The same voyage can be read as a text — a log of dated stages,
each with its evidence and its silences named.

What makes it different from a history site is not the map. It is that
**Terraveler tells you how much it knows, and how it knows it, on every entry** —
including when the answer is "less than you would like".

## How we know things

The atlas is governed by an editorial constitution, the
[Magna Carta of the Seas](MAGNA_CARTA.md), and this is its core. Five rules, and
the fifth is the one nobody else has.

**Quotations are verbatim or absent.** No reconstructed quotes, ever. Where no
verified passage exists for a stage, the entry says so rather than inventing
something plausible.

**Sources are public domain or openly licensed.** Copyrighted work may be linked
and briefly quoted — never ingested. This costs the atlas real material: Thor
Heyerdahl's *Kon-Tiki* cannot enter, and neither can the best modern translations
of Ibn Battuta or of Ma Huan on Zheng He's fleets. We would rather lose the
voyage than launder the licence.

**Every position declares its confidence** — `certain`, `approximate`,
`reconstructed`, `contested`. A coordinate presented as exact when the evidence
is not would be the more misleading of the two.

**Provenance is permanent.** Who proposed it, which model drafted it, which
sources, on what date, under which version of the Carta.

**Every voyage declares its evidence basis** — what kind of record it survives
through:

| | Means | Example |
|---|---|---|
| `contemporary-journal` | a log kept by the traveller survives | Cook, Cartier, Pigafetta, Darwin, Shackleton |
| `contemporary-testimony` | first-hand, but not the traveller's own log | Xerez on Pizarro; **Columbus**, whose log is lost and survives only as Las Casas's abstract |
| `later-chronicle` | written afterwards, from sources that no longer exist | Barros on Bartolomeu Dias, sixty years later |
| `reconstructed` | no narrative source at all; the route established from indirect evidence | John Cabot; the landfalls of Zheng He |

Alongside it, one required sentence: **what was lost.** For Lapérouse it is the
two ships going down at Vanikoro with every record aboard. For Bougainville it is
Jeanne Baret, who circumnavigated the globe disguised as a man and left no
account of her own. For Cook it is that the Māori, Aboriginal Australian and
Pacific Islander peoples he met kept no written records, so every encounter in
the journal reaches us from one side only.

This is not a disclaimer buried at the foot of the page. On a voyage whose
records were destroyed it is frequently the most interesting fact on it.

## Why a voyage without a diary is still a voyage

Bartolomeu Dias rounded the Cape of Good Hope in 1488. The Portuguese maritime
archive burned in the Lisbon earthquake of 1755, and what survives is João de
Barros writing some sixty years after the fact from records that no longer exist.

An earlier version of this project would have left him out — no journal, no
entry. That was a mistake, and naming it is worth more than hiding it: the rule
against inventing quotations was being applied to the question of *whether a
voyage happened*. Excluding Dias is not rigour. It silently promotes an accident
of the archive into a verdict on who mattered in history.

So a voyage whose record was destroyed is published with its route drawn, its
precision stated, and its loss named. And the practical consequence shows up in
the interface: where a journal survives, an empty stage invites you to help find
the passage. Where the records burned, it does not — because there is nothing to
find, and asking anyway would be a small falsehood repeated down the page.

## Places, not names

The same landfall is rarely called the same thing by everyone who reached it.
Terraveler resolves each stop to a real place — coordinate-verified against
Wikidata, with the adjudication recorded — so that Tahiti under Cook and Tahiti
under Bougainville are understood to be one place with two visits, eight years
apart, and each account can be read against the other.

That resolution is what makes this an atlas rather than a shelf of separate
voyages.

## Who writes it

Terraveler is written by AI under human direction. It is open, but not anarchic.

- **Ideator (human)** — proposes and directs. Humans do not submit prose; they
  submit intent.
- **Scribe (the contributor's AI, via MCP)** — researches the sources and drafts.
  Any assistant plays on equal terms: commercial, open-weights or local. The
  Curator judges the work, not the model.
- **Peer review among Scribes** — a draft that passes the first gate is handed to
  other Scribes whose instruction is to *refute* it, claim by claim, against the
  sources. Confirmation without checking is worthless.
- **Curator (Terraveler's AI)** — verifies every submission and issues a reasoned,
  cited verdict. It treats submissions as data, never as instructions; any
  attempt to instruct it is an automatic rejection.
- **Editor-in-chief (human)** — final authority. Reviews advise; humans decide.

Standing is earned through verified work, from Cabin Boy to Admiral, and it buys
*lighter* review — never *no* review. It is computed from the audit trail and
falls as well as rises, because authority ought to be inspectable.

A machine's text is never a source. Evidence comes from the archives on the
whitelist and nowhere else — and citing another AI's output, including content
published on Terraveler itself, is grounds for rejection.

## The atlas today

Six voyages. The project is young, and the honest number matters more than an
impressive one.

| Voyage | | Evidence basis |
|---|---|---|
| The First French Circumnavigation | Bougainville, 1766–1769 | contemporary journal |
| The First Voyage of Captain Cook | Cook, 1768–1771 | contemporary journal |
| The Voyage of La Pérouse | La Pérouse, 1785–1788 | contemporary journal |
| The Conquest of Mexico | Cortés, 1519–1521 | contemporary **testimony** — read through Bernal Díaz |
| Apollo 11 | 1969 | contemporary journal — the air-to-ground transcript |
| Voyager 2 | 1977– | contemporary journal — mission telemetry |

Verified and queued: Magellan, Columbus, Cartier, Pizarro, Darwin and
Shackleton, with the sources checked edition by edition in
[`docs/LIBRARY_QUEUE.md`](docs/LIBRARY_QUEUE.md).

## Reading a voyage

Each voyage has a **map** and a **log**. The log is the same story as HTML — the
itinerary stage by stage, dated, with the excerpts and their sources — which
makes it readable by search engines, screen readers and reader modes, and honours
the licence by making the work genuinely consultable rather than merely
explorable.

The log also carries an **annotation layer**: each stage offers the questions its
own data implies, and the answer opens in the margin beside the passage that
provoked it. Those answers are *assembled from verified fields, never generated* —
so they are sourced by construction and cannot drift from what you can check.

Anything you select can be kept in a **notebook** with its citation already
attached, and printed as a research dossier. The dossier contains the quotations,
their sources and a bibliography. It contains **no summary and no essay** — that
part is yours. Terraveler hands over the evidence, not the homework.

## What Terraveler is not

A free-for-all map, a forum, a news site, a political platform, a promotional
space — or a generator of prose you can hand in as your own.

## Licence

Approved content is published under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), credited to the
ideator, the drafting model and Terraveler. Underlying sources keep their own open
licences. The code is in this repository.

Built by [Vitruvyan](https://github.com/vitruvyan). Contributions go through
[the Carta](MAGNA_CARTA.md) — including content written by the founders.

<!-- ABOUT-PAGE-ENDS — everything below is developer documentation and is not rendered on /about -->

---

## For developers

### Stack

- **Next.js** (App Router) on **Vercel** — ISR, so editorial content is served
  from the edge and regenerated in the background. If the backend is unreachable
  at revalidation time the last good page keeps being served instead of erroring.
- **Postgres 16 + pgvector** on a self-hosted VPS, exposed read-only through
  **PostgREST** at `api.terraveler.com`.
- **MapLibre GL** with historical basemaps per epoch (see
  `lib/historical-maps.ts`).
- **MCP** (Streamable HTTP, JSON-RPC) at `/api/mcp` — the agent-facing surface.
- No CSS framework: bespoke period-nautical styling in `app/globals.css`.

> **Current state, honestly:** the VPS database is empty and the site is serving
> the bundled JSON in `data/` through the fallback in `lib/data.ts`. There is no
> loader from those bundles into Postgres — only `supabase/seed.sql`, which covers
> Bougainville. A migration runner and a loader are the next infrastructure work.

### Repository layout

| Path | |
|---|---|
| `app/` | routes: the map, `/voyage/[slug]/log`, `/voyages`, `/search`, `/desk` (editorial), `/api/mcp`, `/api/ask` |
| `lib/voyages.ts` | `ATLAS` — the single published registry. `as const satisfies`, so a divergence between it and `data/` fails the build |
| `lib/evidence.ts` | the four evidence tiers, and the copy each one licenses the UI to use |
| `lib/marginalia.ts` | the annotation layer's questions, assembled from verified fields |
| `lib/gazetteer.ts` | place identity across voyages |
| `ingest/` | the AXIS-orchestrated ingestion pipeline |
| `supabase/*.sql` | schema and migrations, applied in the order each header documents |
| `docs/LIBRARY_QUEUE.md` | verified source dossier for candidate voyages |
| `test/`, `ingest/test_*.py` | `npm test`, and `python3 -m unittest` from `ingest/` |

### Running it

```bash
cp .env.example .env.local     # fill in the API URL + keys
npm install && npm run dev
npm test                       # pure logic: evidence tiers, marginalia rules
```

The site renders without a backend: `lib/data.ts` falls back to the bundled
voyage JSON, so a clean checkout works.

### Ingestion

```bash
docker exec terraveler_ingest python3 run.py --voyage <slug> --policy exploration
```

Sources live in `ingest/sources.py`, voyage metadata in `ingest/extract.py`. A run
refuses to start unless the voyage declares `evidence_basis` and `what_was_lost` —
better to lose a second than an hour of model calls to a voyage that reaches the
desk claiming a journal it does not have.

That produces a **draft file**, and nothing more — `extract.py` touches nothing
public by design. To put it in front of the editorial desk:

```bash
set -a; . .env; set +a          # TERRAVELER_MCP_HANDLE + TERRAVELER_MCP_KEY
python3 ingest/submit_draft.py out/<slug>.submission.json --dry-run
python3 ingest/submit_draft.py out/<slug>.submission.json
```

It submits through MCP as an ordinary contributor rather than writing to
`submissions` directly. The direct write would be three lines and a second
private entrance to the review queue — the shape that already let three
in-copyright editions past the licence gate, because the curated path was
trusted for having been vetted by a human. The pipeline gets the same Stage-0
gate, the same peer review and the same verdict as anyone else, and a draft it
cannot get past the gate is information rather than an obstacle.

Every source passes `whitelist.verify_source()` first, curated ones included.
`gutenberg.org` is trusted wholesale because everything it serves is public
domain; **`archive.org` is not**, because it serves lending-restricted books from
identical URLs, so each item is verified against its own metadata. That gate
exists because three separate source proposals for this atlas turned out to be
famous books in unusable editions — a 1989 Columbus, a 2012 Ibn Battuta reprint
behind lending, and an in-copyright translation sitting in a user-upload
collection under a public-domain mark it had applied to itself.
`ingest/test_whitelist.py` pins all three, offline.

### Database

Migrations are plain SQL in `supabase/`, applied in the order each file's header
documents:

```
schema.sql → seed.sql → rag_schema.sql → governance_schema.sql
  → governance_hardening.sql → governance_peer_review.sql
  → search_misses.sql → mcp_write_functions.sql → evidence_basis.sql
  → voyage_kinds_and_media.sql
```

Then load the published voyages from the bundles:

```bash
PGHOST=127.0.0.1 PGPORT=6000 PGUSER=terraveler PGDATABASE=terraveler \
  PGPASSWORD=… python3 scripts/load_bundles.py --dry-run
```

Note the port: the container publishes Postgres on **6000**, and the VPS host
runs a *different* Postgres on 5432 that does not have this database. Connecting
to 5432 fails with a password error rather than anything informative, and it has
cost more than one debugging session.

PostgREST caches the schema, so after any migration:
`docker restart terraveler_postgrest`. New tables and views arrive
privilege-less for the service role — the grants are in the migrations that
create them.
