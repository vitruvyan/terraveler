-- Terraveler RAG corpus — self-hosted pgvector.
-- Embeddings: nomic-embed-text-v1.5 / nomic-embed-vision-v1.5 (768-dim, shared latent space).
-- Text and image vectors coexist in one table, same space → cross-modal cosine search.

create extension if not exists vector;

create table if not exists rag_docs (
  id          bigint generated always as identity primary key,
  voyage_slug text not null,
  type        text not null check (type in ('text', 'image')),
  title       text,
  content     text not null,      -- text chunk OR image caption/description (what's embedded)
  source_url  text,
  license     text,
  credit      text,
  media_url   text,               -- images: the actual image URL
  chunk_index int,
  embedding   vector(768),
  created_at  timestamptz default now()
);

create index if not exists rag_docs_embedding_idx
  on rag_docs using hnsw (embedding vector_cosine_ops);
create index if not exists rag_docs_voyage_idx on rag_docs (voyage_slug);

-- Cosine similarity search, scoped to a voyage (optionally filter by type).
create or replace function match_rag_docs(
  query_embedding vector(768),
  match_count int default 8,
  voyage text default null,
  want_type text default null
)
returns table (
  id bigint, voyage_slug text, type text, title text, content text,
  source_url text, license text, credit text, media_url text,
  similarity float
)
language sql stable
as $$
  select d.id, d.voyage_slug, d.type, d.title, d.content, d.source_url,
         d.license, d.credit, d.media_url,
         1 - (d.embedding <=> query_embedding) as similarity
  from rag_docs d
  where (voyage is null or d.voyage_slug = voyage)
    and (want_type is null or d.type = want_type)
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- Audit trail for AXIS ingestion runs (the GraphState trace, persisted).
create table if not exists ingestion_runs (
  id          bigint generated always as identity primary key,
  trace_id    text not null,
  voyage_slug text,
  policy      text,
  started_at  timestamptz,
  finished_at timestamptz,
  facts       int,
  chunks_embedded int,
  chunks_rejected int,
  trace       jsonb,              -- full GraphState trace
  created_at  timestamptz default now()
);
