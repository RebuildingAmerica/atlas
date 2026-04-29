#!/bin/sh
# Reset portless state and start a fresh proxy daemon before turbo dev.
#
# Why: routes/lock files corrupt when prior dev runs crash or race, and
# parallel `portless <name> <cmd>` invocations cannot auto-start the proxy
# (it needs sudo for port 443 — no TTY available under pnpm). We start it
# here on an unprivileged port so route registrations from the workspace
# tasks all succeed.

set -e

PORTLESS_DIR="${HOME}/.portless"
PORTLESS_PORT="${PORTLESS_PORT:-1355}"

mkdir -p "${PORTLESS_DIR}"

# Stop any existing daemon so we start from a known state.
if [ -f "${PORTLESS_DIR}/proxy.pid" ]; then
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
  fi
fi

rm -rf \
  "${PORTLESS_DIR}/routes.json" \
  "${PORTLESS_DIR}/routes.lock" \
  "${PORTLESS_DIR}/proxy.pid" \
  "${PORTLESS_DIR}/proxy.port" \
  "${PORTLESS_DIR}/proxy.tls" \
  "${PORTLESS_DIR}/proxy.log"

# Start a fresh proxy on an unprivileged port (no sudo required).
pnpm exec portless proxy start --port "${PORTLESS_PORT}" --https >/dev/null 2>&1

# Wait for the proxy to write its pid/port files before returning, so the
# subsequent parallel `portless <name> <cmd>` invocations all see it ready.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f "${PORTLESS_DIR}/proxy.pid" ] && [ -f "${PORTLESS_DIR}/proxy.port" ]; then
    # Register a static alias for mint dev — it always binds to port 3000
    # and ignores PORT env, so it cannot use the standard `portless <name>
    # <cmd>` wrapper that allocates a port and injects PORT.
    pnpm exec portless alias docs 3000 >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 0.3
done

echo "[portless-reset] proxy did not start within 3s" >&2
exit 1
