#!/usr/bin/env bash
#
# Gives Atlas a Brave Search subscription token, stores it as the
# SEARCH_API_KEY repository secret, and redeploys so the discovery pipeline
# can actually search. Without this key build_search_provider returns None
# and every discovery run finds nothing, which is why the catalog has been
# stuck at 436 records.
#
# Run once. Re-running replaces the key.

set -euo pipefail

# Runnable from anywhere. The git and gh calls below both need the checkout.
cd "$(dirname "$0")/.."

ATLAS_URL="https://atlas.rebuildingus.org"

step() {
  printf '\n\033[1mStep %s: %s\033[0m\n' "$1" "$2"
}

probe_body=""
cleanup() {
  [ -n "$probe_body" ] && rm -f "$probe_body"
}
trap cleanup EXIT

step 1 "Check the tools this needs"
for tool in gh curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. Install it and run this again."
    exit 1
  fi
done
if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not signed in. Run 'gh auth login' and start this again."
  exit 1
fi
echo "gh and curl are both ready."

step 2 "Get a Brave Search API key"
cat <<'INSTRUCTIONS'
Atlas uses the Brave Search API to find candidate civic actors. The free
tier allows 2,000 queries a month at 1 query per second, which is enough to
run discovery nightly.

  1. Open https://api-dashboard.search.brave.com/register
  2. Sign up, then subscribe to the "Data for Search" Free plan.
     Brave asks for a card even on the free plan, and does not charge it.
  3. Open https://api-dashboard.search.brave.com/app/keys and add a key.
  4. Copy the token.

INSTRUCTIONS
read -r -s -p "Paste the Brave subscription token: " BRAVE_TOKEN
echo
if [ -z "$BRAVE_TOKEN" ]; then
  echo "A token is required."
  exit 1
fi

step 3 "Confirm the token actually works"
probe_body="$(mktemp)"
http_status="$(curl -sS -o "$probe_body" -w '%{http_code}' \
  --max-time 30 \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_TOKEN" \
  'https://api.search.brave.com/res/v1/web/search?q=mutual+aid+network+kansas+city&count=1')"

if [ "$http_status" != "200" ]; then
  echo "Brave answered $http_status rather than 200. The response was:"
  cat "$probe_body"
  echo
  echo "A 401 means the token is wrong. A 429 means the subscription is not"
  echo "active yet, which can take a few minutes after you subscribe."
  exit 1
fi
echo "Brave returned results for a live query."

step 4 "Store the token as a repository secret"
printf '%s' "$BRAVE_TOKEN" | gh secret set SEARCH_API_KEY --repo RebuildingAmerica/atlas
echo "SEARCH_API_KEY is set. Staging and production both read it at deploy time."

step 5 "Redeploy production so the API picks it up"
# The deploy action passes SEARCH_API_KEY to Cloud Run through
# --update-env-vars, so the running revision keeps the empty value it was
# created with until something redeploys. Dispatching the workflow against
# the tag already in production ships the same code with the new key, and
# mints no version tag.
git fetch origin --tags --quiet
LATEST_TAG="$(git tag --list 'v*' --sort=-creatordate | head -1)"
if [ -z "$LATEST_TAG" ]; then
  echo "No v* release tag exists, so there is nothing to redeploy from."
  echo "The key is stored. Tag a release and production will pick it up."
  exit 0
fi
echo "The newest release tag is $LATEST_TAG."
echo
read -r -p "Redeploy production from $LATEST_TAG now? [y/N] " REDEPLOY
case "$REDEPLOY" in
  [yY]*)
    # Recorded before the dispatch so the poll below cannot latch onto the
    # deploy that is already sitting at the top of the list.
    PREVIOUS_RUN="$(gh run list --workflow='Deploy Production' --limit 1 \
      --json databaseId -q '.[0].databaseId // ""')"
    gh workflow run "Deploy Production" --repo RebuildingAmerica/atlas --ref "$LATEST_TAG"
    echo "Dispatched. Waiting for the run to register ..."
    RUN_ID=""
    for _ in $(seq 1 20); do
      sleep 5
      RUN_ID="$(gh run list --workflow='Deploy Production' --event workflow_dispatch \
        --limit 1 --json databaseId -q '.[0].databaseId // ""')"
      if [ -n "$RUN_ID" ] && [ "$RUN_ID" != "$PREVIOUS_RUN" ]; then
        break
      fi
      RUN_ID=""
    done
    if [ -z "$RUN_ID" ]; then
      echo "The dispatch did not appear within 100 seconds. Watch it yourself:"
      echo "  gh run list --workflow='Deploy Production'"
      exit 1
    fi
    echo "Watching run $RUN_ID ..."
    gh run watch "$RUN_ID" --exit-status
    ;;
  *)
    echo "Skipped. The key is stored but production still runs without it."
    echo "Deploy when you are ready:"
    echo
    echo "  gh workflow run 'Deploy Production' --ref $LATEST_TAG"
    exit 0
    ;;
esac

step 6 "Report what the key does and does not unblock"
total="$(curl -sS --max-time 30 "$ATLAS_URL/api/entities?limit=1" |
  sed -n 's/.*"total":\([0-9]*\).*/\1/p')"
echo "The public catalog holds ${total:-an unknown number of} records."
echo
echo "The key lets discovery search. It does not give it anywhere to look."
echo "Cloud Scheduler fires every enabled discovery target nightly at 02:00"
echo "America/Chicago, and a deployment with no targets searches nothing."
echo "List them, and add one if the list is empty:"
echo
echo "  GET  $ATLAS_URL/api/discovery-schedules?enabled_only=true"
echo "  POST $ATLAS_URL/api/discovery-schedules"
echo
echo "Both need the X-Atlas-Internal-Secret header that Cloud Scheduler sends."
