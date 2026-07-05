#!/usr/bin/env bash
set -euo pipefail

DEFAULT_ATLAS_URL="https://atlas.localhost"
ROOT_DIR=$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)

usage() {
  cat <<'EOF'
Usage: ./install-scout-dev.sh [--bin-dir DIR] [--atlas-url URL] [--force]

Installs a managed scout-dev command that forwards to scout with local Atlas
development defaults.

Options:
  --bin-dir DIR     Install directory. Defaults to SCOUT_DEV_BIN_DIR or ~/.local/bin.
  --atlas-url URL   Default Atlas app URL baked into scout-dev. Defaults to
                   SCOUT_DEV_ATLAS_URL or https://atlas.localhost.
  --force           Replace an existing unmanaged scout-dev command.
  -h, --help        Show this help.

Runtime overrides:
  SCOUT_DEV_ATLAS_URL   Override the baked Atlas URL for one invocation.
  SCOUT_DEV_SCOUT_PROJECT
                         Scout project used by uv. Defaults to this repo's scout package.
  SCOUT_DEV_SCOUT_BIN   Optional Scout executable override. Bypasses uv when set.
  PORTLESS_CA_FILE      Portless CA path. Defaults to ~/.portless/ca.pem.
EOF
}

fail() {
  echo "install-scout-dev: $*" >&2
  exit 1
}

home_dir=${HOME:-}
bin_dir=${SCOUT_DEV_BIN_DIR:-}
atlas_url=${SCOUT_DEV_ATLAS_URL:-"$DEFAULT_ATLAS_URL"}
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
    --atlas-url)
      shift
      [ "$#" -gt 0 ] || fail "--atlas-url requires a URL."
      atlas_url=$1
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

if [ -e "$target" ] && ! grep -q "atlas scout-dev wrapper" "$target" 2>/dev/null; then
  if [ "$force" -ne 1 ]; then
    fail "$target already exists and is not managed by Atlas. Re-run with --force to replace it."
  fi
fi

mkdir -p "$bin_dir"
quoted_atlas_url=$(printf "%q" "$atlas_url")
quoted_scout_project=$(printf "%q" "$ROOT_DIR/scout")
tmp_file="$target.tmp.$$"

cat >"$tmp_file" <<WRAPPER
#!/usr/bin/env bash
# atlas scout-dev wrapper
set -euo pipefail

SCOUT_DEV_DEFAULT_ATLAS_URL=$quoted_atlas_url
SCOUT_DEV_DEFAULT_SCOUT_PROJECT=$quoted_scout_project
SCOUT_DEV_ATLAS_URL="\${SCOUT_DEV_ATLAS_URL:-\$SCOUT_DEV_DEFAULT_ATLAS_URL}"
SCOUT_DEV_SCOUT_PROJECT="\${SCOUT_DEV_SCOUT_PROJECT:-\$SCOUT_DEV_DEFAULT_SCOUT_PROJECT}"
SCOUT_DEV_SCOUT_BIN="\${SCOUT_DEV_SCOUT_BIN:-}"

run_scout() {
  if [ -n "\$SCOUT_DEV_SCOUT_BIN" ]; then
    exec "\$SCOUT_DEV_SCOUT_BIN" "\$@"
  fi

  exec uv run --project "\$SCOUT_DEV_SCOUT_PROJECT" scout "\$@"
}

has_atlas_url() {
  local arg
  for arg in "\$@"; do
    case "\$arg" in
      --atlas-url | --atlas-url=*) return 0 ;;
    esac
  done
  return 1
}

atlas_url_for_args() {
  local arg
  local next_is_url=0

  for arg in "\$@"; do
    if [ "\$next_is_url" -eq 1 ]; then
      printf '%s\n' "\$arg"
      return 0
    fi

    case "\$arg" in
      --atlas-url)
        next_is_url=1
        ;;
      --atlas-url=*)
        printf '%s\n' "\${arg#--atlas-url=}"
        return 0
        ;;
    esac
  done

  printf '%s\n' "\$SCOUT_DEV_ATLAS_URL"
}

configure_portless_tls() {
  local atlas_url
  local ca_file

  atlas_url=\$(atlas_url_for_args "\$@")
  case "\$atlas_url" in
    https://*.localhost | https://*.localhost:* | https://*.localhost/*)
      ca_file="\${PORTLESS_CA_FILE:-}"
      if [ -z "\$ca_file" ] && [ -n "\${HOME:-}" ]; then
        ca_file="\$HOME/.portless/ca.pem"
      fi

      if [ -n "\$ca_file" ] && [ -f "\$ca_file" ] && [ -z "\${SSL_CERT_FILE:-}" ]; then
        export SSL_CERT_FILE="\$ca_file"
      fi
      ;;
  esac
}

has_help_arg() {
  local arg
  for arg in "\$@"; do
    case "\$arg" in
      -h | --help) return 0 ;;
    esac
  done
  return 1
}

show_wrapped_help() {
  echo "scout-dev Atlas URL: \$SCOUT_DEV_ATLAS_URL"
  echo "Override with SCOUT_DEV_ATLAS_URL or an explicit --atlas-url."
  echo
  configure_portless_tls "\${original_args[@]}"
  run_scout "\${original_args[@]}"
}

forward_with_dev_atlas_url() {
  if has_help_arg "\${original_args[@]}" && ! has_atlas_url "\${original_args[@]}"; then
    show_wrapped_help
  fi

  configure_portless_tls "\${original_args[@]}"

  if has_atlas_url "\${original_args[@]}"; then
    run_scout "\${original_args[@]}"
  fi

  run_scout "\${prefix[@]}" "\$@" --atlas-url "\$SCOUT_DEV_ATLAS_URL" "\${remaining_args[@]}"
}

if [ "\$#" -eq 0 ]; then
  run_scout --help
fi

original_args=("\$@")
prefix=()
remaining_args=()

while [ "\$#" -gt 0 ]; do
  case "\$1" in
    --config | --profile)
      if [ "\$#" -lt 2 ]; then
        run_scout "\${original_args[@]}"
      fi
      prefix+=("\$1" "\$2")
      shift 2
      ;;
    --config=* | --profile=* | --debug)
      prefix+=("\$1")
      shift
      ;;
    -h | --help | help)
      run_scout "\${original_args[@]}"
      ;;
    -*)
      run_scout "\${original_args[@]}"
      ;;
    *)
      break
      ;;
  esac
done

command_name="\${1:-}"
if [ -z "\$command_name" ]; then
  run_scout "\${prefix[@]}" --help
fi
shift
remaining_args=("\$@")

case "\$command_name" in
  login | setup | sync)
    forward_with_dev_atlas_url "\$command_name"
    ;;
  worker)
    worker_command="\${remaining_args[0]:-}"
    case "\$worker_command" in
      start | run-internal)
        remaining_args=("\${remaining_args[@]:1}")
        forward_with_dev_atlas_url worker "\$worker_command"
        ;;
      *)
        run_scout "\${original_args[@]}"
        ;;
    esac
    ;;
  runs)
    runs_command="\${remaining_args[0]:-}"
    case "\$runs_command" in
      sync)
        remaining_args=("\${remaining_args[@]:1}")
        forward_with_dev_atlas_url runs sync
        ;;
      *)
        run_scout "\${original_args[@]}"
        ;;
    esac
    ;;
  *)
    run_scout "\${original_args[@]}"
    ;;
esac
WRAPPER

chmod 0755 "$tmp_file"
mv "$tmp_file" "$target"

echo "Installed scout-dev at $target"
echo "Default Atlas URL: $atlas_url"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    echo "Note: $bin_dir is not on PATH for this shell."
    echo "Add it to PATH or run $target directly."
    ;;
esac
