#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./uninstall-scout-dev.sh [--bin-dir DIR] [--force]

Removes the managed scout-dev command installed by install-scout-dev.sh.

Options:
  --bin-dir DIR   Install directory. Defaults to SCOUT_DEV_BIN_DIR or ~/.local/bin.
  --force         Remove scout-dev even if it is not the managed Atlas wrapper.
  -h, --help      Show this help.
EOF
}

fail() {
  echo "uninstall-scout-dev: $*" >&2
  exit 1
}

home_dir=${HOME:-}
bin_dir=${SCOUT_DEV_BIN_DIR:-}
force=0

if [ -z "$bin_dir" ] && [ -n "$home_dir" ]; then
  bin_dir="$home_dir/.local/bin"
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir)
      shift
      [ "$#" -gt 0 ] || fail "--bin-dir requires a directory."
      bin_dir=$1
      ;;
    --force)
      force=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
  shift
done

if [ -z "$bin_dir" ]; then
  fail "HOME is required unless --bin-dir is provided."
fi

if [[ "$bin_dir" == "~"* ]]; then
  if [ -z "$home_dir" ]; then
    fail "HOME is required to expand --bin-dir paths that start with ~."
  fi
  bin_dir="${bin_dir/#\~/$home_dir}"
fi

target="$bin_dir/scout-dev"

if [ ! -e "$target" ]; then
  echo "scout-dev is not installed at $target."
  exit 0
fi

if ! grep -q "atlas scout-dev wrapper" "$target" 2>/dev/null; then
  if [ "$force" -ne 1 ]; then
    fail "$target is not managed by Atlas. Re-run with --force to remove it anyway."
  fi
fi

rm -f "$target"
echo "Removed scout-dev from $target"
