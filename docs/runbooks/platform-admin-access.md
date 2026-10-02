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

## Removing someone

Remove their address from `ATLAS_PLATFORM_OPERATOR_EMAILS`, run
`pnpm bootstrap --access-gate`, and redeploy the admin app so its own allowlist
drops them too. Access re-checks people only when they sign in, so also revoke
their current session: Cloudflare One → Team & Resources → Users → the person →
Revoke session. Without that, they keep access until their 8 hour session ends.

## When Google sign-in is unavailable

The admin app is never on the recovery path. Rollback, billing repair and logs
stay GitHub workflow dispatches, the database stays reachable from the Neon
console, and a deploy can be made from a laptop with `cf auth login` and
`cf deploy`. None of these open the gate, and nothing here weakens it. Do not
add a second identity provider such as one-time PIN as a back door: the doctor
check reports an application that accepts more than Google Workspace as a
mismatch.
