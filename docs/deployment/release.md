# Release Process

[Docs](../README.md) > [Deployment](./README.md) > Release Process

This document covers how we decide Atlas is ready to release, what to
check before shipping, and what to verify afterward.

Use [Production Deployment](./production.md) for environment and hosting
details. Use this document for the release workflow itself.

## Release Readiness

A release is ready only when:

- The intended changes are merged to the release branch or mainline you
  are shipping from
- `make quality` passes locally or in the relevant CI path
- The deployment path is understood for the environment you are using
- The user-facing or operator-facing changes are documented
- Known risks are explicit, not implicit

## Before You Release

Work through these checks:

1. Pull the exact code you intend to release
2. Run the relevant verification commands
   - include `make test-e2e` for auth and protected-route coverage when the release touches app auth or deployment
   - if Playwright browsers are not installed yet, run `cd app && pnpm exec playwright install chromium` first
3. Confirm environment variables and deployment config are correct
4. Confirm database and auth storage are on persistent volumes where required
5. Read the diff with release eyes:
   - API changes
   - auth changes
   - discovery workflow changes
   - config changes
   - docs changes

## Release Commands And Flow

The exact deployment command depends on the environment, but the release
flow should look like this:

1. Verify the code
   ```bash
   make quality
   ```
2. Build or deploy using the intended environment path
3. Tag the release if you are using tags for traceability
4. Record what changed and any known follow-up items

## Post-Release Verification

After deployment, verify in this order:

1. `GET /health` returns `200`
2. `GET /openapi.json` returns the public API contract
3. `GET /docs` lands on the Mintlify docs site when docs are part of the release
4. The app loads successfully
5. Core browse or entry-detail pages render
6. Magic-link sign-in works if auth is enabled
7. Passkey sign-in works if auth is enabled
8. API key creation and direct `X-API-Key` access work if auth is enabled
9. Discovery-run creation works if that path is part of the release
10. Restarting the API does not lose persistent data

Do not treat “deployment command succeeded” as the same thing as “Atlas
is healthy.”

## When to stop the release

Pause and fix the issue before continuing if:

- Health checks fail
- The app cannot load real data
- Auth is broken
- Discovery creation fails unexpectedly
- The deployed config differs from what the release assumed

## Related Docs

- [Production Deployment](./production.md)
- [Workflow](../development/workflow.md)
- [Code Review](../development/code-review.md)
