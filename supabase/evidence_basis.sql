-- Terraveler — what kind of record a voyage survives through.
-- Run in psql against the terraveler database, then:
--   docker restart terraveler_postgrest
-- (PostgREST caches the schema; new columns are invisible until it reloads.
--  Table-level SELECT grants already cover new columns, so no new grants.)
--
-- Why
-- ---
-- `waypoints.confidence` says how sure we are of a position. The excerpt is
-- verbatim or absent. Neither says what kind of record the voyage as a whole
-- comes down to us through, so the log page printed one sentence for two very
-- different silences: "No verified journal excerpt for this stage yet — help
-- us find one."
--
-- For Cook that is true and useful: the journal exists, the gap is ours, a
-- reader can close it. For Bartolomeu Dias it is false. There is no passage to
-- find. The Portuguese maritime archive burned in the Lisbon earthquake of
-- 1755 and the route survives only through João de Barros, writing sixty years
-- later. Inviting a reader to go looking is inviting them to search ashes.
--
-- Worse, the missing distinction pushed the desk toward simply leaving such
-- voyages out — which quietly promotes an accident of the archive into an
-- editorial verdict on who mattered in history. Dias rounded the Cape. Magna
-- Carta §3 promises we never invent a quotation; it has never said a voyage
-- without quotations did not happen.
--
-- Note the backfill below corrects a voyage already published before it admits
-- any new one: Cortés is read here through Bernal Díaz, a participant writing
-- four decades afterwards, which is testimony and not a log.

alter table voyages
  add column if not exists evidence_basis text,
  add column if not exists what_was_lost  text;

-- NULL is permitted and means "not yet classified": the application then keeps
-- its original wording rather than asserting a journal that may not exist.
-- Defaulting the absence to 'contemporary-journal' would reintroduce exactly
-- the overstatement this column exists to prevent.
do $$
begin
  alter table voyages add constraint voyages_evidence_basis_check
    check (evidence_basis is null or evidence_basis in (
      'contemporary-journal',   -- the traveller's own log survives
      'contemporary-testimony', -- first-hand, but not the traveller's log
      'later-chronicle',        -- written afterwards from sources now lost
      'reconstructed'           -- no narrative source; route from indirect evidence
    ));
exception when duplicate_object then null;
end $$;

comment on column voyages.evidence_basis is
  'What kind of record this voyage survives through. Drives how the log page '
  'describes a stage with no excerpt, and whether it invites the reader to go '
  'looking for one. See lib/evidence.ts.';
comment on column voyages.what_was_lost is
  'One sentence naming what is missing from the record and how it went. '
  'Rendered as content, not as a disclaimer: for a voyage whose sources were '
  'destroyed this is often the most interesting fact on the page.';

-- ---------------------------------------------------------------- backfill

update voyages set
  evidence_basis = 'contemporary-journal',
  what_was_lost  = 'Bougainville kept and published his own journal, so the voyage is well recorded — except for one person aboard it. Jeanne Baret sailed on the Étoile disguised as a man, and became the first woman to circumnavigate the globe. She left no account of her own: her voyage survives only in what the men around her wrote about her.'
where slug = 'boudeuse-1766';

update voyages set
  evidence_basis = 'contemporary-journal',
  what_was_lost  = 'The journals and charts up to Botany Bay were sent overland to Paris in February 1788 and survive. Everything after that date went down with both ships at Vanikoro — the logs, the charts, the crews. The final months are known only from the wrecks and from Islander testimony collected decades later.'
where slug = 'boussole-1785';

update voyages set
  evidence_basis = 'contemporary-journal',
  what_was_lost  = 'Cook''s journal survives complete. What is absent is the other side of every encounter in it: the Māori, Aboriginal Australian and Pacific Islander peoples he met kept no written records, and their own accounts of these meetings were not collected until long afterwards, if at all.'
where slug = 'cook-1768';

update voyages set
  evidence_basis = 'contemporary-testimony',
  what_was_lost  = 'The account followed here is Bernal Díaz del Castillo''s — a soldier who was present, writing some four decades later from memory, in old age, to correct historians he thought had flattered Cortés. The Mexica side of these events survives only in compilations made after the conquest, under Spanish supervision.'
where slug = 'cortes-1519';

update voyages set
  evidence_basis = 'contemporary-journal',
  what_was_lost  = 'Nothing. The air-to-ground transcript, the onboard recorders and the telemetry all survive in full, and the crew were narrating as it happened. It is the only voyage in this atlas of which that can be said.'
where slug = 'apollo-11';

update voyages set
  evidence_basis = 'contemporary-journal',
  what_was_lost  = 'The telemetry and imaging survive in full and were recorded as the encounters happened. What no record can supply is any account of these places from someone who was there: nobody was aboard.'
where slug = 'voyager-2';

-- Anything still NULL is unclassified, not journal-based. Review before
-- publishing further voyages:
--   select slug, title from voyages where evidence_basis is null order by slug;
