-- A work is the identity an edition is bound to: the same book scanned by two
-- archives, or translated twice, still names one work. Without this column
-- rag_docs only knew about editions — voyage_slug/source_url — and had no way
-- to say two rows were the same book. Codex Hunters pattern (canonical
-- vitruvyan-core, codex_hunters/consumers/binder.py), adapted for a text
-- corpus: ingest/codex.py computes work_id at ingestion time; null for image
-- docs, which were never bound to a work in the first place.
alter table rag_docs add column if not exists work_id text;
