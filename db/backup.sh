#!/bin/bash
# Terraveler — nightly dump of the pgvector database.
#
# This is the only copy of the ingested corpus: the Supabase Postgres was
# frozen when db and vector store moved here, so nothing upstream can rebuild
# it. Re-ingesting means re-paying for the OpenAI extraction passes.
#
# The dump is written to a temp file and only moved into place once gzip has
# verified it, so a truncated run can never masquerade as a good backup, and
# rotation only happens after a verified dump exists.
#
# Offsite: set OFFSITE_CMD to ship the file elsewhere. It receives the dump
# path as $1. Until then the backups sit on the same disk as the database,
# which protects against a bad ingest but NOT against losing this VPS.
#   export OFFSITE_CMD='rclone copy "$1" contabo:terraveler-backups/'
#   export OFFSITE_CMD='rsync -a "$1" backup-host:/srv/terraveler/'

set -euo pipefail

CONTAINER="${CONTAINER:-terraveler_postgres}"
DB="${DB:-terraveler}"
DB_USER="${DB_USER:-terraveler}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/terraveler}"
KEEP="${KEEP:-14}"
OFFSITE_CMD="${OFFSITE_CMD:-}"

ts=$(date +%Y%m%d-%H%M%S)
final="$BACKUP_DIR/terraveler_$ts.sql.gz"
tmp="$final.partial"

log() { echo "$(date '+%F %T') $*"; }
die() { log "FAILED: $*"; rm -f "$tmp"; exit 1; }

mkdir -p "$BACKUP_DIR"

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || die "container $CONTAINER is not running — no dump taken"

log "dumping $DB from $CONTAINER"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB" --no-owner --no-acl \
  | gzip -9 > "$tmp" || die "pg_dump returned non-zero"

gzip -t "$tmp" || die "gzip integrity check failed"

# A dump missing its COPY blocks is structurally valid but useless.
tables=$(zcat "$tmp" | grep -cE '^COPY ' || true)
[ "$tables" -ge 4 ] || die "only $tables COPY blocks — expected at least 4 tables"

mv "$tmp" "$final"
log "wrote $final ($(du -h "$final" | cut -f1), $tables tables)"

if [ -n "$OFFSITE_CMD" ]; then
  log "shipping offsite"
  bash -c "$OFFSITE_CMD" _ "$final" || log "WARNING: offsite copy failed — local dump kept"
else
  log "NOTE: no OFFSITE_CMD set — this dump lives on the same disk as the database"
fi

# Rotate only now that a verified dump is on disk.
mapfile -t old < <(ls -1t "$BACKUP_DIR"/terraveler_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if [ ${#old[@]} -gt 0 ]; then
  printf '%s\n' "${old[@]}" | xargs -r rm --
  log "rotated out ${#old[@]} dump(s), keeping $KEEP"
fi

log "done"
