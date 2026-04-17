# Organization And Enterprise SSO

[Docs](../README.md) > [Architecture](./README.md) > Organization And Enterprise SSO

This document explains how Atlas uses Better Auth organizations and Better Auth
SSO together.

## Core Model

Atlas has two workspace modes:

- `individual`
- `team`

The workspace mode is stored in Better Auth organization metadata. Atlas uses
that metadata to progressively enhance the product:

- `team` workspaces see invitations, member management, and enterprise SSO
- `individual` workspaces do not see team controls they cannot use

Atlas also stores a workspace-level `primary` enterprise provider identifier in
organization metadata. This is the provider Atlas prefers first when more than
one verified provider is attached to the same workspace.

## Better Auth Responsibilities

Better Auth is the source of truth for:

- organizations
- memberships and roles
- invitations
- active organization
- SSO providers
- SSO callbacks
- domain verification tokens and verification checks
- organization provisioning after successful enterprise sign-in

Atlas does not reimplement those primitives. Atlas adds a product-specific
contract around them.

## Atlas Responsibilities

Atlas adds:

- workspace type metadata and capability gating
- the organization-management UI
- the enterprise SSO setup UX
- server-side pre-auth provider resolution by email domain and invitation context
- workspace-level primary-provider selection
- docs and operator-facing setup instructions

## Sign-In Resolution Flow

Atlas uses an email-first sign-in screen.

1. The operator enters an email address.
2. Atlas calls `resolveWorkspaceSSOSignIn` on the server.
3. That resolver inspects Better Auth's `organization` and `ssoProvider` data.
4. Atlas picks a provider in this order:
   - verified workspace primary provider
   - verified SAML provider
   - first verified provider
5. If a provider matches, Atlas calls `authClient.signIn.sso(...)`.
6. If no provider matches, Atlas falls back to the existing magic-link path.

Invitation context is handled before generic domain matching. That lets Atlas
route invited users through the intended workspace policy when the invitation's
workspace already has enterprise SSO configured.

## Domain Verification

Atlas enables Better Auth domain verification.

For each provider, Atlas shows the operator:

- the verification host
- the current verification token after registration or refresh
- a verify action

Atlas does not guess customer domains. The operator must enter the workspace
domain explicitly, then publish the TXT record Atlas shows.

## Google Workspace OIDC

For Google Workspace OIDC, Atlas uses:

- issuer: `https://accounts.google.com`
- scopes: `openid email profile`
- Better Auth callback path: `/api/auth/sso/callback`

The operator copies the generated redirect URI from Atlas into Google Cloud,
then pastes the Google client ID and secret back into Atlas.

## Google Workspace SAML

For Google Workspace custom SAML apps, Atlas acts as the SAML service provider.

Atlas generates:

- the ACS URL
- the metadata URL
- the recommended entity ID / audience value
- a suggested provider ID
- a suggested workspace domain derived from the signed-in operator email

The operator copies those values into Google Admin, then pastes the Google SSO
URL, issuer, and certificate back into Atlas.

## Progressive Enhancement Rules

Atlas keeps the UI intentionally quiet when the active workspace is not a team.

Rules:

1. `individual` workspaces never show invitations, member administration, or enterprise SSO
2. the sign-in page remains generic until the submitted email resolves to a verified enterprise provider
3. the shared workspace shell only shows `Organization` when that tab is useful
4. `Account` remains personal and security-focused

Atlas also exposes a focused enterprise setup route for operators who want a
direct link into configuration:

- `/organization/sso`
- `/sign-in?redirect=/organization/sso` for signed-out operators

## Data Storage Notes

Atlas reads Better Auth's internal SQLite tables in one narrow place:

- pre-auth enterprise sign-in resolution

That read-only path exists because Better Auth's provider-management endpoints
require an authenticated session, while Atlas must resolve enterprise sign-in
before the user has one.

All authenticated provider management still goes through Better Auth APIs.
