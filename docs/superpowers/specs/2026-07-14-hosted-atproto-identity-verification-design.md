# Hosted ATProto Identity Verification Design

Status: Approved for implementation

## Goal

Atlas needs repeatable hosted proof for ATProto identity flows without depending
on a developer's personal signed-in browser session. The verification must prove
the staging deployment can run the same account-ready browser journeys that
local Playwright already exercises: managed identities, organization identity
administration, delegated administration, and passkey-gated ATProto-first
sign-in.

## User experience protected

The end-user promise is that an Atlas operator can create a passkey-backed
account, use a managed Atlas identity by default, connect an identity when they
already have one, and delegate organization identity administration without
surprises. The verification path exists so those flows are proven against the
real hosted staging app before production release, not merely inferred from
local tests or public health checks.

## Current gap

The existing hosted smoke suite proves public routes, Cloudflare edge headers,
ATProto OAuth client metadata, fail-closed malformed ATProto sign-in starts, and
PDS health. It deliberately does not prove signed-in browser flows. The prior
manual proof path depended on an authenticated Chrome profile, which is fragile
and not suitable for CI or open-source contributors.

## Architecture

Add a staging-only hosted E2E harness with two parts:

1. A guarded server-side helper surface that can create or prepare synthetic
   test state only when hosted E2E is explicitly enabled and a per-environment
   secret matches.
2. A Playwright hosted identity suite that runs from GitHub Actions after
   staging deploy, uses the Vercel Trusted OIDC header for protected staging
   access, and uses Chromium virtual WebAuthn to exercise real passkey flows.

The harness must be unavailable by default and unavailable in production. The
helper surface must be narrow, run-scoped, and boring: create verified test
users or workspace members for the active synthetic run, then clean up that
run's records. It must not become a general admin backdoor.

## Guardrails

- Hosted helper routes return 404 unless `ATLAS_HOSTED_E2E_ENABLED=1`.
- Hosted helper routes require `ATLAS_HOSTED_E2E_SECRET` through an
  `x-atlas-hosted-e2e-secret` header.
- Hosted helper routes refuse to run when `ATLAS_DEPLOY_MODE=production` or
  `VERCEL_ENV=production`.
- Test data uses a run id prefix so cleanup targets only records created by the
  current hosted verification run.
- Production keeps only public/non-mutating smoke proof unless a separate
  production-safe synthetic tenant design is approved later.
- Workflow wiring keeps the existing fast public hosted smoke and runs signed-in
  hosted identity verification only for relevant auth, ATProto, workspace,
  deployment, or manual-dispatch changes.

## Test strategy

Implementation is test-first. Unit tests must cover the helper guard so disabled
or production environments fail closed. Hosted Playwright tests must cover the
staging browser journeys:

- account setup reaches account-ready state with a passkey,
- managed organization identity creation succeeds through the hosted UI,
- delegated administration can be granted, used to remove the org identity, and
  revoked,
- ATProto-first username sign-in is available only after the account has an
  Atlas account with a passkey.

The hosted suite should produce traces or screenshots on failure. Documentation
must record the latest staging run URL as evidence when it passes.
