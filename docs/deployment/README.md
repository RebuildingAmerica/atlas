# Deployment

[Docs](../README.md) > Deployment

Deployment docs explain how Atlas gets shipped and how to verify it is healthy
afterward.

## Deployment Docs

- [Production Deployment](./production.md) — Environment setup, hosting paths,
  and production verification
- [Staging Deployment](./staging.md) — Automatic staging deploys, required
  environment secrets, and staging verification
- [Atlas-managed ATProto PDS](./atproto-pds.md) — Persistent-host, recovery,
  deployment, and live-verification contract for managed identities
- [Stripe Billing Setup](./stripe-billing.md) — Product catalog, discounts,
  webhook setup, and local/staging/production billing bootstrap
- [Email Domain Setup](./email-domain-setup.md) — Operator runbook for Resend
  DNS, sender-domain verification, and Atlas email configuration
- [Google Workspace OIDC SSO](./google-workspace-oidc-sso.md) — Copy-paste setup
  guide for Google Cloud OAuth clients and Atlas enterprise OIDC
- [Google Workspace SAML SSO](./google-workspace-saml-sso.md) — Copy-paste setup
  guide for Google Admin custom SAML apps and Atlas service-provider values
- [Release Process](./release.md) — Release-readiness, deployment flow, and
  post-release checks

## Runbooks

- [Anonymous API Rate Limits](../runbooks/rate-limits.md) — Cloudflare edge
  setup, hosted smoke checks, and incident response for unauthenticated API
  abuse
- [Vercel Incident Response](../runbooks/vercel-incident-response.md) —
  Deployment protection, Trusted Sources checks, and recovery steps for hosted
  app incidents
