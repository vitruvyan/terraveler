# Secrets — what exists, where, and how to recover it

Written after a real incident (2026-09-13): an unrelated directory deletion
took `.env` with it. `.env` had never been backed up — it is intentionally
never committed (see `.gitignore`) — and one of its values (`RAG_TOKEN`)
turned out to be unrecoverable from anywhere, because its mirror on Vercel
(`TERRAVELER_RAG_TOKEN`) is stored as a write-only "sensitive" variable that
even `vercel env pull` cannot return in plaintext. The fix took over an hour
of live container forensics. This document, and `db/backup_env.sh`, exist so
that never has to happen again.

## Two separate secret stores — do not confuse them

- **VPS `.env`** (`~/terraveler/.env`, never committed) — feeds
  `docker-compose.yml`'s `${VAR}` substitutions for the self-hosted services.
  This is what was lost on 2026-09-13.
- **Vercel project environment variables** — feed the Next.js app
  (`POSTGREST_URL`, `SUPABASE_AUTH_*`, `MCP_SECURITY_PEPPER`, etc., see
  `.env.example`). Untouched by the incident; `vercel env pull` recovers the
  non-sensitive ones. Any var marked "Encrypted" (sensitive) in the Vercel
  dashboard is write-only forever — losing the value anywhere else means
  rotating it, not recovering it.

## VPS `.env` — every variable, who needs it, how to recover it

| Variable | Used by | If lost |
|---|---|---|
| `POSTGRES_PASSWORD` | postgres, postgrest (via `PGRST_DB_URI`), officers, rag, ingest | Recoverable: `docker inspect terraveler_postgres --format '{{.Config.Env}}'` on any container that has not been recreated since it was set. Otherwise: rotate in the `postgres` container (`ALTER USER ... PASSWORD`) and update everywhere. |
| `REDIS_PASSWORD` | redis, officers (via `REDIS_URL`) | Recoverable from `docker inspect terraveler_redis --format '{{.Config.Cmd}}'` (`--requirepass <value>`) as long as that container has not been recreated. |
| `PGRST_JWT_SECRET` | postgrest | Recoverable from `docker inspect terraveler_postgrest --format '{{.Config.Env}}'`. Any live token signed with it becomes invalid on rotation. |
| `PGRST_DB_PASSWORD` | postgrest (embedded in `PGRST_DB_URI`) | Recoverable the same way, or by reading the password out of the live `PGRST_DB_URI` value directly. |
| `RAG_TOKEN` | rag (bearer the Next.js app must present to call `/chat`) | **Not recoverable if lost from every container.** Its Vercel mirror, `TERRAVELER_RAG_TOKEN`, is a sensitive variable — write-only. If lost: generate a new one, `vercel env rm/add TERRAVELER_RAG_TOKEN`, update `.env`, recreate `terraveler_rag`. Purely internal to Terraveler's own two services — safe to rotate any time, nothing external depends on it. |
| `OPENROUTER_API_KEY` | rag (the chat writer) | **Not recoverable from any container** — no other service holds a copy. Regenerate from the OpenRouter dashboard. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | ingest (`profiles: ["jobs"]` — only runs on demand, so usually not live in any running container to recover from) | Regenerate from each provider's dashboard. Not required for anything that runs continuously; only for a manual ingestion pass. |
| `CURATOR_MODEL`, `OPENROUTER_MODEL`, `RAG_K` | ingest, rag | Not secrets — model name strings and a small integer. `docker-compose.yml` has sane defaults (`gpt-4.1`, `deepseek/deepseek-v4.1-flash`, `6`) if unset. |
| `OFFICERS_MOORED` | officers | Not a secret — a `0`/`1` flag. Check the live container's current value before assuming a default. |
| `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` | `scripts/check_motus_raised.py` (host cron, not a container) | Shared with the separate `mercator` project's own `@Vitruvyan_bot` — same bot, same chat, both live in `~/mercator/.env`. If lost here, copy back from there rather than creating a second bot. |

## Backup: `db/backup_env.sh`

Runs nightly at 03:35 (right after the existing DB dump at 03:30), same
crontab, same log (`~/backups/terraveler/backup.log`). GPG-symmetric
encrypts `.env`, verifies the round-trip decrypts back to an exact match
*before* the backup is considered good, writes
`terraveler_env_<timestamp>.gpg`, keeps 14.

**The passphrase is not itself in `.env`** — a passphrase that only lives in
the file it protects is not a backup. It lives at
`~/.terraveler-env-backup.key` (chmod 600, outside the git repo, outside
`~/terraveler` entirely) and nowhere else on this VPS by design. **Copy it
into a password manager.** Losing this passphrase with no offsite copy
means the encrypted backups on disk become as unrecoverable as `.env`
itself would have been.

To restore:

```bash
gpg --batch --yes --decrypt --pinentry-mode loopback --passphrase-fd 0 \
  ~/backups/terraveler/terraveler_env_<timestamp>.gpg \
  <<< "$(cat ~/.terraveler-env-backup.key)" > ~/terraveler/.env
```

## Last resort: no backup exists

This is what actually happened on 2026-09-13, before this backup existed.
Only reaches partial recovery — `RAG_TOKEN`-class secrets with no other
copy anywhere are gone for good and must be rotated, not restored.

1. For every var that some other, still-running container also needs:
   `docker inspect <container> --format '{{.Config.Env}}'` (or
   `--format '{{.Config.Cmd}}'` for anything passed as a launch flag, like
   Redis's `--requirepass`). This only works for containers that have not
   themselves been recreated since the secret was set — recreating a
   container re-reads `.env` and silently replaces its values with
   whatever (or nothing) is currently there. **Read every container's
   config before recreating any of them when `.env` is in doubt.**
2. For anything mirrored on Vercel and not marked sensitive:
   `vercel env pull --environment=production`.
3. For anything marked sensitive on Vercel, or not found in step 1: it is
   gone. Generate a new value and update it everywhere that holds a copy
   (`.env`, Vercel, any container's live config).

## What this does and does not protect against

Protects against: losing `.env` specifically (a bad `rm`, a botched
directory operation, disk corruption limited to one path) — the exact
2026-09-13 failure mode.

Does **not** protect against: losing this VPS entirely. The encrypted
backups sit on the same disk as `.env` itself, same as `db/backup.sh`'s own
dumps (see its `OFFSITE_CMD` note). Both scripts support the same
`OFFSITE_CMD` hook to ship the file elsewhere:

```bash
export OFFSITE_CMD='rclone copy "$1" contabo:terraveler-backups/'
```

Not configured yet. Until it is, a whole-VPS loss takes the encrypted
backups down with it — only the passphrase, if actually copied into a
password manager as instructed above, would survive.
