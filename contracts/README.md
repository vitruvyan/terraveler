# Contracts — the wire's law

One JSON Schema per event type, plus the envelope every event wears.
Design and rationale: `docs/SHIPS_OFFICERS.md` §7. In force under Magna
Carta v0.7 §11.

Rules of the directory:

- **A contract is versioned in its filename** (`verdict.issued.v1.json`).
  Additive change bumps nothing visible here; breaking change is a new
  file, and the old one stays until no consumer declares it.
- **`owner` names the only emitter.** For editorial and crew events the
  owner is the `audit_log` trigger (`supabase/events_outbox.sql`) — the
  ledger announces, application code never does. Ops events name their
  future emitters and say so; a contract may precede its emitter, never
  the reverse.
- **Enforcement is `strict` at two boundaries**: the outbox write (for
  ledger-derived events, conformity is by construction — the trigger
  builds the payload from the canonical row inside the same transaction)
  and the dispatcher, which validates before seeding any officer's run
  and dead-letters what fails. Nothing between the boundaries interprets.
