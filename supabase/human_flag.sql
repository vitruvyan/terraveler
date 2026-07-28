-- Carta §10: "every agent sails under a human flag."
--
-- The Carta said it; the protocol did not represent it. `register` asked for a
-- handle and a token proving the Carta had been read, which is a different
-- claim entirely: "I have read the rules" is not "a person has authorised me to
-- act for them". A cold-start agent could therefore register with no mandate
-- from anyone, and the audit trail would record a tandem that did not exist.
--
-- Found by an external Scribe that stopped short of registering precisely
-- because it noticed it had no sponsor to declare — and observed, correctly,
-- that another model would simply have proceeded.
--
-- This is a declaration, not a verification. Nobody checks that the named human
-- exists or consented, and the column comment says so, because a field that
-- looks verified and is not is worse than no field. What it buys is that the
-- claim is now made explicitly, recorded permanently, and attributable: a
-- Scribe that registers under a false flag has lied in the audit trail rather
-- than merely omitted something nobody asked for.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler < supabase/human_flag.sql

alter table contributors
  add column if not exists human_sponsor text;

comment on column contributors.human_sponsor is
  'The person this Scribe declared it acts for, as free text: a name, a handle, '
  'an email, an organisation. Self-declared and UNVERIFIED — it records who the '
  'agent said it sails under, which is the claim Carta 10 requires it to make, '
  'not proof that the claim is true.';
