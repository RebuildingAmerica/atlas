#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

note() {
  printf "    %s\n" "$1"
}

get_env_value() {
  file="$1"
  key="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, "", $0); print $0}' "$file" | tail -n 1
}

set_env_value() {
  file="$1"
  key="$2"
  value="$3"
  tmp_file=$(mktemp)

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file" >"$tmp_file"

  mv "$tmp_file" "$file"
}

remove_env_key() {
  file="$1"
  key="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  tmp_file=$(mktemp)
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$file" >"$tmp_file"
  mv "$tmp_file" "$file"
}

generate_secret() {
  python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
}

is_blank_or_placeholder() {
  value="$1"
  placeholder="$2"
  [ -z "$value" ] || [ "$value" = "$placeholder" ]
}

ensure_env_value() {
  file="$1"
  key="$2"
  default_value="$3"

  current_value=$(get_env_value "$file" "$key")
  if [ -z "$current_value" ]; then
    set_env_value "$file" "$key" "$default_value"
  fi
}

ensure_backend_env() {
  if [ ! -f "$repo_root/api/.env" ]; then
    cp "$repo_root/api/.env.example" "$repo_root/api/.env"
    note "Created api/.env from api/.env.example"
  else
    note "Keeping existing api/.env"
  fi
}

ensure_frontend_env() {
  frontend_env="$repo_root/app/.env.local"
  frontend_secret=$(generate_secret)

  if [ ! -f "$frontend_env" ]; then
    cat >"$frontend_env" <<EOF
ATLAS_PUBLIC_URL=http://localhost:3000
ATLAS_DEPLOY_MODE=local
ATLAS_DEV_API_PROXY_TARGET=http://localhost:8000
ATLAS_AUTH_BASE_PATH=/api/auth
ATLAS_AUTH_INTERNAL_SECRET=$frontend_secret
ATLAS_AUTH_API_KEY_INTROSPECTION_URL=http://localhost:3000/api/auth/internal/api-key
ATLAS_EMAIL_PROVIDER=capture
ATLAS_EMAIL_FROM=Atlas <noreply@localhost>
ATLAS_EMAIL_CAPTURE_URL=http://127.0.0.1:8025/messages
ATLAS_EMAIL_RESEND_API_KEY=
EOF
    note "Created app/.env.local with local host-development defaults"
    return 0
  fi

  note "Keeping existing app/.env.local"
  remove_env_key "$frontend_env" "ATLAS_LOCAL"
  ensure_env_value "$frontend_env" "ATLAS_DEPLOY_MODE" "local"
  ensure_env_value "$frontend_env" "ATLAS_DEV_API_PROXY_TARGET" "http://localhost:8000"
  ensure_env_value "$frontend_env" "ATLAS_AUTH_API_KEY_INTROSPECTION_URL" "http://localhost:3000/api/auth/internal/api-key"
  current_secret=$(get_env_value "$frontend_env" "ATLAS_AUTH_INTERNAL_SECRET")
  if is_blank_or_placeholder "$current_secret" "replace-with-a-local-secret-if-you-enable-auth" || \
    is_blank_or_placeholder "$current_secret" "replace-with-a-local-secret"; then
    set_env_value "$frontend_env" "ATLAS_AUTH_INTERNAL_SECRET" "$frontend_secret"
    note "Generated app/.env.local auth secret"
  fi
}

ensure_frontend_e2e_env() {
  frontend_e2e_env="$repo_root/app/.env.e2e"

  if [ ! -f "$frontend_e2e_env" ]; then
    cat >"$frontend_e2e_env" <<'EOF'
ATLAS_E2E_APP_URL=http://localhost:3100
ATLAS_E2E_API_URL=http://localhost:38000
ATLAS_E2E_AUTH_INTROSPECTION_URL=http://127.0.0.1:3100/api/auth/internal/api-key
ATLAS_E2E_MAILBOX_URL=http://localhost:8025
EOF
    note "Created app/.env.e2e with local end-to-end defaults"
  else
    note "Keeping existing app/.env.e2e"
  fi
}

ensure_compose_local_env() {
  compose_env="$repo_root/.env"
  compose_secret=$(generate_secret)

  if [ ! -f "$compose_env" ]; then
    cp "$repo_root/.env.example" "$compose_env"
    note "Created .env from .env.example"
  else
    note "Keeping existing .env"
  fi

  if grep -Eq '^(VITE_API_URL|ATLAS_PUBLIC_DOMAIN|ENABLE_API_DOCS)=' "$compose_env"; then
    preserved_anthropic_key=$(get_env_value "$compose_env" "ANTHROPIC_API_KEY")
    preserved_search_key=$(get_env_value "$compose_env" "SEARCH_API_KEY")
    cp "$repo_root/.env.example" "$compose_env"
    if [ -n "$preserved_anthropic_key" ]; then
      set_env_value "$compose_env" "ANTHROPIC_API_KEY" "$preserved_anthropic_key"
    fi
    if [ -n "$preserved_search_key" ]; then
      set_env_value "$compose_env" "SEARCH_API_KEY" "$preserved_search_key"
    fi
    note "Upgraded .env to the current local Compose format"
  fi

  remove_env_key "$compose_env" "VITE_API_URL"
  remove_env_key "$compose_env" "ATLAS_PUBLIC_DOMAIN"
  remove_env_key "$compose_env" "ENABLE_API_DOCS"

  ensure_env_value "$compose_env" "DATABASE_URL" "sqlite:///data/atlas.db"
  ensure_env_value "$compose_env" "ANTHROPIC_API_KEY" "replace-with-your-anthropic-api-key"
  ensure_env_value "$compose_env" "SEARCH_API_KEY" ""
  ensure_env_value "$compose_env" "CORS_ORIGINS" "[\"https://localhost\"]"
  ensure_env_value "$compose_env" "LOG_LEVEL" "info"
  ensure_env_value "$compose_env" "ENVIRONMENT" "dev"
  ensure_env_value "$compose_env" "ENABLE_OPENAPI_SPEC" "true"
  ensure_env_value "$compose_env" "ENABLE_API_DOCS_UI" "true"
  ensure_env_value "$compose_env" "ATLAS_PUBLIC_URL" "https://localhost"
  ensure_env_value "$compose_env" "ATLAS_DEPLOY_MODE" "local"
  ensure_env_value "$compose_env" "ATLAS_AUTH_ALLOWED_EMAILS" ""
  ensure_env_value "$compose_env" "ATLAS_EMAIL_PROVIDER" "capture"
  ensure_env_value "$compose_env" "ATLAS_EMAIL_FROM" "Atlas <noreply@localhost>"
  ensure_env_value "$compose_env" "ATLAS_EMAIL_CAPTURE_URL" "http://127.0.0.1:8025/messages"
  ensure_env_value "$compose_env" "ATLAS_EMAIL_RESEND_API_KEY" ""

  current_secret=$(get_env_value "$compose_env" "ATLAS_AUTH_INTERNAL_SECRET")
  if is_blank_or_placeholder "$current_secret" "replace-with-a-local-secret-if-you-enable-auth"; then
    set_env_value "$compose_env" "ATLAS_AUTH_INTERNAL_SECRET" "$compose_secret"
    note "Generated .env auth secret"
  fi
}

ensure_production_env() {
  production_env="$repo_root/.env.production"
  production_secret=$(generate_secret)

  if [ ! -f "$production_env" ]; then
    cp "$repo_root/.env.production.example" "$production_env"
    note "Created .env.production from .env.production.example"
  else
    note "Keeping existing .env.production"
  fi

  current_secret=$(get_env_value "$production_env" "ATLAS_AUTH_INTERNAL_SECRET")
  if is_blank_or_placeholder "$current_secret" "replace-with-a-long-random-secret"; then
    set_env_value "$production_env" "ATLAS_AUTH_INTERNAL_SECRET" "$production_secret"
    note "Generated .env.production auth secret"
  fi

  current_provider=$(get_env_value "$production_env" "ATLAS_EMAIL_PROVIDER")
  current_resend_key=$(get_env_value "$production_env" "ATLAS_EMAIL_RESEND_API_KEY")
  if [ "$current_provider" = "resend" ] && \
    is_blank_or_placeholder "$current_resend_key" "replace-with-your-resend-api-key"; then
    if [ -n "${ATLAS_EMAIL_RESEND_API_KEY:-}" ]; then
      set_env_value "$production_env" "ATLAS_EMAIL_RESEND_API_KEY" "$ATLAS_EMAIL_RESEND_API_KEY"
      note "Hydrated .env.production resend API key from the shell environment"
    else
      note ".env.production still needs ATLAS_EMAIL_RESEND_API_KEY before production deploys"
    fi
  fi
}

ensure_backend_env
ensure_frontend_env
ensure_frontend_e2e_env
ensure_compose_local_env
ensure_production_env
