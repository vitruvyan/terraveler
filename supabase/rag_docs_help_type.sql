-- Pigafetta learns to answer "how do I use this site" questions (Phase 5
-- follow-up, not a Carta change: this is UI/process help, not historical
-- content, so none of the source-integrity rules move).
--
-- rag_docs.voyage_slug is NOT NULL, so site-help chunks get the sentinel
-- '_site_help' rather than a real voyage slug -- match_rag_docs(...) already
-- treats a NULL `voyage` argument as "any voyage_slug", which is what lets
-- rag/app/chat_graph_native.py's retrieve() ask for help chunks independent
-- of whichever voyage page the question was actually asked from.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

alter table rag_docs drop constraint rag_docs_type_check;
alter table rag_docs add constraint rag_docs_type_check
  check (type = any (array['text', 'image', 'help']));

commit;
