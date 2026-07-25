# Cloud Cost Standards

[Docs](../README.md) > [Standards](./README.md) > Cloud Cost Standards

Atlas should stay cheap enough to keep the public directory online and reliable.
Cost controls protect the end-user experience by preventing infrastructure spend
from crowding out source quality, review, and uptime work.

## Required Defaults

- Cloud Run services must scale to zero. Keep `--min-instances=0`.
- Cloud Run CPU must stay request-allocated. Do not use always-allocated CPU
  without an explicit operator decision.
- Cloud Run API deployments must keep the hosted policy defaults unless a user
  outcome justifies the cost: `--cpu=1`, `--memory=768Mi`, `--concurrency=1`,
  and bounded max instances.
- Artifact Registry repositories that receive deploy images must have cleanup
  policies. Atlas keeps the latest rollback images and deletes untagged API
  images after one day.
- Production logs should stay at `info`. Debug logging belongs in local or
  temporary incident windows.
- Discovery spend must be recorded in the cost ledger and checked against the
  per-run ceiling, rolling daily ceiling, and kill switch.

## Deploy Guardrails

Staging and production API deploys run cloud cost preflight before Docker build
and push. The preflight:

- verifies cleanup policy presence;
- blocks Cloud Run min-instance drift;
- blocks always-allocated CPU drift;
- blocks CPU or memory limits above the hosted policy.

Artifact Registry cleanup policies are infrastructure setup, not deploy work.
`pnpm bootstrap` creates the repository and applies the cleanup policy
automatically, once per GCP project. If a provider permission issue interrupts
bootstrap, rerun the cloud infrastructure phase — `pnpm bootstrap --infra` for
production, `pnpm bootstrap --infra --target staging` for staging's separate
project — after authenticating a GCP operator account that can update Artifact
Registry repositories.

The fallback command is:

```bash
# Production
GCP_REGION=us-central1 \
IMAGE_REGISTRY=us-central1-docker.pkg.dev/rap-atlas-prod/atlas-images \
node scripts/deploy/cloud-cost-preflight.mjs apply-cleanup-policy

# Staging (separate GCP project — substitute the actual staging project ID)
GCP_REGION=us-central1 \
IMAGE_REGISTRY=us-central1-docker.pkg.dev/rap-atlas-staging/atlas-images \
node scripts/deploy/cloud-cost-preflight.mjs apply-cleanup-policy
```

Warnings can ship when they are accounting gaps rather than immediate spend
regressions. Blocking failures must be fixed before starting a costly deploy.

## Admin Visibility

Operators review cost posture at `/admin/cloud-costs`.

The page shows:

- discovery spend against daily and per-run ceilings;
- guardrail status for deploy cleanup and scale-to-zero controls;
- Cloud Billing export connection state;
- external fixed-cost accounting state.

The page is operator-only through the same `ATLAS_OPERATOR_ALLOWED_EMAILS`
access model as hosted review queues.

## BigQuery

Use BigQuery for Cloud Billing export when invoice-grade historical GCP spend is
needed. Do not make BigQuery the deploy brake: billing exports lag and are not a
live safety signal. Deploy guardrails should use live GCP configuration and
Monitoring data.

When Cloud Billing export is enabled:

- put it in a dedicated billing dataset;
- use stable views for dashboard queries;
- set query quotas or budgets to prevent accidental scans;
- keep the admin page clear when export data is missing or delayed.

## External Providers

Vercel, Neon, and other provider plans can dominate daily cost even when GCP is
inside free tier. Track fixed external provider costs explicitly. If billing API
access is unavailable, record the gap as unknown rather than reporting `$0`.
