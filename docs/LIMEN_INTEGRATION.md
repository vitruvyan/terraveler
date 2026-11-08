# Limen in TerraVeler

Limen is an upstream Git submodule at `vendor/limen`, pinned to commit
`2742e6e4bf21a5b60982df110195e99a9666ff71`. It is not a fork or a copied
Python package. TerraVeler owns the deployment overlay and the client adapter;
Limen retains its own source, history and upgrade path. Team/agent management
stays in TerraVeler. This increment does not configure or activate live agents.

## Fetch the private source

On a machine whose Git credentials can read `vitruvyan/limen`:

```sh
bash scripts/limen-stack.sh init
```

This checks out the committed gitlink, never the newest upstream branch. A
fresh clone can also use `git submodule update --init -- vendor/limen`.
The superproject's GitHub access does not automatically grant private Limen
access to Git CLI, CI or Vercel. Grant those build identities access separately;
never place an access token in `.gitmodules` or a repository URL. Frontend builds
do not import the submodule's Python code, but a host that automatically fetches
submodules may still require that access during checkout.

## Dedicated optional deployment

`compose.limen.yml` is merged with the existing root compose by the wrapper.
It uses Limen's upstream Dockerfile unchanged, its own PostgreSQL database and
its own data/evidence volumes. It does not use the TerraVeler application DB.
The DB has no host port. The gateway and observation ports bind to host
loopback only: 6400 and 6464. No Orbis compose override, platform credentials,
ingress, local model container or anchor service is installed by this overlay.

1. Create an absolute state directory **outside git**. Copy
   `ops/limen/stack.env.example` there as `stack.env` and
   `ops/limen/secrets.env.example` as `secrets.env`. Restrict permissions to the
   service owner (`chmod 600` for secret/env files).
2. Set `LIMEN_TERRAVELER_STATE` to that directory, choose a distinct Limen DB
   password and put its URL-encoded form in `LIMEN_DATABASE_URL`. Keep the
   existing TerraVeler root `.env` unchanged. The wrapper loads it first and
   the dedicated stack file second, without sourcing either as shell code.
3. Copy `vendor/limen/docker/litellm_config.yaml` into the state directory.
   Replace provider placeholders with the chosen models and endpoints. The
   model choice remains deferred; no model or external provider is selected by
   this change. Configure every logical model required by the active policy.
   Limen refuses unmapped placeholders at startup. Configure local-only policy
   before sending editorial data. Do not assume the name `local-default`
   proves a route is local.
4. Generate strong master/admin/read secrets in `secrets.env`, and configure
   the standalone identity/provider settings required by the pinned Limen
   version. The master key is an administrative credential, never a client key.
5. Build the private wheels using upstream's script, on a machine with Motus
   Git access: `MOTUS_TAG=v0.23.0 bash vendor/limen/docker/build-wheels.sh`.
   Its Motus 0.23.0 and the editorial worker's existing Motus 0.14.0 run in
   separate environments. Do not replace the worker's wheel to match Limen.
6. Check and build explicitly, then start only Limen and its DB:

```sh
bash scripts/limen-stack.sh check /absolute/state/stack.env
bash scripts/limen-stack.sh build /absolute/state/stack.env
bash scripts/limen-stack.sh up /absolute/state/stack.env
bash scripts/limen-stack.sh status /absolute/state/stack.env
```

Requires Docker Compose v2 and Python 3.9 or newer. `check` validates resolved compose configuration,
checks the external model configuration file and rejects placeholder credentials;
it does not prove provider availability or functional gateway health. The
wrapper suppresses resolved YAML because it contains credentials. `up` does not
build images implicitly, enable the worker or start the rest of TerraVeler.
Validate actual gateway startup and policy behavior before enabling any client.

## Desk client

`ops/limen/client.env.example` lists the Next.js **server-only** variables.
Select `EDITOR_LOCAL_AI_PROVIDER=limen`; all four `EDITOR_LIMEN_*` settings are
required. The adapter sends OpenAI-compatible requests with a scoped virtual
key, the selected data class and `X-Limen-Mode: documents`. It never invents
an OBO user or tenant header. Issue a key restricted to this application and
the intended model/policy group using Limen/LiteLLM's standard administration.
Do not supply `LITELLM_MASTER_KEY` as `EDITOR_LIMEN_API_KEY`; client code cannot
identify a master key by its string value.

Create the chosen class (for example `editorial`) as `local_only` in Limen and
allow it for the key's profile. Denial, review or gateway failure must not cause
a direct Ollama/cloud retry. Test this in the deployed environment. Existing
direct provider modes remain available only when explicitly selected.

Inside TerraVeler's Docker network, the proxy is
`http://terraveler_limen:4000/v1`. Next.js runs on Vercel, so it needs a separate
TLS reverse-proxy endpoint with appropriate access restrictions, pointing to
the loopback proxy port. Neither the Docker hostname nor host loopback works
from Vercel. Do not expose the observation/admin surface merely to enable chat.
No DNS, proxy, production variables or credentials are changed by this commit.

This is a dedicated gateway instance, not a new shared installation for Orbis.
Public Pigafetta, publication authorization and the agent worker registry are
unchanged. Connecting production worker handlers and adding the Team UI are
later work; this adapter connects the existing Desk assistant only.

## Upgrade and rollback

Fetch upstream in the submodule, review the intended commit, check its Motus
requirements, update the gitlink and image tag/build pin together in a PR.
Never use `git submodule update --remote` during deployment. Re-run tests and
the deployment check. Changes to the gateway itself belong upstream.

Rollback client behavior by restoring the previous explicit provider settings
or disabling the assistant. Stop only the two Limen services if necessary;
preserve DB and evidence volumes. Database compatibility must be assessed
before rolling back a gateway version that applied migrations.

## Verification boundary

The adapter is tested with mocked HTTP, including gateway denial and no direct
fallback. Deployment tests exercise wrapper isolation without a Docker daemon.
This change has not built or started a Limen container, initialized its policy,
called a live model or tested Vercel-to-VPS connectivity. Private submodule
checkout and private wheel building require deployment Git access.
