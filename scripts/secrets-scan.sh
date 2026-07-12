#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

is_truthy() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

is_zero_sha() {
  [ -n "${1:-}" ] && printf '%s' "$1" | grep -Eq '^0+$'
}

paths_file="$(mktemp)"
trap 'rm -f "$paths_file"' EXIT

if is_truthy "${ATLAS_SECRETS_SCAN_CHANGED_ONLY:-}"; then
  base_sha="${ATLAS_SECRETS_SCAN_BASE_SHA:-${GITHUB_BASE_SHA:-}}"
  head_sha="${ATLAS_SECRETS_SCAN_HEAD_SHA:-${GITHUB_SHA:-HEAD}}"

  if [ -z "$base_sha" ] || is_zero_sha "$base_sha"; then
    git ls-files -z >"$paths_file"
  else
    git diff -z --name-only --diff-filter=ACMRTUXB "$base_sha" "$head_sha" -- >"$paths_file"
  fi
else
  git ls-files -z >"$paths_file"
fi

if [ ! -s "$paths_file" ]; then
  echo "No files to scan for committed secrets."
  exit 0
fi

file_count="$(tr -cd '\000' <"$paths_file" | wc -c | tr -d ' ')"

echo "Scanning ${file_count} file(s) for committed secrets."
xargs -0 uv --project api run --extra dev detect-secrets-hook --baseline .secrets.baseline <"$paths_file"
