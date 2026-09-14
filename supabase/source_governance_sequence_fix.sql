-- source_governance_seed.sql inserts explicit id values with OVERRIDING
-- SYSTEM VALUE into four GENERATED ALWAYS AS IDENTITY columns
-- (source_institutions, source_endpoints, source_access_rules,
-- source_policy_decisions). OVERRIDING SYSTEM VALUE writes the row without
-- advancing the identity sequence behind it — so the first ordinary insert
-- into any of the four after seeding collides with the seed's own last id.
-- Caught live: mcp_resolve_source_proposal's first real call failed with
-- "duplicate key value violates unique constraint source_endpoints_pkey"
-- trying to insert id=1, which source_governance_seed.sql had already
-- placed there by hand.
--
-- Idempotent: setval's third argument (false) means "the next nextval()
-- call returns exactly this value", so running it again after further rows
-- exist only ever moves the sequence forward to the new max, never back.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS, any
-- time after source_governance_seed.sql (or a fresh restore of the same
-- data) has run.

select setval(pg_get_serial_sequence('source_institutions', 'id'),
              coalesce((select max(id) from source_institutions), 0) + 1, false);
select setval(pg_get_serial_sequence('source_endpoints', 'id'),
              coalesce((select max(id) from source_endpoints), 0) + 1, false);
select setval(pg_get_serial_sequence('source_access_rules', 'id'),
              coalesce((select max(id) from source_access_rules), 0) + 1, false);
select setval(pg_get_serial_sequence('source_policy_decisions', 'id'),
              coalesce((select max(id) from source_policy_decisions), 0) + 1, false);
