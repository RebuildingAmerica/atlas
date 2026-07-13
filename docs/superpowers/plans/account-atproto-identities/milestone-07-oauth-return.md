# Milestone 07: Safe OAuth Return and Persistence

**Status:** Complete

## Objective

Persist verified identities before redirecting and return only to approved
first-party Account, claim, or profile-management destinations.

## Scope

- Typed return-target validation.
- Durable API persistence after OAuth callback.
- Success and failure return parameters.
- Local OAuth harness behavior.

## Delivered

- [x] Allowed only Account Identity, claim, and manage destinations.
- [x] Rejected external, malformed, and unsupported return targets.
- [x] Persisted the verified DID through the lifecycle API before redirecting.
- [x] Returned an opaque identity ID and status instead of provider secrets.
- [x] Preserved recoverable failure context on the originating surface.

## Acceptance criteria

- Signed-out starts fail before provider authorization.
- Open redirects and protocol-relative destinations are impossible.
- Persistence failure never reports a successful connection.
- Successful Account callbacks return to `/account#identity`.

## Evidence

- Primary commit: `85f64fe0`.
- Failure-path coverage: `a95ac279`, `2b012aea`.
- Tests: `app/tests/unit/domains/access/server/atproto-oauth.test.ts` and OAuth
  route tests.
