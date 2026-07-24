#!/bin/bash
# Terraveler ingestion worker — process the `subjects` queue in priority order.
# The seed of the cron: pick next queued subject, run the AXIS discovery pipeline,
# mark done/failed, repeat until the queue is empty.
cd ~/terraveler || exit 1
PSQL="docker exec -i terraveler_postgres psql -U terraveler -d terraveler -t -A"

while true; do
  row=$(echo "select slug||'|'||subject_query from subjects where status='queued' order by priority limit 1;" | $PSQL | tr -d '\r')
  if [ -z "$row" ]; then echo "$(date) queue empty — worker done"; break; fi
  slug="${row%%|*}"; subj="${row#*|}"
  echo "$(date) ▶ $slug — $subj"
  echo "update subjects set status='running', updated_at=now() where slug='$slug';" | $PSQL >/dev/null
  if docker compose run --rm terraveler_ingest \
        --voyage "$slug" --subject "$subj" --discover --policy exploration --wipe \
        >> ~/terraveler/worker.log 2>&1; then
    echo "update subjects set status='done', updated_at=now() where slug='$slug';" | $PSQL >/dev/null
    echo "$(date) ✔ done $slug"
  else
    echo "update subjects set status='failed', updated_at=now() where slug='$slug';" | $PSQL >/dev/null
    echo "$(date) ✗ FAILED $slug"
  fi
done
