# Editorial Local AI

The Desk assistant is separate from the public Pigafetta endpoint. It uses the same conversational pattern, but every assistant request is editor-authenticated and the provider is local-only. The public `/api/ask` gains no editing capabilities.

## Provider reuse from Limen

Limen's `src/limen/providers.py` describes Ollama as local and requires an explicit address; `docker/litellm_config.yaml` intentionally has placeholder models. This implementation follows those boundaries in the TypeScript runtime. No private provider registry or credentials were copied into Terraveler.

The repository contains example/container addresses such as `http://ollama:11434`, not a verified address of the owner's deployed server. That Docker hostname is not reachable from Vercel. Do not use it as a production default.

## Configure on the frontend server

Set these server-only environment variables:

- `EDITOR_LOCAL_AI_PROVIDER`: `localai` (OpenAI-compatible LocalAI) or `ollama`.
- `EDITOR_LOCAL_AI_BASE_URL`: the operator's server URL, reachable from the Next.js backend. LocalAI can include `/v1`; Ollama normally uses the server root.
- `EDITOR_LOCAL_AI_MODEL`: the exact installed model identifier.
- `EDITOR_LOCAL_AI_KEY`: optional bearer credential required by the operator's local gateway; never a browser variable.

No `NEXT_PUBLIC_` version exists. Missing or invalid configuration disables the assistant with an explicit UI message. A local deployment must be reachable from the hosted backend through the operator's existing network/gateway; this feature does not expose a local server or change its network protections.

The adapter has no cloud provider or fallback. A configuration pointing to a local gateway does not independently prove where that gateway runs a model; the operator must configure local-only routing there as well.

## Advice and actions

The browser supplies only the editor's message and selected target type and ID (submission, project or published voyage). The backend reads that record and its current title and review context; client-supplied payloads, server URLs, model IDs and system messages are ignored. Model output can propose only `rename` or `request-revision` against that exact server-loaded target. It cannot publish, approve, run shell commands, fetch links or execute edits. A rename proposal carries the title audit version captured before inference; stale changes are refused by the action endpoint. The editor applies a proposed action through the authenticated action endpoint. A bounded recent conversation history is accepted only as user/assistant text, never as system messages or tools.

Assistant advice is recorded in `audit_log` with `executed: false`. If reading context, inference or audit recording fails, the request fails visibly and no action is executed. Credentials, provider response bodies and server URLs are not returned in errors or browser configuration responses.

Requests are bounded, provider redirects are refused, and inference aborts after 45 seconds. Ollama receives `think: false`, matching Limen's documented mitigation for reasoning models exhausting the response budget.

## Verification

Unit and route tests use fake local providers. A live connection requires the actual server address/model configuration; no live connectivity is claimed by the configuration status endpoint.

## Database prerequisite for changes

Apply `supabase/editor_actions.sql` to the canonical VPS PostgreSQL after the existing governance and Chartroom migrations. This is not Supabase Auth SQL. It adds a service-only transaction RPC and an audit lookup index; no original submission or published bundle is rewritten. The route reports setup unavailable until this migration is present.

The Desk title is an editorial display overlay, not an edit to published prose. A published title/content change is requested as a revision through the ordinary review/publication process. Every rename records its previous title; restoring it is another audited rename. Revision requests create open work, optionally offered to an existing agent; no execution is claimed before that agent takes the task.

The new default `/desk` has three workflow sections. Technical sources, users, prompts, historical rejected work and demand signals remain under Administration. `/specimen/editorial` uses the same workspace with read-only fixtures: inference and changes are disabled there.

Validation performed in development: 525 Node tests, TypeScript and production build; the SQL transaction was also executed in an isolated PostgreSQL-compatible PGlite engine under the service role, exercising rename conflicts, request-key replay, revision task deduplication and original-payload preservation. This is not a test against the production database or the actual local model.
