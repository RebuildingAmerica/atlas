# Callback and Edge Origin Secret Rotation Runbook

Atlas's app, API, and Cloudflare edge trust each other through two shared
secrets. Rotate one when it may have leaked, or when someone who held it should
no longer hold it. Done carelessly, a rotation locks people out of their
workspaces or makes anonymous visitors hit rate limits that are not theirs. This
runbook keeps that disruption to a few minutes and tells you what people see
while it lasts.

## What each secret does

| Secret                       | Held by                                                                     | Sent as                                                              | When holders disagree                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLAS_AUTH_CALLBACK_SECRET` | The app (Vercel) and the API (Cloud Run)                                    | `X-Atlas-Callback-Secret`, from the API to the app                   | The app refuses the API's membership checks and API-key introspection. Requests that act inside a workspace fail, and every Atlas API key looks invalid. Public browsing keeps working.                                                        |
| `ATLAS_EDGE_ORIGIN_SECRET`   | The Cloudflare rule on the API domain, the app server (Vercel), and the API | `X-Atlas-Proxy-Secret`, from Cloudflare and the app proxy to the API | The API stops believing the visitor IP address it is given and counts requests against the proxy's own address instead. Many visitors then share one rate-limit bucket, so anonymous visitors and API clients can get `429 Too Many Requests`. |

The values live in four places, and a rotation has to reach every one:

1. `.env.production` and `.env.staging`, which bootstrap writes and reads.
2. The GitHub `production` and `staging` Environment secrets, which the deploy
   workflows read.
3. The running services. Each Cloud Run revision and each production Vercel
   deployment keeps the values it was deployed with. The staging app reads its
   values from the Vercel project's environment variables when Vercel builds it.
4. For the edge origin secret only, the Cloudflare transform rule named
   `Atlas API origin identity headers`, which `pnpm bootstrap --api-edge`
   installs.

On the hosted setup the app reaches the API through the Cloudflare-proxied API
domain, and that Cloudflare rule overwrites `X-Atlas-Proxy-Secret` and
`X-Atlas-Client-IP` on every request to the domain. For live hosted traffic, the
edge origin secret has to match between Cloudflare and the API. The app's copy
matters wherever the app reaches the API directly, as in Docker Compose.

## Each service accepts only one value

The app and the API each compare against exactly one configured value. Neither
accepts an old and a new value side by side, so there is no overlap period.
Every rotation has a short window between the moment the first holder switches
and the moment the last one does, and the holders disagree during it. The steps
below keep that window to part of one deploy. Pick a quiet time to run them.

## Generate and record a new value

Bootstrap generates these secrets as 32 random bytes, hex encoded. Generate the
replacement the same way, straight into the env file, so it never appears in
your terminal or shell history. For the callback secret in production:

```bash
grep -q '^ATLAS_AUTH_CALLBACK_SECRET=' .env.production \
  || printf '\nATLAS_AUTH_CALLBACK_SECRET=\n' >> .env.production
new_value="$(openssl rand -hex 32)"
sed -i.bak "s/^ATLAS_AUTH_CALLBACK_SECRET=.*/ATLAS_AUTH_CALLBACK_SECRET=${new_value}/" .env.production
rm .env.production.bak
unset new_value
```

Replace the key and file name as needed. The first command adds the key when an
older env file never had it; bootstrap writes env files without a final newline,
which is why it prints one first. Then copy the value from the env file into the
matching GitHub Environment without printing it:

```bash
grep -E '^ATLAS_AUTH_CALLBACK_SECRET=' .env.production | cut -d= -f2- \
  | gh secret set ATLAS_AUTH_CALLBACK_SECRET --env production --repo RebuildingAmerica/atlas
```

Update the env file first. `pnpm bootstrap --infra` uploads secrets from the env
files, so a value changed only in GitHub is overwritten with the old one the
next time it runs.

## Rotate `ATLAS_AUTH_CALLBACK_SECRET`

Staging and production can hold different callback secrets. Rotate each
separately.

### Production

1. Generate a new value into `.env.production` and upload it to the GitHub
   `production` Environment, as above.
2. Run **Deploy Production** from the Actions tab on the current release tag.
   Manual runs must select a `v*` tag; re-running the tag that is already live
   redeploys the same code with the new secret. Pushing a new release tag works
   too.
3. The workflow deploys the API first and promotes the Vercel app a few minutes
   later. Between those two moments, workspace pages and API-key requests fail.
   Either order would leave a window. What matters is that both services switch
   in the same run.

### Staging

1. Generate a new value into `.env.staging` and upload it to the GitHub
   `staging` Environment.
2. In the Vercel dashboard, open the `atlas` project's **Settings > Environment
   Variables** and set `ATLAS_AUTH_CALLBACK_SECRET` to the new value for the
   environment that serves `atlas-staging.rebuildingus.org`.
3. Run **Deploy Staging** from the Actions tab. When its `deploy-api` job
   finishes, redeploy the latest staging deployment in Vercel (**Deployments >
   ⋯ > Redeploy**) so the app picks up the new value.
4. The workflow's hosted smoke job can run before the Vercel redeploy finishes.
   If it fails on membership or API keys, re-run it once the app is redeployed.

### Verify

Check that the app holds the new value. This posts to the app's private
introspection route with the new secret and no API key. The secret goes only
into the request header, read from the env file:

```bash
grep -E '^ATLAS_AUTH_CALLBACK_SECRET=' .env.production \
  | sed 's/^ATLAS_AUTH_CALLBACK_SECRET=/X-Atlas-Callback-Secret: /' \
  | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H @- \
      https://atlas.rebuildingus.org/api/auth/internal/api-key
```

For staging, read `.env.staging` and post to
`https://atlas-staging.rebuildingus.org` instead. `400` means the app accepted
the secret and is asking for the missing key. `401` means the app still holds a
different value. Vercel deployment protection can answer staging requests before
the app does. If it does, add the `x-vercel-protection-bypass` header with the
staging bypass secret.

Check that the API holds the same value by comparing fingerprints. Neither
command prints the secret:

```bash
gcloud run services describe atlas-api --region us-central1 --project <GCP_PROJECT_ID> --format=json \
  | jq -r '.spec.template.spec.containers[0].env[] | select(.name == "ATLAS_AUTH_CALLBACK_SECRET") | .value' \
  | shasum -a 256
grep -E '^ATLAS_AUTH_CALLBACK_SECRET=' .env.production | cut -d= -f2- | shasum -a 256
```

Use `atlas-api-staging` and the staging project for staging. The two
fingerprints must match.

Then check what people actually use. Sign in and open a workspace page, which
makes the API check membership with the app. Make one request with an Atlas API
key, which makes the API introspect the key with the app. Both must succeed. A
rise in `invalid_credential_attempt` log events with `credential_kind: api_key`
after the deploy means the services still disagree.

## Rotate `ATLAS_EDGE_ORIGIN_SECRET`

`pnpm bootstrap --api-edge` reads this secret from `.env.production`, then
`.env`, then `api/.env`. It does not read `.env.staging`, even with
`--target staging`, so the staging Cloudflare rule always gets the production
value. Until that changes, staging and production must share one edge origin
secret. Rotate both together.

1. Generate one new value into `.env.production`, then copy the same line into
   `.env.staging`.
2. Upload it to both the GitHub `production` and `staging` Environments.
3. Set it in the Vercel environment that serves
   `atlas-staging.rebuildingus.org`, as for the callback secret.
4. Run **Deploy Production** on the current release tag and watch the `deploy`
   job. As soon as its `Deploy atlas-api` step finishes, run:

   ```bash
   pnpm bootstrap --api-edge
   ```

   From the moment the new API revision takes traffic until Cloudflare's rule
   updates, the two disagree. Anonymous visitors and API clients can see `429`
   responses while that lasts. Updating the API first keeps the window to the
   minute bootstrap takes. Updating Cloudflare first would stretch it across the
   whole image build.

5. Run **Deploy Staging**. When its `deploy-api` job finishes, run
   `pnpm bootstrap --api-edge --target staging`, then redeploy the latest
   staging deployment in Vercel.

### Verify

Run `pnpm bootstrap --api-edge` and `pnpm bootstrap --api-edge --target staging`
again. Each should report that the Cloudflare origin identity transform rules
are already current. Compare the API's fingerprint with the env file the same
way as for the callback secret, using `ATLAS_EDGE_ORIGIN_SECRET`. A successful
**Deploy Production** run gives the Vercel app the value from the same GitHub
secret, and the workflow's hosted smoke job exercises the edge path. Watch
`anonymous_rate_limited` log events for the next hour. A burst concentrated on a
few `client_key_hash` values means visitors are sharing buckets again, so the
holders still disagree.

## Local development and Docker Compose

For local development, put a new value in both `api/.env` and `app/.env.local`,
plus the root `.env` if you use Compose, then restart `pnpm dev`. The app and
the API only need to agree with each other.

For a self-hosted Compose deployment, change the value in the env file you pass
to Compose and recreate both services together with
`docker compose --env-file .env.production up -d`. The window is the few seconds
the containers take to restart.

## If a rotation stops halfway

If a deploy fails after the API switched but before the app did, the services
disagree until you fix it. The quickest fix is to finish the rotation: re-run
the failed workflow or step. If you cannot, put the old value back in the env
file and the GitHub secret and re-run the deploy.

**Roll Back Production** moves the API to an older revision and re-promotes an
older Vercel deployment. Each keeps the values it was deployed with, so when
both come from before the rotation they agree on the old callback secret. The
Cloudflare rule keeps whatever `pnpm bootstrap --api-edge` last installed. After
rolling back across an edge origin rotation, restore the old value in
`.env.production` and run `pnpm bootstrap --api-edge` again.

## Not covered: `ATLAS_AUTH_INTERNAL_SECRET`

Do not rotate `ATLAS_AUTH_INTERNAL_SECRET` with these steps. The app also uses
it as Better Auth's signing secret, so changing it ends every session and can
affect data Better Auth encrypted with it, such as stored signing keys. It needs
its own plan.
