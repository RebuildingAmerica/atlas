#!/usr/bin/env bash
#
# Enables every discovery schedule target and enqueues one durable job for
# each, then reports what the catalog holds.
#
# Volume comes from the number of targets rather than the number of triggers.
# /api/discovery-runs/scheduled keys each job as "sched:<schedule>:<day>", so
# firing it twice in one day is a no-op for a target that already ran, and one
# target yields at most DISCOVERY_REGISTRY_MAX_ORGANIZATIONS organizations.
#
# Reads ATLAS_AUTH_INTERNAL_SECRET from .env.production, which is gitignored.

set -euo pipefail

cd "$(dirname "$0")/.."

ATLAS_URL="${ATLAS_URL:-https://atlas.rebuildingus.org}"
ENV_FILE=".env.production"
ACTOR_EMAIL="${ATLAS_OPERATOR_EMAIL:-operator@atlas.rebuildingus.org}"

step() {
  printf '\n\033[1mStep %s: %s\033[0m\n' "$1" "$2"
}

step 1 "Read the internal secret"
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE is missing, and it holds ATLAS_AUTH_INTERNAL_SECRET."
  exit 1
fi
SECRET="$(grep -E '^ATLAS_AUTH_INTERNAL_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$SECRET" ]; then
  echo "ATLAS_AUTH_INTERNAL_SECRET is not set in $ENV_FILE."
  exit 1
fi

# The API accepts the shared secret only alongside an actor identity, so that
# every trusted write still names who made it.
auth=(-H "X-Atlas-Internal-Secret: $SECRET"
  -H "X-Atlas-Actor-Id: discovery-sweep"
  -H "X-Atlas-Actor-Email: $ACTOR_EMAIL")
echo "Talking to $ATLAS_URL as $ACTOR_EMAIL."

step 2 "Enable every schedule target"
schedules="$(curl -sS "$ATLAS_URL/api/discovery-schedules?limit=500" "${auth[@]}")"
echo "$schedules" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data["items"]:
    print(item["id"], item["enabled"], item["location_query"], sep="\t")
' | while IFS=$'\t' read -r id enabled location; do
  if [ "$enabled" = "True" ]; then
    echo "  already enabled: $location"
    continue
  fi
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X PATCH "$ATLAS_URL/api/discovery-schedules/$id" \
    -H "Content-Type: application/json" "${auth[@]}" \
    -d '{"enabled":true}')"
  echo "  enabled $location (HTTP $status)"
done

step 3 "Enqueue one durable job per enabled schedule"
curl -sS -X POST "$ATLAS_URL/api/discovery-runs/scheduled" "${auth[@]}" |
  python3 -c 'import json,sys; print("enqueued", json.load(sys.stdin)["enqueued"], "jobs")'

step 4 "Report the public catalog total"
curl -sS "$ATLAS_URL/api/entities?limit=1" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["total"], "public entities")'
echo
echo "The durable worker picks the jobs up on its next poll. Re-run step 4 to watch."
