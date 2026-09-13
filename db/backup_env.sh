#!/bin/bash
# Terraveler — nightly encrypted backup of .env.
#
# .env is the only copy of every VPS-side secret (POSTGRES_PASSWORD,
# REDIS_PASSWORD, PGRST_JWT_SECRET, PGRST_DB_PASSWORD, RAG_TOKEN,
# OPENROUTER_API_KEY, ...): it is deliberately never committed (see
# .gitignore), and until this script existed it had no backup at all. That
# combination cost a real outage on 2026-09-13 — an unrelated directory
# deletion took .env with it, and RAG_TOKEN specifically turned out to be
# unrecoverable from anywhere (Vercel stores its mirror as a write-only
# "sensitive" variable). See docs/SECRETS.md for the full incident and the
# recovery this backup exists to make unnecessary next time.
#
# Same shape as backup.sh on purpose — temp file, verified, only then moved
# into place and rotated — but encrypted, because this file (unlike the SQL
# dump) IS the secrets, not just data that came from an already-secret
# database.  Decrypting requires ENV_BACKUP_PASSPHRASE, which is
# deliberately NOT itself in .env: a passphrase that lives only in the file
# it exists to protect is not a backup, it is the same single point of
# failure with extra steps. Store it in a password manager, off this VPS.
#
# Offsite: same OFFSITE_CMD hook as backup.sh, receives the encrypted file's
# path as $1. Until it is set, this still only protects against losing the
# .env file specifically (the 2026-09-13 failure mode) — not against losing
# this VPS entirely.

set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/terraveler/.env}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/terraveler}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$HOME/.terraveler-env-backup.key}"
KEEP="${KEEP:-14}"
OFFSITE_CMD="${OFFSITE_CMD:-}"

ts=$(date +%Y%m%d-%H%M%S)
final="$BACKUP_DIR/terraveler_env_$ts.gpg"
tmp="$final.partial"

log() { echo "$(date '+%F %T') $*"; }
die() { log "FAILED: $*"; rm -f "$tmp"; exit 1; }

[ -f "$ENV_FILE" ] || die ".env not found at $ENV_FILE — nothing to back up"

if [ -n "${ENV_BACKUP_PASSPHRASE:-}" ]; then
  passphrase="$ENV_BACKUP_PASSPHRASE"
elif [ -f "$PASSPHRASE_FILE" ]; then
  passphrase=$(cat "$PASSPHRASE_FILE")
else
  die "no passphrase — set ENV_BACKUP_PASSPHRASE or create $PASSPHRASE_FILE (chmod 600, outside the repo)"
fi
[ -n "$passphrase" ] || die "passphrase is empty"

mkdir -p "$BACKUP_DIR"

log "encrypting $ENV_FILE"
gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback \
  --passphrase-fd 0 --output "$tmp" "$ENV_FILE" <<< "$passphrase" \
  || die "gpg encryption failed"

# A backup nobody can decrypt is worse than no backup — it looks safe.
# Round-trip it now, while the passphrase is still in scope, not at restore
# time when the operator is already dealing with a lost .env under pressure.
diff <(gpg --batch --yes --decrypt --pinentry-mode loopback \
         --passphrase-fd 0 "$tmp" <<< "$passphrase" 2>/dev/null) "$ENV_FILE" \
  >/dev/null || die "round-trip decrypt did not match the source .env"

mv "$tmp" "$final"
chmod 600 "$final"
log "wrote $final ($(du -h "$final" | cut -f1))"

if [ -n "$OFFSITE_CMD" ]; then
  log "shipping offsite"
  bash -c "$OFFSITE_CMD" _ "$final" || log "WARNING: offsite copy failed — local backup kept"
else
  log "NOTE: no OFFSITE_CMD set — this backup lives on the same disk as .env itself"
fi

mapfile -t old < <(ls -1t "$BACKUP_DIR"/terraveler_env_*.gpg 2>/dev/null | tail -n +$((KEEP + 1)))
if [ ${#old[@]} -gt 0 ]; then
  printf '%s\n' "${old[@]}" | xargs -r rm --
  log "rotated out ${#old[@]} backup(s), keeping $KEEP"
fi

log "done"
