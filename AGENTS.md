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
  - `terraveler_rag` — `/chat` (the **Motus-orchestrated** Pigafetta pipeline) + `/rag/search`
  - `terraveler_ingest` — **Motus** batch: `discover → curate → fetch → codex (restore·bind) → chunk → embed → upsert`

## The content pipeline (product agents)
Orchestrated by **Motus** (immutable trace = the audit).

*Where the kernel stands:* every pipeline is a native Motus graph —
`GraphSpec` + `Runtime`, trace schema 1.1, accepted by `contract/validate.py`.
`vitruvyan_motus.compat` is gone from the running code; the retired Axis graph
survives only inside `ingest/test_extract_parity.py`, where it serves as the
oracle the ported extractor is measured against.

What that buys, and what it does not. Traces are now real evidence: every read
a node performed, every write it committed, every effect it observed, and a
routing record naming the decision each branch dispatched on. Replay is
another matter — `verify()` re-executes `pure` nodes only, and most nodes here
read the open web or the database, so coverage is 6 nodes of 28. Each graph
declares its own replay capability rather than letting the default claim
`none` by accident. Say "verified by replay" only of a `pure` node.
1. **Oculus** — harvests candidate sources over a strict **whitelist**
   (Gutenberg, Wikipedia/Wikisource, Commons — PD/CC only). Never spiders the open web.
2. **Curator** (gpt-4.1, scored 0-3 rubric) — drops off-topic noise; every drop is auditable.
3. **Codex** (deterministic, no LLM) — harvests nothing, judges nothing: restores structurally, scores structural validity, dedupes and binds editions to works; every drop auditable in the trace.
4. **Embed** — self-hosted nomic → pgvector.
5. **Pigafetta** (gpt-4.1) — answers ONLY from retrieved sources and cites them; guarded by the Motus `evaluate` gate.
6. **Human (Desk)** — authorizes publication, can retract. The Magna Carta's final authority.

## Principles (non-negotiable)
1. **Sources are sacred.** PD/CC whitelist only; no fabricated quotes; copyrighted sites are linked, never ingested.
2. **Human in the loop.** The machine proposes and prepares; a human authorizes what becomes public.
3. **Audit everything.** Every ingestion and every answer leaves a trace.
4. **Reuse before building.** Extend what exists — React components, the VPS services, the Motus kernel.
5. **Spend intelligence where it has leverage.** Embeddings are self-hosted (zero token, high volume); LLM spend is reserved for once-per-item judgment (curation, generation). Cheap models for mechanical work, powerful models for the hard calls.
6. **English is canonical.** CC BY-SA, wiki-style.

## How WE build it
Development itself is multi-agent, by the same rule as the product: **match model
power to task difficulty.** See **SUBAGENTS.md** (which model for which dev task)
and **SKILLS.md** (repeatable procedures).

**Anything visual — a page, a component, CSS, a size, a colour — is governed by
`.claude/skills/terraveler-design/`.** It loads itself when the work is visual;
read it before styling rather than after. The tokens it points at live in
`:root` of `app/globals.css` and the system is rendered with real content at
`/specimen`. More than one agent works in this repo: the law is written down so
we build the same site.
