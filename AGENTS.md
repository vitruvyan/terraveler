# Terraveler — Agent Working Charter

## What this is
Terraveler is a laboratory for **advanced, multi-agent, human-in-the-loop
geo-historical divulgation**: orchestrated agents that discover, curate, embed,
and narrate the history of voyages and explorers from public-domain sources —
with a human authorizing what goes public. It began as a chrono-diary of
navigation (terraveler.com); the direction is a **geospatial wiki** of cultured,
sourced knowledge. A Vitruvyan EOOD project.

## Two planes
- **Front / app** — Next.js (App Router) on Vercel; Supabase for app data + Auth
  (the Editorial **Desk**, Google login). The public site and the place where a
  human authorizes content.
- **Backend / knowledge** — self-hosted on the VPS (`caravaggio@161.97.140.157`),
  isolated on `terraveler_net`; no open-web, no third-party embedding tokens:
  - `terraveler_postgres` — pgvector (768-d)
  - `terraveler_embedding` — nomic text+vision, self-hosted, **zero-token**
  - `terraveler_rag` — `/chat` (the **AXIS-orchestrated** Pigafetta pipeline) + `/rag/search`
  - `terraveler_ingest` — **AXIS** batch: `discover → curate → fetch → chunk → embed → upsert`

## The content pipeline (product agents)
Orchestrated by **AXIS** (immutable GraphState trace = the audit):
1. **Oculus** — harvests candidate sources over a strict **whitelist**
   (Gutenberg, Wikipedia/Wikisource, Commons — PD/CC only). Never spiders the open web.
2. **Curator** (gpt-4.1, scored 0-3 rubric) — drops off-topic noise; every drop is auditable.
3. **Embed** — self-hosted nomic → pgvector.
4. **Pigafetta** (gpt-4.1) — answers ONLY from retrieved sources and cites them; guarded by the AXIS `evaluate` gate.
5. **Human (Desk)** — authorizes publication, can retract. The Magna Carta's final authority.

## Principles (non-negotiable)
1. **Sources are sacred.** PD/CC whitelist only; no fabricated quotes; copyrighted sites are linked, never ingested.
2. **Human in the loop.** The machine proposes and prepares; a human authorizes what becomes public.
3. **Audit everything.** Every ingestion and every answer leaves an AXIS trace.
4. **Reuse before building.** Extend what exists — React components, the VPS services, the AXIS kernel.
5. **Spend intelligence where it has leverage.** Embeddings are self-hosted (zero token, high volume); LLM spend is reserved for once-per-item judgment (curation, generation). Cheap models for mechanical work, powerful models for the hard calls.
6. **English is canonical.** CC BY-SA, wiki-style.

## How WE build it
Development itself is multi-agent, by the same rule as the product: **match model
power to task difficulty.** See **SUBAGENTS.md** (which model for which dev task)
and **SKILLS.md** (repeatable procedures).
