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

step() {
  printf '\n\033[1mStep %s: %s\033[0m\n' "$1" "$2"
}

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
http_status="$(curl -sS -o /tmp/brave-probe.json -w '%{http_code}' \
  --max-time 30 \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_TOKEN" \
  'https://api.search.brave.com/res/v1/web/search?q=mutual+aid+network+kansas+city&count=1')"

if [ "$http_status" != "200" ]; then
  echo "Brave answered $http_status rather than 200. The response was:"
  cat /tmp/brave-probe.json
  echo
  echo "A 401 means the token is wrong. A 429 means the subscription is not"
  echo "active yet, which can take a few minutes after you subscribe."
  rm -f /tmp/brave-probe.json
  exit 1
fi
rm -f /tmp/brave-probe.json
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
echo "The newest release tag is $LATEST_TAG."
echo
read -r -p "Redeploy production from $LATEST_TAG now? [y/N] " REDEPLOY
case "$REDEPLOY" in
  [yY]*)
    gh workflow run "Deploy Production" --repo RebuildingAmerica/atlas --ref "$LATEST_TAG"
    echo "Dispatched. Watching the run ..."
    sleep 20
    RUN_ID="$(gh run list --workflow='Deploy Production' --limit 1 --json databaseId -q '.[0].databaseId')"
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

step 6 "Confirm discovery can search"
echo "Trigger a discovery run from the operator console, or wait for the"
echo "nightly Cloud Scheduler job. Then check the catalog count:"
echo
echo "  curl -s 'https://atlas.rebuildingus.org/api/entities?limit=1' | jq .total"
echo
echo "It reads 436 today. A working run moves it."
