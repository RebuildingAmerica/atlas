# Google Workspace OIDC SSO

[Docs](../README.md) > [Deployment](./README.md) > Google Workspace OIDC SSO

Use this guide when a customer wants Atlas to trust Google Workspace through
OpenID Connect instead of magic-link-only sign-in.

Atlas does not hardcode customer domains. Atlas suggests a workspace domain
from the signed-in operator email, keeps it editable in the organization
screen, and generates the exact provider ID and callback URL to copy into
Google Cloud.

## What Atlas Uses

- Better Auth `sso()` for enterprise OIDC and SAML providers
- Better Auth `organization()` for workspaces, roles, invitations, and active organization
- Better Auth domain verification so Atlas can prove ownership of the customer email domain before routing sign-in through that provider

## Before You Start

Confirm all of the following:

1. Atlas is deployed with a real public URL and auth is enabled.
2. You can sign in as an owner or admin of the target team workspace.
3. You can create or edit OAuth clients in the customer's Google Cloud project.
4. You can edit DNS for the customer email domain.

## Quick Link

Use the focused setup URL when you want to take an owner or admin directly to
enterprise sign-in configuration:

```text
https://<your-atlas-domain>/organization/sso
```

If the operator is not signed in yet, use:

```text
https://<your-atlas-domain>/sign-in?redirect=/organization/sso
```

## Values Atlas Generates

Open Atlas and go to `Organization` → `Enterprise SSO` → `Google Workspace OIDC`.

Atlas shows these exact values:

- `Google issuer`
- `Requested scopes`
- `Suggested provider ID`
- `Authorized redirect URI`
- `Suggested workspace domain`

The redirect URI pattern is:

```text
https://<your-atlas-domain>/api/auth/sso/callback
```

The issuer is:

```text
https://accounts.google.com
```

The scopes are:

```text
openid email profile
```

Do not guess these values. Copy them from the Atlas workspace you are
configuring.

## Step 1: Create The Google OAuth Client

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select the correct customer project.
3. Go to `APIs & Services` → `Credentials`.
4. Click `Create Credentials` → `OAuth client ID`.
5. Choose `Web application`.
6. Name the client something clear, such as `Atlas OIDC`.
7. Under `Authorized redirect URIs`, paste the `Authorized redirect URI` from Atlas.
8. Save the client.
9. Copy the generated `Client ID`.
10. Copy the generated `Client secret`.

## Step 2: Save The Provider In Atlas

Back in Atlas, fill these fields in the OIDC form:

- `Workspace domain`: Atlas prefills a suggested value from the signed-in operator email; overwrite it if the customer wants a different verified domain
- `Provider ID`: keep the suggested value unless you have a strong reason to change it
- `Client ID`: paste from Google Cloud
- `Client secret`: paste from Google Cloud
- `Set this as the workspace primary provider`: enable this if OIDC should be the default enterprise entrypoint for this workspace

Then click `Save Google Workspace OIDC`.

Atlas will save the provider and create a domain-verification token.

## Step 3: Publish The DNS Verification Record

After the provider is saved, Atlas shows the provider under `Configured providers`.

If the domain is not yet verified:

1. Click `Generate verification token` if Atlas is not already showing one.
2. Copy the `TXT host` from Atlas.
3. Copy the `TXT value` from Atlas.
4. Create a DNS `TXT` record for that host in the customer's DNS zone.

The verification host pattern is:

```text
_better-auth-token-<provider-id>
```

Wait for DNS propagation, then click `Verify domain` in Atlas.

## Step 4: Test Sign-In

Use an email address from the verified customer domain.

1. Open Atlas `Sign in`.
2. Enter the user's work email.
3. Click `Continue with email`.
4. Atlas should redirect to Google instead of sending a magic link.
5. Complete the Google sign-in.
6. Confirm Atlas returns to the requested page and the user lands in the correct workspace.

## Expected Success State

When setup is complete, Atlas should show all of the following:

- the provider under `Configured providers`
- `Domain verified`
- `Primary` if you marked it as primary
- the copied OIDC details still visible for operator reference

## Troubleshooting

### Atlas still sends a magic link

Check:

1. The provider domain in Atlas exactly matches the user's email domain.
2. The provider is linked to the correct workspace.
3. The domain is verified in Atlas.
4. The user is allowlisted, already belongs to a workspace, or has a pending invitation.

### Google rejects the callback

Check that the `Authorized redirect URI` in Google Cloud exactly matches the
value shown in Atlas, including protocol, host, path, and any port used in
non-production environments.

### Domain verification fails

Check:

1. The DNS record type is `TXT`.
2. The host and value exactly match what Atlas shows.
3. The record was added in the correct DNS zone.
4. DNS propagation has completed.

## Related Docs

- [Google Workspace SAML SSO](./google-workspace-saml-sso.md)
- [Production Deployment](./production.md)
