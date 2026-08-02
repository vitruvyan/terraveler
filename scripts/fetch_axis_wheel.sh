#!/usr/bin/env bash
# Build the vitruvyan-axis wheel at a tag and place it in every consumer
# build context. Successor of vendor_axis.sh, retired the day the kernel
# became installable (v0.4.0): source trees are no longer copied around —
# a versioned artifact is, and pip owns the resolution. When the package
# reaches a registry, this script dies too and a requirements line does
# the whole job.
#
#   scripts/fetch_axis_wheel.sh v0.4.0
#
# The repo is private and visible only over SSH (github-vitruvyan alias),
# which is why the wheel is built here and COPY'd into images rather than
# pip-installed from git inside a build (no credentials in build contexts).
set -euo pipefail

REF="${1:?usage: fetch_axis_wheel.sh <tag-or-ref>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone -q --depth 1 --branch "$REF" github-vitruvyan:vitruvyan/axis.git "$TMP/src"
python3 -m pip wheel -q "$TMP/src" --no-deps -w "$TMP/dist"
WHL="$(ls "$TMP/dist"/vitruvyan_axis-*.whl)"

for CTX in ingest rag officers; do
  mkdir -p "$ROOT/$CTX/wheels"
  rm -f "$ROOT/$CTX/wheels"/vitruvyan_axis-*.whl
  cp "$WHL" "$ROOT/$CTX/wheels/"
done
echo "$(basename "$WHL") -> ingest/wheels rag/wheels officers/wheels"
