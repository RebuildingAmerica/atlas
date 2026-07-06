#!/bin/sh
# Reset portless state and start a fresh proxy daemon before turbo dev.
#
# Why: routes/lock files corrupt when prior dev runs crash or race, and
# parallel `portless <name> <cmd>` invocations cannot auto-start the proxy
# consistently. Atlas local development uses standard HTTPS Portless aliases
# such as https://atlas.localhost; if that setup needs sudo or a service
# install, fail loudly instead of hiding the requirement behind a numbered port.

set -e

PORTLESS_DIR="${HOME}/.portless"
PORTLESS_PORT="${PORTLESS_PORT:-443}"
PORTLESS_GLOBAL_BIN="${HOME}/Library/pnpm/bin/portless"

mkdir -p "${PORTLESS_DIR}"

portless_stop_bin() {
  if [ -n "${PORTLESS_STOP_BIN:-}" ]; then
    printf '%s\n' "${PORTLESS_STOP_BIN}"
    return
  fi

  if [ -x "${PORTLESS_GLOBAL_BIN}" ]; then
    printf '%s\n' "${PORTLESS_GLOBAL_BIN}"
    return
  fi

  command -v portless 2>/dev/null || printf '%s\n' "portless"
}

https_proxy_is_ready() {
  curl -kIs --max-time 2 "https://127.0.0.1:${PORTLESS_PORT}/" 2>/dev/null |
    grep -qi '^x-portless: 1'
}

fail_unroutable_proxy() {
  cat >&2 <<EOF
[portless-reset] Portless HTTPS proxy is running on port ${PORTLESS_PORT}, but Atlas cannot register routes through it.

This usually means the running Portless proxy has a stale route watcher or was
started with a different state context. The proxy must be restarted; Atlas will
not hide this behind a numbered localhost URL.

Run this once in a real terminal so macOS can ask for the admin password:
  sudo $(portless_stop_bin) proxy stop -p ${PORTLESS_PORT}

Then start the user-owned proxy and restart Atlas:
  portless proxy start --https
  pnpm dev

Atlas does not fall back to a numbered localhost port.
EOF
  exit 1
}

proxy_routes_user_state() {
  SMOKE_HOST="atlas-portless-smoke-$$"

  if ! pnpm exec portless alias "${SMOKE_HOST}" 9 --force >/dev/null 2>&1; then
    return 1
  fi

  for _ in 1 2 3 4 5; do
    STATUS=$(curl -kIs -o /dev/null -w "%{http_code}" --max-time 2 "https://${SMOKE_HOST}.localhost/" 2>/dev/null || true)
    if [ -n "${STATUS}" ] && [ "${STATUS}" != "000" ] && [ "${STATUS}" != "404" ]; then
      pnpm exec portless alias --remove "${SMOKE_HOST}" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 0.2
  done

  pnpm exec portless alias --remove "${SMOKE_HOST}" >/dev/null 2>&1 || true
  return 1
}

stop_nonstandard_proxy_state() {
  if [ ! -f "${PORTLESS_DIR}/proxy.port" ]; then
    return
  fi

  ACTIVE_PORT=$(cat "${PORTLESS_DIR}/proxy.port" 2>/dev/null || true)
  if [ "${ACTIVE_PORT}" = "${PORTLESS_PORT}" ]; then
    return
  fi

  PID=$(cat "${PORTLESS_DIR}/proxy.pid" 2>/dev/null || true)
  if [ -n "${PID}" ] && kill -0 "${PID}" 2>/dev/null; then
    kill "${PID}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "${PID}" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "${PID}" 2>/dev/null; then
      kill -9 "${PID}" 2>/dev/null || true
    fi
    if kill -0 "${PID}" 2>/dev/null; then
      echo "[portless-reset] Portless is running on nonstandard port ${ACTIVE_PORT}. Stop it before starting Atlas." >&2
      exit 1
    fi
  fi

  rm -f \
    "${PORTLESS_DIR}/proxy.pid" \
    "${PORTLESS_DIR}/proxy.port" \
    "${PORTLESS_DIR}/proxy.tls" \
    "${PORTLESS_DIR}/proxy.log"
}

stop_nonstandard_proxy_state

rm -rf "${PORTLESS_DIR}/routes.lock"

if https_proxy_is_ready; then
  if ! proxy_routes_user_state; then
    fail_unroutable_proxy
  fi
  exit 0
fi

rm -f \
  "${PORTLESS_DIR}/routes.json" \
  "${PORTLESS_DIR}/proxy.pid" \
  "${PORTLESS_DIR}/proxy.port" \
  "${PORTLESS_DIR}/proxy.tls" \
  "${PORTLESS_DIR}/proxy.log"

# Start a fresh proxy on the standard HTTPS port.
if ! pnpm exec portless proxy start --port "${PORTLESS_PORT}" --https; then
  cat >&2 <<'EOF'
[portless-reset] Atlas local dev requires standard Portless HTTPS aliases:
  https://atlas.localhost
  https://api.atlas.localhost

Portless could not start the HTTPS proxy. If Portless asks for sudo,
complete that setup or install the Portless service, then rerun pnpm dev:
  pnpm exec portless trust
  pnpm exec portless service install

Atlas does not fall back to a numbered localhost port. Stop any process
already using port 443 before starting Atlas.
EOF
  exit 1
fi

# Wait for the proxy to write its pid/port files before returning, so the
# subsequent parallel `portless <name> <cmd>` invocations all see it ready.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f "${PORTLESS_DIR}/proxy.pid" ] && [ -f "${PORTLESS_DIR}/proxy.port" ]; then
    exit 0
  fi
  sleep 0.3
done

echo "[portless-reset] proxy did not start within 3s" >&2
exit 1
