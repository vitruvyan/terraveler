# Editorial pipeline — operator runbook

## Status and boundaries

Implementation is ready for offline review; this document does not certify a
production deployment. No usable live LLM route has been verified. An invalid
provider key or unavailable local Ollama route must not trigger a direct cloud
fallback. PostgreSQL is durable state, Motus records execution, Limen governs
model calls, and the editor alone authorizes publication.

Research reads already ingested source excerpts from canonical PostgreSQL and
rechecks the source registry. It does not crawl URLs found in proposals. Missing
or disallowed source material blocks research rather than becoming evidence.
Structural citation and exact quotation checks are useful guards, not historical
fact verification. Reviewer readiness means ready for the editor only.

## Migration order

Use the deployment checkout containing all five files. Apply with an application
DB owner/operator to **canonical VPS PostgreSQL**, never Supabase Auth or Limen's
separate database. Take the normal database backup before schema changes. Stop
the editorial worker during migration. Do not rely on frontend builds to migrate.

```sh
for migration in \
  supabase/editorial_workflow.sql \
  supabase/editorial_team.sql \
  supabase/editorial_agent_binding.sql \
  supabase/editorial_pipeline.sql \
  supabase/editorial_chat.sql
do
  docker exec -i terraveler_postgres \
    psql -X -v ON_ERROR_STOP=1 -U terraveler -d terraveler < "$migration" || exit 1
done
```

The baseline application schema and `terraveler_service` role must already exist.
The operator has reported workflow/team tables present; that does not establish
that binding, pipeline or chat migrations were applied. Review existing schema
and migration history before rerunning earlier files. Reload the PostgREST schema
cache after successful application:

```sh
docker exec -i terraveler_postgres \
  psql -X -v ON_ERROR_STOP=1 -U terraveler -d terraveler \
  -c "NOTIFY pgrst, 'reload schema';"
```

## Dedicated worker SQL identity

Do not give the worker the application owner or publication service credential.
Provision a dedicated LOGIN, without superuser, ownership, CREATE, BYPASSRLS or
membership in `terraveler_service`. Set its password interactively (`\password`)
or through the deployment secret manager, outside shell history and source.
After all migrations, grant only the worker protocol and source reads:

```sql
CREATE ROLE terraveler_editorial_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE terraveler TO terraveler_editorial_worker;
GRANT USAGE ON SCHEMA public TO terraveler_editorial_worker;
GRANT EXECUTE ON FUNCTION
  public.editorial_claim(text,text[],integer),
  public.editorial_renew(bigint,uuid,integer),
  public.editorial_complete(bigint,uuid,jsonb,jsonb),
  public.editorial_fail(bigint,uuid,text),
  public.editorial_recover()
TO terraveler_editorial_worker;
GRANT SELECT ON public.rag_docs, public.source_endpoints,
  public.source_access_rules, public.source_policy_decisions
TO terraveler_editorial_worker;
```

These protocol functions are SECURITY DEFINER; the login does not need table
writes or ownership. If a source table has RLS enabled, SELECT alone is
insufficient: provision a SELECT policy for this worker on that table. This
operator configuration creates only the missing worker-specific policies:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rag_docs','source_endpoints','source_access_rules','source_policy_decisions'] LOOP
    IF (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t))
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                      AND tablename=t AND policyname='editorial_worker_source_read') THEN
      EXECUTE format('CREATE POLICY editorial_worker_source_read ON public.%I FOR SELECT TO terraveler_editorial_worker USING (true)',t);
    END IF;
  END LOOP;
END $$;
```

Review inherited PUBLIC privileges and deployment-specific RLS before enabling.
The worker must not have direct writes to editorial/publication tables or
EXECUTE rights on publication functions. Test the login's effective privileges
and a source SELECT as that login; a successful owner query proves nothing about
the worker. Recheck these grants after future function migrations. The container
has no public HTTP port and no provider/master credential.

## Build and disabled smoke check

`orchestration/Dockerfile.editorial` uses the tracked application kernel wheel
`officers/wheels/vitruvyan_motus-0.14.0-py3-none-any.whl`. It does not consume or
replace Limen's separately built Motus 0.23 wheels. Build context is the repository
root; minimal source-governance imports are copied with the worker.

```sh
docker build -f orchestration/Dockerfile.editorial -t terraveler-editorial:local .
docker run --rm terraveler-editorial:local python -m orchestration.editorial --once
```

Expected output: `{"status": "disabled"}`. No database connection or model call
occurs. No Docker build/start has been verified by this documentation change.

Copy `ops/editorial/worker.env.example` to an external owner-readable file and
replace every placeholder. Set `EDITORIAL_WORKER_ENV_FILE` to its absolute path.
Both activation gates default to `0`. Use the worker's database LOGIN, a scoped
Limen virtual key, and a data class permitted by that key. Internal Docker gateway
DNS is valid only when Limen joins the same project/network; use protected TLS
when the gateway is remote. Frontend gateway settings must remain server-only.

## Controlled activation

1. Verify the Limen catalogue, permitted generation and denied-policy behavior
   with a working authorized model. Agent configurations use logical catalogue
   model IDs, not raw provider credentials. Live model testing is still pending.
2. Create available research, writer and reviewer configurations in `/desk/team`.
   Pin the desired model and role instructions; pause keeps an agent unavailable
   for new claims. Configuration alone never starts a worker.
3. Configure the frontend workflow opt-in (`EDITORIAL_WORKFLOW_ENABLED=1`) and
   its existing server-side backend/gateway credentials. Deploy the reviewed app
   revision, then verify unauthorized access is denied.
4. Choose one explicitly linked dossier. Start one pipeline or record one typed
   coordinator request from its dossier chat. Avoid creating a second pipeline
   while the first is active. Requests and task ownership are persisted.
5. Only after checking permissions and inputs, set both worker gates to `1` in
   the external file. First run a single task:

```sh
docker compose -f docker-compose.yml -f compose.editorial.yml \
  --profile editorial run --rm terraveler_editorial \
  python -m orchestration.editorial --once
```

Then explicitly start polling:

```sh
docker compose -f docker-compose.yml -f compose.editorial.yml \
  --profile editorial up -d terraveler_editorial
```

Add `-f compose.limen.yml` to the same Compose invocation when sharing the local
Limen deployment. This worker overlay does not start Limen, choose a model,
create agents or migrate a database. Its profile is off by default and restart
policy is `no`, so a database failure exits visibly rather than silently looping.

## Verify before calling it operational

Observe research → draft → independent reviewer → editor-ready or an explained
blocker. Inspect source provenance, the exact configuration version, persisted
results and successful native Motus traces. Test process interruption and lease
recovery without accepting stale outputs. Review repair exhaustion and missing
source/model behavior. Confirm that an editor-ready result does not publish.
Finally authorize publication through the existing human-controlled flow.

For rollback, stop `terraveler_editorial`, set both gates back to `0` and disable
frontend workflow entry points as appropriate. Keep persisted records and traces;
do not drop tables to stop automation. Expired leases can be recovered explicitly
with `--recover` once the DB is healthy. Failed attempts retain bounded error
categories; interrupted model computation is not a resumable token checkpoint.
