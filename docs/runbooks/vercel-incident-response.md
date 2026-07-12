# Vercel Incident Response Runbook

## Rollback a Bad Deployment

**Via Vercel dashboard (fastest):**

1. Go to vercel.com → Atlas project → Deployments tab
2. Find the last known-good deployment
3. Click `⋯` → Promote to Production
4. Verify at `https://atlas.rebuildingus.org/health` (expect HTTP 200)

**Via git revert:**

```bash
git revert HEAD
git push origin main
```

Pushing to `main` exercises staging. Production changes ship only from `v*`
release tags through `.github/workflows/deploy.yml`.

## Check Deployment Status

| Resource               | URL                                       |
| ---------------------- | ----------------------------------------- |
| Vercel dashboard       | vercel.com → Atlas project                |
| Frontend health        | https://atlas.rebuildingus.org            |
| API health             | https://atlas.rebuildingus.org/api/health |
| Staging frontend       | https://atlas-staging.rebuildingus.org    |
| Vercel platform status | https://vercel-status.com                 |
| GCP Cloud Run status   | https://status.cloud.google.com           |

## Diagnose a Broken Deployment

1. Check Vercel deployment logs: Vercel dashboard → Deployments → click failing
   deployment → Logs
2. Check function logs: Vercel dashboard → Logs tab (requires Observability Plus
   on Pro plan)
3. Check API separately: `curl https://atlas.rebuildingus.org/api/health`
   - If API is down, the issue is in GCP Cloud Run, not Vercel
   - If API is up but app is broken, the issue is in the Vercel deployment

## Deployment Model

- `main` is the continuous staging lane.
- Vercel's `staging` custom environment serves the staging app.
- `.github/workflows/deploy-staging.yml` deploys `atlas-api-staging` on `main`.
- Production ships from `v*` tags through `.github/workflows/deploy.yml`.
- GitHub Actions uses Vercel Trusted Sources for protected smoke checks.
- The Vercel CLI production deploy still requires `VERCEL_TOKEN`.
- Production domain auto-assignment is off; the release workflow promotes the
  tagged Vercel deployment explicitly.

The Vercel project keeps an Ignored Build Step that skips production Git builds
from `main`:

```bash
if [ "$VERCEL_ENV" = "production" ] && [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi
```

## Emergency: Pause the App

Project Settings → General → scroll to "Danger Zone" → Pause Project

This prevents all new requests to the Vercel deployment.

## Escalation

1. Check Vercel status page for platform-wide incidents
2. Check GCP Cloud Run status for API-layer issues
3. For database issues: check Neon PostgreSQL dashboard (console.neon.tech)
4. Contact: [fill in on-call rotation / owner contact]

## Post-Incident

After resolving an incident:

1. Write a brief incident summary (what broke, root cause, fix, time to
   resolution)
2. Open an issue at github.com/RebuildingAmerica/atlas with label `incident`
3. Update this runbook with any new diagnostic steps discovered
