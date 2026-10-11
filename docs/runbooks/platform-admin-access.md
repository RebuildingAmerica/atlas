# Put Cloudflare Access in front of the platform admin

[Docs](../README.md) > [Runbooks](./README.md) > Platform admin Access

This is a how-to for the one-time setup that makes
`atlas-admin.rebuildingus.org` reachable only by Rebuilding America operators
signed in with Google Workspace. The pattern it follows is in
[Internal apps](../standards/internal-apps.md).

Three steps happen in dashboards because no API can do them: the Google OAuth
client, the Google Workspace settings, and the Access identity provider.
Everything else, the Access application and its policy, is made by
`pnpm bootstrap --access-gate`, which also checks it later.

Do the steps in order: each value is pasted before the next is copied.

## Before you start

You need a Google Workspace super admin for `rebuildingus.org`, an owner of the
Cloudflare account that holds `rebuildingus.org`, and these values in
`.env.production`:

| Variable                         | Value                                  |
| -------------------------------- | -------------------------------------- |
| `ATLAS_ADMIN_PUBLIC_URL`         | `https://atlas-admin.rebuildingus.org` |
| `ATLAS_PLATFORM_OPERATOR_EMAILS` | `willie@rebuildingus.org`              |
| `ATLAS_ACCESS_EMAIL_DOMAIN`      | `rebuildingus.org`                     |
| `CLOUDFLARE_ACCOUNT_ID`          | The Rebuilding America account's ID    |

Check the account before anything else. One person can sign in to several
Cloudflare accounts, and `cf auth whoami` may show a different organization's
account first. The Access application must be made in the account whose zone
list includes `rebuildingus.org`.

## 1. Turn on Zero Trust

Open Cloudflare One for the Rebuilding America account. If it asks you to choose
a team name, choose one you will keep: the team domain
`<team>.cloudflareaccess.com` goes into the Google OAuth client next, and
changing it later breaks sign-in until both are updated. Choose the Free plan.

## 2. Make the Google OAuth client

In Google Cloud, use a project inside the `rebuildingus.org` organization.

1. Google Auth Platform → Get started. App name "Rebuilding America internal",
   user support email a shared Rebuilding America address, not a person's.
2. Audience: **Internal**. Internal needs no Google verification and refuses
   personal Gmail accounts. Every Google sign-in in this project is for an
   `@rebuildingus.org` account.
3. Clients → Create client → Web application, name "Cloudflare Access":
   - Authorized JavaScript origins: `https://<team>.cloudflareaccess.com`
   - Authorized redirect URIs:
     `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. Leave the dialog with the client ID and secret open.

Skip service account keys and domain-wide delegation. Nothing uses them.

## 3. Require 2-step verification in Google Workspace

In the Google Admin console, Security → Authentication → 2-step verification:
allow users to turn it on and set enforcement to On, preferably with passkeys or
security keys. This is where multi-factor sign-in is enforced. Do not add a
Cloudflare "Authentication method" rule: Google does not reliably send the claim
it checks, and it can lock everyone out.

## 4. Add Google Workspace as the Access identity provider

Cloudflare One → Integrations → **Identity providers**. Not "Cloud & SaaS" just
above it, which is a different feature that asks for a service account.

1. Add new identity provider → Google Workspace. Name "Google Workspace".
2. Paste the client ID, then the client secret, from step 2.
3. Google Workspace domain: `rebuildingus.org`.
4. Proof Key for Code Exchange: On. Turn it off only if Test fails with a
   code-verifier error.
5. SCIM and deprovisioning: Off. Email claim and OIDC claims: leave empty.
6. Save, then Test. It should show your `@rebuildingus.org` address.

Atlas admits operators by exact email, so it needs no Google group and no Admin
SDK access.

## 5. Make the Access application

Create a Cloudflare API token for this run with the permissions bootstrap
prints: Access: Apps and Policies → Edit, and Access: Organizations, Identity
Providers, and Groups → Read, scoped to the Rebuilding America account, expiring
tomorrow. Then run:

```bash
pnpm bootstrap --access-gate
```

It reports what exists, then creates or repairs the reusable policy "Atlas
platform admin allow" and the self-hosted application "Atlas platform admin":
the whole `atlas-admin.rebuildingus.org` host, Google Workspace only, sent
straight to Google, an 8 hour session, binding, HTTP-only and SameSite=Lax
cookies, no App Launcher tile. The policy admits each address in
`ATLAS_PLATFORM_OPERATOR_EMAILS` and requires an `@rebuildingus.org` address.

It saves `ATLAS_ACCESS_TEAM_DOMAIN` and `ATLAS_ACCESS_AUD` to `.env.production`.
Neither is secret: the audience tag is inside every Access token. The admin app
refuses to start without both.

To check the live setup later without changing anything:

```bash
pnpm bootstrap --access-gate --doctor
```

## 6. Make the admin's signing key

The admin app proves itself to the API with an Ed25519 key. Make one per
environment:

```bash
pnpm bootstrap --admin-keys --target staging
```

```bash
pnpm bootstrap --admin-keys --target prod
```

Each run stores the private key as the GitHub Environment secret
`ATLAS_ADMIN_SIGNING_KEY` (handed to `gh` on stdin, never written down) and the
public key as the Environment variable `ATLAS_ADMIN_SIGNING_PUBLIC_KEY`, which
the API deploy trusts for platform actions only. Running it again rotates the
key: redeploy the API, then the admin, so the API trusts the new key before the
admin signs with it.

## 7. Set the deploy values and deploy

In each GitHub Environment (`staging`, `production`), set these. The Access
values and operator list are the ones the earlier steps produced.

| Kind     | Name                             | Value                                                |
| -------- | -------------------------------- | ---------------------------------------------------- |
| Variable | `ATLAS_ADMIN_PUBLIC_URL`         | `https://atlas-admin.rebuildingus.org`               |
| Variable | `ATLAS_PLATFORM_API_URL`         | The API origin the admin calls                       |
| Variable | `ATLAS_ACCESS_TEAM_DOMAIN`       | From step 5                                          |
| Variable | `ATLAS_ACCESS_AUD`               | From step 5                                          |
| Variable | `ATLAS_PLATFORM_OPERATOR_EMAILS` | `willie@rebuildingus.org`                            |
| Variable | `CLOUDFLARE_ACCOUNT_ID`          | The Rebuilding America account's ID                  |
| Secret   | `CLOUDFLARE_ADMIN_DEPLOY_TOKEN`  | Workers Scripts Edit + Workers Routes Edit, one zone |
| Secret   | `ATLAS_ADMIN_SIGNING_KEY`        | Set by step 6                                        |
| Variable | `ATLAS_ADMIN_SIGNING_PUBLIC_KEY` | Set by step 6                                        |

Set `ATLAS_ADMIN_PUBLIC_URL` in the Atlas app's Vercel project too: the app
links new discount requests there and redirects its old `/admin/discounts` and
`/admin/cloud-costs` pages there. Production sets it on each deploy; staging
reads it from the Vercel project's environment.

The next deploy then ships the API with the admin's key and Access settings, and
`deploy-admin` builds the Worker and publishes it to
`atlas-admin.rebuildingus.org` with `cf deploy`. The job reports an unconfigured
admin and skips its deployment steps in any environment without
`ATLAS_ADMIN_PUBLIC_URL`. Its condition runs inside the job, after GitHub makes
Environment variables available.

Check it from a laptop:

- `https://atlas-admin.rebuildingus.org` sends you to Google, then shows the
  admin.
- A request without the Access cookie, or with a made-up
  `Cf-Access-Jwt-Assertion` header, gets 403 from the Worker itself.
- There is no `atlas-admin.<subdomain>.workers.dev` address.
- `https://atlas.rebuildingus.org/admin/discounts` redirects to the admin.

## Removing someone

Remove their address from `ATLAS_PLATFORM_OPERATOR_EMAILS`, run
`pnpm bootstrap --access-gate`, and redeploy the API and the admin so both of
their own allowlists drop them too. Access re-checks people only when they sign
in, so also revoke their current session: Cloudflare One → Team & Resources →
Users → the person → Revoke session. Without that, they keep access until their
8 hour session ends.

## When Google sign-in is unavailable

The admin app is never on the recovery path. Rollback, billing repair and logs
stay GitHub workflow dispatches, the database stays reachable from the Neon
console, and a deploy can be made from a laptop with `cf auth login` and
`cf deploy`. None of these open the gate, and nothing here weakens it. Do not
add a second identity provider such as one-time PIN as a back door: the doctor
check reports an application that accepts more than Google Workspace as a
mismatch.
