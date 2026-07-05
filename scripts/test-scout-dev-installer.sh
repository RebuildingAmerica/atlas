#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/atlas-scout-dev.XXXXXX")

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

BIN_DIR="$TMP_DIR/bin"
NO_HOME_BIN_DIR="$TMP_DIR/no-home-bin"
FAKE_BIN_DIR="$TMP_DIR/fake-bin"
HOME_DIR="$TMP_DIR/home"
CALL_LOG="$TMP_DIR/scout-calls.log"
ENV_LOG="$TMP_DIR/scout-env.log"
PORTLESS_CA_FILE="$HOME_DIR/.portless/ca.pem"
mkdir -p "$BIN_DIR" "$NO_HOME_BIN_DIR" "$FAKE_BIN_DIR" "$(dirname "$PORTLESS_CA_FILE")"
touch "$PORTLESS_CA_FILE"

cat >"$FAKE_BIN_DIR/scout" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$SCOUT_DEV_CALL_LOG"
printf 'SSL_CERT_FILE=%s\n' "${SSL_CERT_FILE:-}" >>"$SCOUT_DEV_ENV_LOG"
SH
chmod 0755 "$FAKE_BIN_DIR/scout"

PATH="$BIN_DIR:$FAKE_BIN_DIR:$PATH" \
  HOME="$HOME_DIR" \
  "$ROOT_DIR/install-scout-dev.sh" \
  --bin-dir "$BIN_DIR"

if [ ! -x "$BIN_DIR/scout-dev" ]; then
  echo "Expected scout-dev to be installed as an executable." >&2
  exit 1
fi

run_scout_dev() {
  PATH="$BIN_DIR:$FAKE_BIN_DIR:$PATH" \
    HOME="$HOME_DIR" \
    SCOUT_DEV_CALL_LOG="$CALL_LOG" \
    SCOUT_DEV_ENV_LOG="$ENV_LOG" \
    "$BIN_DIR/scout-dev" "$@"
}

run_scout_dev login --no-browser
run_scout_dev worker start --interval 1
run_scout_dev worker run-internal --lease-seconds 30
run_scout_dev sync latest
run_scout_dev runs sync run-123 --target public
run_scout_dev --config dev.toml login --no-browser
SCOUT_DEV_ATLAS_URL="https://atlas.localhost:2468" run_scout_dev login --no-browser
run_scout_dev login --atlas-url "http://custom.test" --no-browser
SSL_CERT_FILE="/custom/ca.pem" run_scout_dev login --no-browser
REQUESTS_CA_BUNDLE="/custom/requests.pem" run_scout_dev login --no-browser
run_scout_dev worker status
HELP_OUTPUT=$(run_scout_dev login --help)

if [[ "$HELP_OUTPUT" != *"scout-dev Atlas URL: https://atlas.localhost:1355"* ]]; then
  echo "Expected scout-dev help to show the active dev Atlas URL." >&2
  exit 1
fi

cat >"$TMP_DIR/expected-calls.log" <<'EOF'
login --atlas-url https://atlas.localhost:1355 --no-browser
worker start --atlas-url https://atlas.localhost:1355 --interval 1
worker run-internal --atlas-url https://atlas.localhost:1355 --lease-seconds 30
sync --atlas-url https://atlas.localhost:1355 latest
runs sync --atlas-url https://atlas.localhost:1355 run-123 --target public
--config dev.toml login --atlas-url https://atlas.localhost:1355 --no-browser
login --atlas-url https://atlas.localhost:2468 --no-browser
login --atlas-url http://custom.test --no-browser
login --atlas-url https://atlas.localhost:1355 --no-browser
login --atlas-url https://atlas.localhost:1355 --no-browser
worker status
login --help
EOF

if ! diff -u "$TMP_DIR/expected-calls.log" "$CALL_LOG"; then
  echo "scout-dev forwarded unexpected Scout arguments." >&2
  exit 1
fi

cat >"$TMP_DIR/expected-env.log" <<EOF
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=
SSL_CERT_FILE=/custom/ca.pem
SSL_CERT_FILE=$PORTLESS_CA_FILE
SSL_CERT_FILE=
SSL_CERT_FILE=$PORTLESS_CA_FILE
EOF

if ! diff -u "$TMP_DIR/expected-env.log" "$ENV_LOG"; then
  echo "scout-dev configured unexpected TLS certificate environment." >&2
  exit 1
fi

PATH="$BIN_DIR:$FAKE_BIN_DIR:$PATH" \
  HOME="$HOME_DIR" \
  "$ROOT_DIR/uninstall-scout-dev.sh" \
  --bin-dir "$BIN_DIR"

if [ -e "$BIN_DIR/scout-dev" ]; then
  echo "Expected scout-dev to be removed by the uninstaller." >&2
  exit 1
fi

cat >"$BIN_DIR/scout-dev" <<'SH'
#!/usr/bin/env bash
echo unmanaged
SH

if PATH="$BIN_DIR:$FAKE_BIN_DIR:$PATH" \
  HOME="$HOME_DIR" \
  "$ROOT_DIR/uninstall-scout-dev.sh" \
  --bin-dir "$BIN_DIR" >"$TMP_DIR/uninstall.out" 2>"$TMP_DIR/uninstall.err"; then
  echo "Expected uninstaller to refuse unmanaged scout-dev." >&2
  exit 1
fi

grep -q "not managed by Atlas" "$TMP_DIR/uninstall.err"

env -u HOME "$ROOT_DIR/install-scout-dev.sh" --bin-dir "$NO_HOME_BIN_DIR"

if [ ! -x "$NO_HOME_BIN_DIR/scout-dev" ]; then
  echo "Expected scout-dev to install with --bin-dir when HOME is unset." >&2
  exit 1
fi

env -u HOME "$ROOT_DIR/uninstall-scout-dev.sh" --bin-dir "$NO_HOME_BIN_DIR"

if [ -e "$NO_HOME_BIN_DIR/scout-dev" ]; then
  echo "Expected scout-dev to uninstall with --bin-dir when HOME is unset." >&2
  exit 1
fi

echo "scout-dev installer smoke passed."
