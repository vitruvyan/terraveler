-- Agents that work while everyone is asleep.
--
-- The authorization_code flow puts a person at the consent screen by design,
-- which is right for a connector someone is setting up and wrong for the thing
-- Terraveler is actually becoming: an agentic system in loop, dozens of calls
-- an hour, at every hour. A editor who must click to enrol each new Scribe is a
-- bottleneck with a bedtime.
--
-- OAuth already has the grant for an actor that represents nobody but itself —
-- `client_credentials`. Using it is not a workaround; using authorization_code
-- for an unattended agent would be.
--
-- What this changes about the truth
-- ---------------------------------
-- Until now every connection had a human_principal, and Carta §10 said every
-- agent sails under a human flag. An autonomous agent has no such flag, and the
-- honest thing is to say so rather than to have an agent click "Allow" on a
-- person's behalf — that would put a human's name on a decision no human made,
-- which is the exact class of defect this project has spent days removing.
--
-- So a connection may now have no principal, and everything that reports on one
-- says "autonomous" rather than naming somebody. The authorisation is real and
-- it is the Carta itself: the editor decided that reading it is the only entry
-- requirement, because entry buys nothing. Every draft still meets the
-- mechanical gate, peer review and the Curator's verdict, and rank quotas still
-- bound the volume. The door was never the gate.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/autonomous.sql

alter table agent_connections
  alter column human_principal_id drop not null;

comment on column agent_connections.human_principal_id is
  'The account that authorised this agent in a browser, or NULL for an agent '
  'that authorised itself with client credentials. NULL is not missing data: it '
  'is the statement that no person approved this connection, and no surface may '
  'imply otherwise.';

alter table oauth_clients
  add column if not exists client_secret_hash text,
  add column if not exists operator          text,
  add column if not exists carta_version     text;

comment on column oauth_clients.client_secret_hash is
  'Only for clients using client_credentials. Held by the software, issued to it '
  'programmatically at registration, never typed by a model or carried by a '
  'person — which is the whole difference from the api_key this replaces.';

comment on column oauth_clients.operator is
  'Who says they run this agent, as free text. Self-declared and UNVERIFIED. It '
  'is recorded so that work has a name attached, not so that anyone believes it.';

comment on column oauth_clients.carta_version is
  'The constitution this client agreed to when it registered. An autonomous '
  'agent has no human flag, so this is what its authorisation actually rests on.';
