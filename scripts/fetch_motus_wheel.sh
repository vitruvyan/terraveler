#!/usr/bin/env bash
# Build the vitruvyan-motus wheel at a tag and place it in every consumer
# build context. Successor of fetch_axis_wheel.sh, retired the day the
# kernel finished the rename: the repository vitruvyan/axis became
# vitruvyan/motus in place (ADR-001 §Decision 2, one history, no greenfield),
# and the distribution it publishes is vitruvyan-motus / vitruvyan_motus.
# The old script kept working only through GitHub's rename redirect, and it
# built a distribution that ADR-009 has since frozen at the v0.6.1 tag.
#
#   scripts/fetch_motus_wheel.sh v0.7.0
#
# The repo is private and visible only over SSH (github-vitruvyan alias),
# which is why the wheel is built here and COPY'd into images rather than
# pip-installed from git inside a build (no credentials in build contexts).
# When the package reaches a registry, this script dies too and a
# requirements line does the whole job.
set -euo pipefail

REF="${1:?usage: fetch_motus_wheel.sh <tag-or-ref>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone -q --depth 1 --branch "$REF" github-vitruvyan:vitruvyan/motus.git "$TMP/src"
python3 -m pip wheel -q "$TMP/src" --no-deps -w "$TMP/dist"
WHL="$(ls "$TMP/dist"/vitruvyan_motus-*.whl)"

for CTX in ingest rag officers; do
  mkdir -p "$ROOT/$CTX/wheels"
  # The predecessor's artifact leaves with its kernel: a build context
  # holding both wheels would let pip resolve either one.
  rm -f "$ROOT/$CTX/wheels"/vitruvyan_axis-*.whl
  rm -f "$ROOT/$CTX/wheels"/vitruvyan_motus-*.whl
  cp "$WHL" "$ROOT/$CTX/wheels/"
done
echo "$(basename "$WHL") -> ingest/wheels rag/wheels officers/wheels"
