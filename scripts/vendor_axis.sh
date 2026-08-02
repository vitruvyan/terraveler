#!/usr/bin/env bash
# Vendor the AXIS kernel from its canonical repo into BOTH consumer copies.
#
# Terraveler carried two byte-copies of the kernel kept identical only by
# discipline, and discipline lost: the copies fell behind the canonical
# repo's trace-integrity fixes, and a failing STRICT run was destroying its
# own audit trace in production. Until AXIS is pip-installable (its
# packaging PR), this script is the single, checkable road for kernel
# updates: one source, one ref, two identical copies, a record of what was
# vendored, and a hard failure if the copies ever diverge.
#
#   scripts/vendor_axis.sh <git-ref>     # e.g. main, or a commit sha
#
# The ref is resolved against github-vitruvyan:vitruvyan/axis.git (SSH —
# the repo is not visible to the gh token).
set -euo pipefail

REF="${1:?usage: vendor_axis.sh <git-ref>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone -q github-vitruvyan:vitruvyan/axis.git "$TMP/axis-src"
git -C "$TMP/axis-src" checkout -q "$REF"
SHA="$(git -C "$TMP/axis-src" rev-parse HEAD)"

for DEST in "$ROOT/ingest/axis" "$ROOT/rag/axis"; do
  find "$DEST" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
  rsync -a --delete --exclude '__pycache__' "$TMP/axis-src/axis/" "$DEST/"
  {
    echo "vendored from github.com/vitruvyan/axis"
    echo "ref: $REF"
    echo "commit: $SHA"
    echo "by: scripts/vendor_axis.sh — do not edit the copies; re-vendor instead"
  } > "$DEST/VENDORED_FROM"
done

diff -r -x __pycache__ "$ROOT/ingest/axis" "$ROOT/rag/axis"
echo "vendored axis @ $SHA into ingest/axis and rag/axis (identical)"
