#!/usr/bin/env bash
#
# Grants the Atlas deploy service account the monitoring roles the Error
# Alerting workflow needs, then dispatches it. Granting project IAM needs an
# account with IAM admin, which the CI service account is not.
#
# Run once. Idempotent.

set -euo pipefail

step() {
  printf '\n\033[1mStep %s: %s\033[0m\n' "$1" "$2"
}

step 1 "Check the tools this needs"
for tool in gcloud gh; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. Install it and run this again."
    exit 1
  fi
done
echo "gcloud and gh are both present."

step 2 "Sign in to Google Cloud"
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "Your gcloud credentials are expired. A browser window will open."
  gcloud auth login
else
  echo "Already signed in as $(gcloud config get-value account 2>/dev/null)."
fi

step 3 "Name the project and the service account"
read -r -p "GCP project id for Atlas production: " PROJECT_ID
if [ -z "$PROJECT_ID" ]; then
  echo "A project id is required."
  exit 1
fi

DEFAULT_SA="$(gcloud iam service-accounts list --project="$PROJECT_ID" \
  --filter='displayName~deploy OR email~deploy OR email~github' \
  --format='value(email)' 2>/dev/null | head -1)"

if [ -n "$DEFAULT_SA" ]; then
  read -r -p "Deploy service account [$DEFAULT_SA]: " SERVICE_ACCOUNT
  SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-$DEFAULT_SA}"
else
  echo "Service accounts on $PROJECT_ID:"
  gcloud iam service-accounts list --project="$PROJECT_ID" --format='value(email)'
  read -r -p "Deploy service account email: " SERVICE_ACCOUNT
fi

if [ -z "$SERVICE_ACCOUNT" ]; then
  echo "A service account is required."
  exit 1
fi

step 4 "Grant the two roles the alert needs"
# monitoring.editor covers the policy and the channel; logging.viewer lets a
# later job read back what fired.
for role in roles/monitoring.editor roles/logging.viewer; do
  echo "Granting $role ..."
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
done
echo "Both roles granted."

step 5 "Choose where the alerts go"
read -r -p "Email address to notify on a production error: " ALERT_EMAIL
if [ -z "$ALERT_EMAIL" ]; then
  echo "An address is required."
  exit 1
fi

step 6 "Create the alert"
gh workflow run error-alerting.yml -f "alert_email=$ALERT_EMAIL"
echo "Dispatched. Watching the run ..."
sleep 15
RUN_ID="$(gh run list --workflow=error-alerting.yml --limit 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status

step 7 "Confirm"
echo "Alert policy 'Atlas API errors' now notifies $ALERT_EMAIL."
echo "Google sends a confirmation email to that address. Accept it, or the"
echo "channel stays unverified and delivers nothing."
