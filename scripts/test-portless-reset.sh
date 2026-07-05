#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/atlas-portless-reset.XXXXXX")

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

FAKE_BIN_DIR="$TMP_DIR/fake-bin"
HOME_DIR="$TMP_DIR/home"
CALL_LOG="$TMP_DIR/pnpm-calls.log"
mkdir -p "$FAKE_BIN_DIR" "$HOME_DIR"

cat >"$FAKE_BIN_DIR/pnpm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$PORTLESS_RESET_CALL_LOG"

if [ "${PORTLESS_RESET_FAIL:-0}" = "1" ]; then
  exit 77
fi

port=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--port" ]; then
    port="$arg"
    break
  fi
  previous="$arg"
done

if [ -z "$port" ]; then
  echo "fake pnpm expected --port" >&2
  exit 2
fi

mkdir -p "$HOME/.portless"
printf '%s\n' "$$" >"$HOME/.portless/proxy.pid"
printf '%s\n' "$port" >"$HOME/.portless/proxy.port"
printf '%s\n' "1" >"$HOME/.portless/proxy.tls"
SH
chmod 0755 "$FAKE_BIN_DIR/pnpm"

PATH="$FAKE_BIN_DIR:$PATH" \
  HOME="$HOME_DIR" \
  PORTLESS_RESET_CALL_LOG="$CALL_LOG" \
  sh "$ROOT_DIR/scripts/portless-reset.sh"

grep -qx "exec portless proxy start --port 443 --https" "$CALL_LOG"
grep -qx "443" "$HOME_DIR/.portless/proxy.port"

FAIL_HOME="$TMP_DIR/fail-home"
mkdir -p "$FAIL_HOME"

if PATH="$FAKE_BIN_DIR:$PATH" \
  HOME="$FAIL_HOME" \
  PORTLESS_RESET_CALL_LOG="$CALL_LOG" \
  PORTLESS_RESET_FAIL=1 \
  sh "$ROOT_DIR/scripts/portless-reset.sh" >"$TMP_DIR/fail.out" 2>"$TMP_DIR/fail.err"; then
  echo "Expected portless reset to fail when the proxy cannot start." >&2
  exit 1
fi

grep -q "Atlas local dev requires standard Portless HTTPS aliases" "$TMP_DIR/fail.err"
grep -q "Atlas does not fall back to a numbered localhost port" "$TMP_DIR/fail.err"

echo "portless reset smoke passed."
