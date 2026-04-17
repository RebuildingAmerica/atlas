# Google Workspace SAML SSO

[Docs](../README.md) > [Deployment](./README.md) > Google Workspace SAML SSO

Use this guide when a customer wants Atlas configured as a custom SAML 2.0
service provider inside Google Workspace.

Atlas does not ship with tenant-specific SAML values. Every workspace shows the
exact ACS URL, metadata URL, entity ID, suggested provider ID, and a visible
workspace-domain suggestion derived from the signed-in operator email.

## Before You Start

Confirm all of the following:

1. Atlas is deployed with a real public URL and auth is enabled.
2. You can sign in as an owner or admin of the target team workspace.
3. You can create or edit custom SAML apps in the customer's Google Admin console.
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

Open Atlas and go to `Organization` → `Enterprise SSO` → `SAML 2.0`.

Atlas shows these exact values:

- `Suggested provider ID`
- `ACS URL`
- `SP metadata URL`
- `Entity ID / audience`
- `Suggested workspace domain`

The generated URLs follow these patterns:

```text
ACS URL:
https://<your-atlas-domain>/api/auth/sso/saml2/sp/acs/<provider-id>

SP metadata URL:
https://<your-atlas-domain>/api/auth/sso/saml2/sp/metadata?providerId=<provider-id>&format=xml
```

Atlas uses the metadata URL as the SAML entity ID recommendation it shows in
the UI. Copy the value from Atlas instead of reconstructing it manually.

## Step 1: Create The Custom SAML App In Google Admin

1. Open [Google Admin Console](https://admin.google.com/).
2. Go to `Apps` → `Web and mobile apps`.
3. Click `Add app` → `Add custom SAML app`.
4. Name the app something clear, such as `Atlas`.
5. On the Google IdP information screen, copy these Google values:
   - `SSO URL`
   - `Entity ID`
   - `Certificate`

## Step 2: Configure Atlas With The Google IdP Details

In Atlas, fill these fields in the SAML form:

- `Workspace domain`: Atlas prefills a suggested value from the signed-in operator email; overwrite it if the customer wants a different verified domain
- `Provider ID`: keep the suggested value unless you have a strong reason to change it
- `Identity provider issuer`: paste Google `Entity ID`
- `Identity provider sign-in URL`: paste Google `SSO URL`
- `X.509 certificate`: paste the Google certificate
- `Set this as the workspace primary provider`: enable this if SAML should be the default enterprise entrypoint for this workspace

Do not click save yet if you still need the Atlas service-provider values for
Google's next screen.

## Step 3: Configure Google With The Atlas Service-Provider Details

Back in Google Admin, on the service-provider details screen, use the values
from Atlas:

- `ACS URL`: paste Atlas `ACS URL`
- `Entity ID`: paste Atlas `Entity ID / audience`
- `Start URL`: optional; if you use one, point it to the Atlas sign-in page
- `Name ID format`: `EMAIL`
- `Name ID`: `Basic Information` → `Primary email`

## Step 4: Map Attributes

Use Google attribute mappings that preserve email identity cleanly.

Recommended minimum mapping:

- `Primary email` → `email`

Recommended additional mappings:

- `First name` → `givenName`
- `Last name` → `surname`
- `Full name` → `displayName`

Atlas can work with only email identity, but these extra mappings produce a
cleaner user profile after provisioning.

## Step 5: Save The Provider In Atlas

Click `Save SAML provider` in Atlas.

Atlas will save the SAML provider and create a domain-verification token.

## Step 6: Publish The DNS Verification Record

After the provider is saved, open the provider card in `Configured providers`.

If the domain is not yet verified:

1. Click `Generate verification token` if Atlas is not already showing one.
2. Copy the `TXT host` from Atlas.
3. Copy the `TXT value` from Atlas.
4. Create a DNS `TXT` record for that host in the customer's DNS zone.
5. Wait for propagation.
6. Click `Verify domain` in Atlas.

The verification host pattern is:

```text
_better-auth-token-<provider-id>
```

## Step 7: Test SAML Sign-In

Use an email address from the verified customer domain.

1. Open Atlas `Sign in`.
2. Enter the user's work email.
3. Click `Continue with email`.
4. Atlas should route the browser to the Google Workspace SAML app instead of sending a magic link.
5. Complete the Google flow.
6. Confirm Atlas returns to the requested page and the user lands in the correct workspace.

## Expected Success State

When setup is complete, Atlas should show all of the following:

- the provider under `Configured providers`
- `Domain verified`
- `Primary` if you marked it as primary
- copied SAML service-provider values still visible for operator reference

## Troubleshooting

### Google says the ACS URL or entity ID is invalid

Check that the values in Google Admin exactly match the values shown in Atlas.
Do not replace the provider ID or remove the `format=xml` query parameter from
the metadata URL when Atlas shows it.

### Atlas still sends a magic link

Check:

1. The provider domain in Atlas exactly matches the user's email domain.
2. The provider is linked to the correct workspace.
3. The domain is verified in Atlas.
4. The user is allowlisted, already belongs to a workspace, or has a pending invitation.

### SAML authentication reaches Atlas but the user is not added to the workspace

Check that the provider is linked to the correct Atlas workspace and that the
workspace is using team features. Atlas relies on Better Auth organization
provisioning to add successful enterprise sign-ins to the linked workspace.

## Related Docs

- [Google Workspace OIDC SSO](./google-workspace-oidc-sso.md)
- [Production Deployment](./production.md)
