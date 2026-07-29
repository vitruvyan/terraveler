-- Redeeming a credential must be a race nobody can tie.
--
-- Both grant paths did this:
--
--     SELECT the credential, see it is unused
--     issue a new token family
--     PATCH the credential as consumed
--
-- Two requests arriving together both read "unused" and both walk away with a
-- valid family. The replay detection that the whole design rests on fails
-- precisely during the race it exists to handle, and the second family belongs
-- to whoever asked second — possibly the thief.
--
-- These two functions make the check and the claim a single statement, so the
-- database decides the winner. `UPDATE … WHERE consumed_at IS NULL RETURNING`
-- returns a row to exactly one caller; everyone else gets nothing and is told
-- the credential was already spent.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/oauth_atomic.sql

-- The resource a token was issued for. MCP requires the client to name it at
-- both the authorization and token endpoints, and the resource server to check
-- the audience — a token minted for one MCP server must not be spendable at
-- another.
alter table oauth_codes  add column if not exists resource text;
alter table oauth_tokens add column if not exists resource text;

comment on column oauth_tokens.resource is
  'The MCP resource this token may be spent at. Absent on tokens issued before '
  'audience binding existed; those are accepted until they expire and never '
  'reissued without one.';


create or replace function claim_authorization_code(p_code_hash text)
returns table (
  client_id text, connection_id bigint, redirect_uri text,
  code_challenge text, scopes text[], expires_at timestamptz, resource text
)
language sql volatile as $$
  update oauth_codes
     set consumed_at = now()
   where code_hash = p_code_hash
     and consumed_at is null
  returning client_id, connection_id, redirect_uri,
            code_challenge, scopes, expires_at, resource;
$$;

comment on function claim_authorization_code(text) is
  'Consume an authorization code and return it, or return nothing. Exactly one '
  'concurrent caller can win. A caller that gets nothing must then look the '
  'code up to tell "already spent" (a replay) from "never existed".';

create or replace function claim_refresh_token(p_token_hash text)
returns table (
  id bigint, connection_id bigint, scopes text[],
  expires_at timestamptz, revoked_at timestamptz, client_id text
)
language sql volatile as $$
  update oauth_tokens t
     set revoked_at = now()
    from agent_connections c
   where t.token_hash = p_token_hash
     and t.kind = 'refresh'
     and t.rotated_to is null
     and t.revoked_at is null
     and c.id = t.connection_id
  returning t.id, t.connection_id, t.scopes, t.expires_at, t.revoked_at, c.client_id;
$$;

comment on function claim_refresh_token(text) is
  'Claim a refresh token for rotation. Marking it revoked in the same statement '
  'that selects it is what stops two concurrent refreshes both succeeding; the '
  'caller sets rotated_to afterwards so a later presentation reads as replay '
  'rather than as an ordinary revocation.';

