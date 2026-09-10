-- Client credentials for agents that work without an interactive human.
--
-- BASE MIGRATION NOTE (September 2026)
-- ------------------------------------
-- This migration makes human association optional and adds the credential
-- fields required by `client_credentials`. Run `agent_identity.sql` afterwards:
-- that migration introduces the actual persistent first-class `agent_account`.
-- A NULL human_principal_id therefore means only "no human association on this
-- connection"; it is NOT the agent's identity.
--
-- `client_credentials` is the correct OAuth grant for unattended software. The
-- durable Terraveler identity, standing and status live on agent_accounts /
-- contributors after agent_identity.sql. Carta acceptance is policy acceptance,
-- not proof of real-world identity; `operator` remains self-declared provenance.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/autonomous.sql
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/agent_identity.sql

alter table agent_connections
  alter column human_principal_id drop not null;

comment on column agent_connections.human_principal_id is
  'Optional human association/authoriser for this connection. NULL means no '
  'human account is associated; agent identity is stored separately by '
  'agent_identity.sql.';

alter table oauth_clients
  add column if not exists client_secret_hash text,
  add column if not exists operator          text,
  add column if not exists carta_version     text;

comment on column oauth_clients.client_secret_hash is
  'Software credential for client_credentials clients, stored only as a hash. '
  'It authenticates a client connection; it is not the durable agent identity.';

comment on column oauth_clients.operator is
  'Self-declared operator/provenance metadata. Unverified and never a source of authority.';

comment on column oauth_clients.carta_version is
  'The policy version accepted at registration. Policy acceptance is distinct '
  'from authentication and from the persistent agent identity.';
