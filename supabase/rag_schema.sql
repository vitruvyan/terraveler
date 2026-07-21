-- Terraveler RAG — Bougainville v1. Run in the Supabase SQL editor.
-- Embeddings: Google text-embedding-004 (768 dims). Images are indexed by a
-- Gemini-generated description (Path A); media_url points at the actual image.

create extension if not exists vector;

create table if not exists rag_docs (
  id          bigint generated always as identity primary key,
  voyage_slug text not null default 'boudeuse-1766',
  type        text not null check (type in ('text', 'image')),
  title       text,               -- source / image title
  content     text not null,      -- text chunk OR image description (what's embedded)
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

-- Cosine similarity search, scoped to a voyage.
create or replace function match_rag_docs(
  query_embedding vector(768),
  match_count int default 8,
  voyage text default 'boudeuse-1766'
)
returns table (
  id bigint, type text, title text, content text,
  source_url text, license text, credit text, media_url text,
  similarity float
)
language sql stable
as $$
  select d.id, d.type, d.title, d.content, d.source_url, d.license, d.credit, d.media_url,
         1 - (d.embedding <=> query_embedding) as similarity
  from rag_docs d
  where d.voyage_slug = voyage
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

alter table rag_docs enable row level security;
create policy "public read rag_docs" on rag_docs for select using (true);
-- Inserts are done by the ingestion script using the service-role key (bypasses RLS).
