# Google Workspace SAML SSO

[Docs](../README.md) > [Deployment](./README.md) > Google Workspace SAML SSO

Use this guide when a customer wants Atlas configured as a custom SAML 2.0
service provider inside Google Workspace, Okta, Microsoft Entra, or any other
enterprise IdP that supports SAML.

Atlas does not ship with tenant-specific SAML values. Every workspace shows
the exact ACS URL, metadata URL, entity ID, suggested provider ID, and a
suggested workspace domain derived from the signed-in operator email.

## Before You Start

Confirm all of the following:

1. Atlas is deployed with a real public URL and auth is enabled.
2. You can sign in as an owner or admin of the target team workspace.
3. You can create or edit custom SAML apps in the customer's IdP admin
   console.
4. You can edit DNS for the customer email domain.
5. The IdP's issuer host appears in `ATLAS_SAML_ALLOWED_ISSUERS` on the
   Atlas deployment. Atlas rejects every SAML registration whose issuer
   origin is missing from that allowlist; see
   [Step 1 — Operator preflight](#step-1--operator-preflight).

## Quick Link

Use the focused setup URL when you want to take an owner or admin directly
to enterprise sign-in configuration:

```text
https://<your-atlas-domain>/organization/sso
```

If the operator is not signed in yet, use:

```text
https://<your-atlas-domain>/sign-in?redirect=/organization/sso
```

## Values Atlas Generates

Open Atlas and go to `Organization` → `Enterprise SSO` → `SAML 2.0`. Atlas
shows these exact values:

- `Suggested provider ID`
- `ACS URL`
- `SP metadata URL` (with a one-click `Download SP metadata XML` link)
- `Entity ID / audience`
- `Suggested workspace domain`

The generated URLs follow these patterns:

```text
ACS URL:
https://<your-atlas-domain>/api/auth/sso/saml2/sp/acs/<provider-id>

SP metadata URL:
https://<your-atlas-domain>/api/auth/sso/saml2/sp/metadata?providerId=<provider-id>&format=xml
```

Atlas uses the metadata URL as its SAML entity ID recommendation. Copy the
value from Atlas instead of reconstructing it manually.

## Step 1 — Operator preflight

Before walking the workspace admin through the form, confirm the
deployment is ready to accept the IdP they plan to use.

- `ATLAS_SAML_ALLOWED_ISSUERS` must contain the IdP's issuer host. Atlas
  matches by URL origin, so per-tenant query parameters (e.g.
  `?idpid=...`) need not be enumerated. Example value:
  `https://accounts.google.com,https://login.microsoftonline.com`.
- `ATLAS_SAML_SP_PRIVATE_KEY` is optional. When set, every new SAML
  registration flips `authnRequestsSigned: true` and Atlas signs
  AuthnRequests with the configured SP key. Without it, AuthnRequests
  ship unsigned and the provider list shows an `Unsigned AuthnRequests`
  badge.

The Atlas SAML form surfaces the allowlist inline. If the admin pastes an
issuer whose origin is not allowed, the field shows a red helper text
listing the accepted hosts and the `Save SAML provider` button stays
disabled. If the deployment-wide allowlist is empty, the form tells the
admin to contact Atlas operators before continuing.

## Step 2 — Configure the IdP

1. Open the IdP admin console (e.g.
   [Google Admin Console](https://admin.google.com/) →
   `Apps` → `Web and mobile apps` → `Add custom SAML app`).
2. Name the app something clear, such as `Atlas`.
3. On the IdP information screen, copy the IdP's `SSO URL`, `Entity ID`,
   and signing `Certificate`. The IdP usually offers these as a downloadable
   metadata XML — keep that file handy; you can paste it directly into
   Atlas in Step 3.
4. On the IdP service-provider details screen, paste these values from
   Atlas:
   - `ACS URL`: paste Atlas `ACS URL`.
   - `Entity ID`: paste Atlas `Entity ID / audience`.
   - `Start URL`: optional; if you use one, point it to the Atlas sign-in
     page.
   - `Name ID format`: `EMAIL`.
   - `Name ID`: `Basic Information` → `Primary email` (or the equivalent
     in your IdP).
5. Many IdPs accept an SP metadata XML upload. If yours does, click
   `Download SP metadata XML` next to Atlas's SP metadata URL once the
   provider is saved (after Step 3) and upload that file instead of
   pasting individual values.

Atlas attribute mapping is intentionally minimal:

- Required: `Primary email` → `email`.
- Recommended: `First name` → `givenName`, `Last name` → `surname`,
  `Full name` → `displayName`. These produce a cleaner provisioned
  profile but are not load-bearing.

## Step 3 — Save the provider in Atlas

Two paths. Pick whichever the IdP supports.

### Recommended path: paste IdP metadata XML

1. In Atlas, expand `Paste IdP metadata XML to prefill issuer, sign-in URL,
   and certificate`.
2. Paste the IdP's metadata document. Atlas extracts:
   - the `entityID` attribute → fills `Identity provider issuer`,
   - the `SingleSignOnService` Location (preferring HTTP-Redirect over
     HTTP-POST) → fills `Identity provider sign-in URL`,
   - the signing `X509Certificate` → fills `X.509 certificate` as PEM.
3. Atlas reports which fields were filled and asks you to review them
   before saving.

### Manual fallback

If the IdP does not export a metadata document:

- `Workspace domain`: Atlas prefills from the signed-in operator email;
  override if the customer wants a different verified domain.
- `Identity provider issuer`: paste the IdP's entity ID.
- `Identity provider sign-in URL`: paste the IdP's SSO URL.
- `X.509 certificate`: paste the IdP's signing certificate. Atlas checks
  for `-----BEGIN CERTIFICATE-----` framing and a base64 body before
  enabling Save; the full ASN.1 parse runs server-side after submit.
- `Provider ID` is hidden under an `Advanced` disclosure. Keep the
  suggested value; collisions across providers cause registration to
  fail.

Click `Save SAML provider`. Atlas will register the provider through
Better Auth and create a domain-verification token.

## Step 4 — Domain verification

Atlas resolves the TXT record itself — `verifyDomain` performs a real
`dns.resolveTxt` lookup and only flips `domainVerified=true` when the
record matches the issued token.

1. After save, Atlas shows the provider under `Configured providers` with
   `Verification pending`.
2. Click `Generate verification token` if Atlas is not already showing one.
3. Copy `TXT host` and `TXT value` from Atlas.
4. Create a `TXT` record at that host in the customer's DNS zone.

The verification host pattern is:

```text
_better-auth-token-<provider-id>.<workspace-domain>
```

Once the record is published, two things can happen:

- **Auto-poll.** Atlas polls DNS silently every 30 seconds for up to ten
  minutes after registration. The card flips to `Domain verified` as soon
  as the resolver sees the record. No toast fires for each attempt.
- **Manual.** Click `Verify domain` to force an immediate lookup.

## Step 5 — Mark the provider as primary

Marking a provider as primary makes it the default enterprise entrypoint
for that workspace. Atlas no longer surfaces a "Set as primary" checkbox
on the registration form; use the per-provider `Make primary` button on
the provider list instead. Re-clicking the button on a different provider
moves the marker; clicking it on the current primary clears it.

## Step 6 — Test sign-in

Use an email address from the verified customer domain.

1. Open Atlas `Sign in`.
2. Enter the user's work email.
3. Click `Continue with email`.
4. Atlas should route the browser to the IdP's SAML app instead of
   sending a magic link.
5. Complete the IdP flow.
6. Confirm Atlas returns to the requested page and the user lands in the
   correct workspace.

## Expected success state

When setup is complete, Atlas should show all of the following on the
provider card:

- the provider under `Configured providers`
- `Domain verified`
- `Primary` if you used `Make primary`
- `Signed AuthnRequests` if `ATLAS_SAML_SP_PRIVATE_KEY` is configured
- `Certificate expires <date> (in N days)`
- the SAML SP values still visible for operator reference

## Maintenance

### Rotating the signing certificate

When the IdP rotates its signing key, you do not need to delete and
re-register the provider — that would wipe the verified domain and the
primary marker.

1. Open the provider card.
2. Expand `Rotate signing certificate`.
3. Paste the new PEM-encoded X.509 certificate.
4. Click `Replace certificate`.

Atlas pushes the new certificate through Better Auth's
`updateSSOProvider` endpoint as a partial `samlConfig` patch. The
verified domain, primary-provider marker, and SP signing key all stay
in place.

### Running a health check

Each saved SAML provider exposes a `Run SAML health check` disclosure
that does not start a real SAML AuthnRequest. The check:

- pings the IdP entry point and reports the HTTP status,
- inspects the stored signing certificate's expiry,
- reports any error encountered while reaching the IdP.

Use this as a smoke test before telling end users to sign in. A full
SAML round-trip still requires a real browser flow — covered in
[Step 6 — Test sign-in](#step-6--test-sign-in).

### Reading the badges

The provider card shows three status badges next to the provider name:

- `Domain verified` / `Verification pending` — DNS-TXT verification
  status. Pending means Atlas is auto-polling DNS for the record.
- `Signed AuthnRequests` / `Unsigned AuthnRequests` — whether Atlas is
  signing outbound SAML AuthnRequests with the configured SP key.
  Controlled by `ATLAS_SAML_SP_PRIVATE_KEY` at deploy time and recorded
  per provider at registration.
- `Primary` — only present when the provider is the workspace primary.

The card also surfaces `Certificate expires <date> (in N days)` once
Better Auth has parsed the certificate.

## Troubleshooting

### `Save SAML provider` is disabled

The button stays disabled until every required field is filled, the
issuer host is on the allowlist, and the pasted certificate has PEM
framing. The inline helper texts on the issuer and certificate fields
say which check is failing.

### IdP says the ACS URL or entity ID is invalid

Check that the values in the IdP exactly match the values shown in
Atlas. Do not replace the provider ID or remove the `format=xml` query
parameter from the metadata URL when Atlas shows it.

### Atlas still sends a magic link

Check:

1. The provider domain in Atlas exactly matches the user's email domain.
2. The provider is linked to the correct workspace.
3. The domain is verified in Atlas.
4. The user is allowlisted, already belongs to a workspace, or has a
   pending invitation.

### Domain verification stalls

The DNS lookup happens at verify time. If the record does not propagate
within the auto-poll window:

1. Confirm the record type is `TXT`, the host exactly matches Atlas's
   `TXT host`, and the value matches Atlas's `TXT value`.
2. Confirm the record is published in the DNS zone for the workspace
   domain Atlas is verifying.
3. Click `Verify domain` after every fix to force an immediate lookup.

### Health check reports `unreachable`

The IdP entry point is offline or blocked from Atlas. Check that the
URL stored under `IdP entry point` is correct and reachable from your
deployment's egress.

### SAML authentication reaches Atlas but the user is not added to the workspace

Check that the provider is linked to the correct Atlas workspace and
that the workspace is using team features. Atlas relies on Better Auth
organization provisioning to add successful enterprise sign-ins to the
linked workspace.

## Related Docs

- [Google Workspace OIDC SSO](./google-workspace-oidc-sso.md)
- [Production Deployment](./production.md)
