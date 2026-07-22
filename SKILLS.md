# Skills — repeatable procedures

Each skill names the subagent tier that should carry it (see SUBAGENTS.md).

## add-subject — put a biography/voyage into the pipeline
1. *(architect, if a new kind)* choose the slug + subject query.
2. **Preview** *(scout)*: on the VPS, `cd ~/terraveler/ingest && python3 scout.py --subject "<subject>"`
   → oculus + curator dry-run. Eyeball the KEEP/drop list.
3. **Ingest** *(implementer)*:
   `docker compose run --rm terraveler_ingest --voyage <slug> --subject "<subject>" --discover --wipe`
4. **Verify** *(scout)*: `/chat` with a subject question; check the AXIS trace in `ingestion_runs`.
5. **Publish** via the **Desk** — the human authorizes (option-1: corpus auto-publishes with async retract).

## deploy-frontend
*(implementer)* Edit in `terraveler-cronodiario`, commit, `git push` → Vercel builds.
Then **verify the live result** — poll the deployment / `curl` the live URL. Never
assume a deploy is live; confirm the running response.

## deploy-backend (VPS)
*(implementer)* Edit locally → `scp` to `~/terraveler/…` → `docker compose up -d --build <svc>`
→ check `/health` and container status. SSH key: `~/.ssh/terraveler_vps` (user `caravaggio`).

## review-before-ship
*(reviewer, opus)* Gate on: **source integrity** (whitelist / no copyrighted or unsourced
ingest), **no secrets** about to be committed, **live-site safety** (won't break map or chat),
**audit intact** (AXIS trace sane). Report CONFIRMED issues first; approve only what survives.

## run-full-reembed (a voyage)
*(implementer)* `docker compose run --rm terraveler_ingest --voyage <slug> --policy exploration --wipe`
(curated sources) — or add `--subject … --discover` for auto-discovery. Long runs: launch
detached (`nohup`), poll to completion, then verify counts + retrieval.
