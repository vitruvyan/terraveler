-- Terraveler governance backend — v0 (Magna Carta of the Seas, v0.1)
-- Run in the Supabase SQL editor AFTER schema.sql / rag_schema.sql.
-- Tables: contributors (Ship's Ranks), submissions (state machine),
-- audit_log (append-only provenance), editorial_gaps (public roadmap).

-- ---------------------------------------------------------------- contributors
create table if not exists contributors (
  id           bigint generated always as identity primary key,
  handle       text unique not null,          -- public name; auth link added later
  auth_user_id uuid,                          -- Supabase Auth (nullable until signup ships)
  rank         text not null default 'cabin-boy'
               check (rank in ('cabin-boy','deckhand','navigator','captain','admiral')),
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------- submissions
create table if not exists submissions (
  id             bigint generated always as identity primary key,
  contributor_id bigint not null references contributors(id),
  type           text not null,               -- e.g. waypoint-enrichment, new-voyage
  target_voyage  text,
  payload        jsonb not null,              -- the full structured submission
  status         text not null default 'submitted'
                 check (status in ('submitted','curator-rejected','human-review',
                                   'changes-requested','approved','rejected')),
  carta_version  text not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ---------------------------------------------------------------- audit log
-- Append-only. Every decision about every submission lives here forever.
create table if not exists audit_log (
  id            bigint generated always as identity primary key,
  submission_id bigint references submissions(id),
  actor         text not null,                -- 'curator-v0' | 'editor-in-chief' | ...
  action        text not null,                -- 'verdict' | 'appeal' | 'amendment' | ...
  verdict       text,                         -- 'reject' | 'human-review' | 'approve' | ...
  findings      jsonb,                        -- [[level, stage, message], ...]
  carta_version text,
  created_at    timestamptz default now()
);

-- Contributor standing, computed from the audit trail (never stored by hand).
create or replace view contributor_standing as
select c.id, c.handle, c.rank,
       count(*) filter (where a.actor = 'editor-in-chief' and a.verdict = 'approve')  as approvals,
       count(*) filter (where a.verdict in ('reject'))                                as rejections,
       count(*) filter (where a.actor = 'curator-v0' and a.verdict = 'human-review')  as passed_curator
from contributors c
left join submissions s on s.contributor_id = c.id
left join audit_log a on a.submission_id = s.id
group by c.id, c.handle, c.rank;

-- ---------------------------------------------------------------- editorial gaps
-- The public roadmap behind the future MCP `list_gaps` capability:
-- the site says what it wants; Scribes work a curated backlog, not chaos.
create table if not exists editorial_gaps (
  id          bigint generated always as identity primary key,
  title       text not null,
  description text,
  kind        text not null check (kind in ('voyage','waypoint','media','perspective','translation','correction')),
  priority    int not null default 3,          -- 1 = most wanted
  status      text not null default 'open' check (status in ('open','claimed','done')),
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------- RLS
alter table contributors   enable row level security;
alter table submissions    enable row level security;
alter table audit_log      enable row level security;
alter table editorial_gaps enable row level security;

-- The roadmap is public; everything else is service-role only (RLS no-policy).
create policy "public read gaps" on editorial_gaps for select using (true);

-- ---------------------------------------------------------------- seed the roadmap
insert into editorial_gaps (title, description, kind, priority) values
  ('The voyage of La Perouse (1785-1788)',
   'Second flagship voyage: journals are public domain; the disappearance at Vanikoro is a natural test of the contested/reconstructed confidences.',
   'voyage', 1),
  ('Cook''s first voyage (1768-1771)',
   'Endeavour departs while Bougainville sails home — ties directly into the existing world-events timeline.',
   'voyage', 2),
  ('Period imagery for Batavia, Port Praslin and the Strait of Magellan',
   'PD/CC engravings or maps from Wikimedia Commons / Gallica for landfalls that currently have no media.',
   'media', 2),
  ('The Tahitian counter-perspective',
   'Ahutoru''s journey to Paris and the encounter seen from the shore; sources exist in Diderot and secondary PD literature.',
   'perspective', 1),
  ('French-journal cross-references for existing waypoints',
   'Link each Forster (EN) diary excerpt to the corresponding passage in the 1771 French original (Gutenberg #28485).',
   'correction', 3)
on conflict do nothing;
