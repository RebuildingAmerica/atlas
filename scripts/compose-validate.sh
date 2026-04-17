#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
docker_cmd="sh ${repo_root}/scripts/docker.sh"

${docker_cmd} compose --env-file "${repo_root}/.env.example" -f "${repo_root}/compose.yaml" config >/dev/null
${docker_cmd} compose --env-file "${repo_root}/.env.production.example" -f "${repo_root}/compose.yaml" config >/dev/null

printf 'Compose validation passed\n'
