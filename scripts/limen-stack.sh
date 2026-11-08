#!/usr/bin/env bash
# Configuration inspection can contain credentials: do not print resolved YAML.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-check}"
stack_env="${2:-}"
case "$action" in
  init)
    git -C "$root" submodule sync -- vendor/limen
    git -C "$root" submodule update --init -- vendor/limen
    exit 0 ;;
  check|build|up|status) ;;
  *) echo 'Usage: bash scripts/limen-stack.sh init | check|build|up|status /absolute/path/stack.env' >&2; exit 2 ;;
esac
if [[ ! -f "$stack_env" || "$stack_env" != /* ]]; then
  echo 'Pass an existing absolute stack.env path outside the repository.' >&2; exit 2
fi
case "$(realpath "$stack_env")" in "$root"/*) echo 'Keep stack.env outside the repository.' >&2; exit 2;; esac
if [[ ! -f "$root/vendor/limen/docker/Dockerfile" ]]; then
  echo 'Initialize the private submodule first: bash scripts/limen-stack.sh init' >&2; exit 2
fi
expected="$(git -C "$root" ls-files --stage vendor/limen | awk '{print $2}')"
actual="$(git -C "$root/vendor/limen" rev-parse HEAD)"
if [[ -z "$expected" || "$actual" != "$expected" ]]; then
  echo 'Limen checkout differs from the committed gitlink. Review and pin updates before building.' >&2; exit 2
fi
if ! git -C "$root/vendor/limen" diff --quiet || ! git -C "$root/vendor/limen" diff --cached --quiet; then
  echo 'The Limen checkout has local changes. Restore upstream before building.' >&2; exit 2
fi
if [[ "$action" == build || "$action" == up ]]; then
  for wheel in vitruvyan_motus-0.23.0-py3-none-any.whl motus_anchor_opentimestamps-0.1.0-py3-none-any.whl; do
    if [[ ! -f "$root/vendor/limen/docker/wheels/$wheel" ]]; then
      echo 'Build Limen private wheels with vendor/limen/docker/build-wheels.sh first.' >&2; exit 2
    fi
  done
fi
compose=(docker compose --project-directory "$root")
[[ ! -f "$root/.env" ]] || compose+=(--env-file "$root/.env")
compose+=(--env-file "$stack_env" -f "$root/docker-compose.yml" -f "$root/compose.limen.yml" --profile limen)
"${compose[@]}" config --format json | python3 "$root/scripts/check_limen_config.py"
case "$action" in
  check) echo 'Limen compose configuration is valid; no services started.' ;;
  build) "${compose[@]}" build terraveler_limen ;;
  up) "${compose[@]}" up -d --no-build terraveler_limen ;;
  status) "${compose[@]}" ps terraveler_limen terraveler_limen_db ;;
esac
