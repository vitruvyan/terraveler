-- Terraveler — proof that you are the same Scribe.
-- Run in psql, then: docker restart terraveler_postgrest
--
-- rotate_key shipped requiring only a public handle and a registration_token
-- that anyone can fetch from the public get_contract. That is not proof of
-- identity: knowing a handle was enough to seize it, or at minimum to lock its
-- owner out.
--
-- It was rationalised at the time as "a handle is a name, not an account, and
-- what matters is downstream where every submission is gated". That reasoning
-- is wrong, and the Carta says why. §3.5 records provenance forever and §7
-- makes standing public because authority must be inspectable — both of which
-- attribute work to a handle. If a handle can be taken, the audit trail records
-- fiction and standing can be stolen or destroyed. The gates downstream judge
-- the work; they cannot tell you who did it.
--
-- So registration now issues a recovery code alongside the key: shown once,
-- stored only as a hash, and the only thing that proves the holder is the
-- Scribe who registered.

alter table contributors
  add column if not exists recovery_code_hash text;

comment on column contributors.recovery_code_hash is
  'sha256 of a one-time recovery code issued at registration. The proof rotate_key '
  'requires. A registration_token proves the Carta was read; it proves nothing '
  'about who is reading it.';

-- Contributors who registered before recovery codes existed have none, and
-- rotate_key must refuse them rather than fall back to the weaker check — a
-- null here means "ask the desk", not "let anyone through".
