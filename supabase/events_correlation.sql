-- Terraveler events — correlation_id, aligned to the canonical Conclave.
-- Run in psql AFTER events_outbox.sql (fresh installs get the column from
-- the updated create table; this ALTER is for databases that applied the
-- outbox before the alignment).
--
-- The canonical Synaptic Conclave envelope (vitruvyan-core,
-- events/event_envelope.py) carries correlation_id to group the events of
-- one causal chain, beside causation_id (immediate parent) and trace_id
-- (root). Our envelope had the other two; aligning while the table is
-- empty costs one ALTER — aligning after a relay exists would cost a
-- migration of live consumers.

alter table events add column if not exists correlation_id text;
