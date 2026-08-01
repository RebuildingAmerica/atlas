# Authenticated Rate-Limit Bypass Design

## Outcome

Atlas must never classify a verified account, API key, or Scout worker token as
anonymous traffic. Authenticated operators must be able to review a normal
discovery run without exhausting anonymous request buckets, while forged
credentials and genuinely anonymous clients remain protected by admission
controls.

## Request flow

The app proxy cannot authoritatively validate Atlas API keys or Scout bearer
tokens. It will therefore forward credential-bearing requests without consuming
its anonymous proxy buckets and leave validation to the API, which owns the
credential trust boundary. Browser sessions already receive trusted internal
actor headers and continue to bypass anonymous limits.

The API middleware will validate credential-bearing requests before deciding
whether anonymous admission control applies. A successfully verified internal
actor, API key, or bearer token proceeds without reserving credential or
anonymous buckets. A failed credential remains subject to the credential-attempt
bucket and then the ordinary anonymous read/write and hourly buckets.

Failed bearer verification results will be cached briefly by a one-way token
fingerprint. Successful bearer tokens are verified on every request so a cache
cannot outlive the token's own expiry. This preserves the current protection
against repeatedly verifying the same forged bearer token without retaining or
logging the credential. Cache size and lifetime remain bounded by the existing
rate-limit cache constants.

## Safety and failure behavior

The API remains the only authority that decides whether a supplied credential is
valid. Merely adding an `Authorization` or `X-API-Key` header cannot bypass API
admission control. Invalid credentials continue to produce privacy-safe logs
without raw tokens, and they continue to receive standard `429` responses when
their credential or anonymous buckets are exhausted.

No endpoint-specific exception or production-only limit increase is introduced.
The invariant applies consistently to every currently limited API surface,
preventing the same bug from recurring in discovery sync, moderation, or another
authenticated workflow.

## Verification

Behavioral tests will prove that valid bearer tokens and API keys can exceed
configured anonymous and credential limits, while the same invalid API key or
bearer token is verified once and then throttled. App-proxy tests will prove
that credential-bearing requests reach the API on repeated calls, while requests
without credentials remain constrained by proxy anonymous limits.

Focused API and app rate-limit suites must pass, followed by the relevant API
and frontend quality checks. Production verification will use an authenticated
moderation request volume above the old threshold and confirm that anonymous
traffic remains limited.
