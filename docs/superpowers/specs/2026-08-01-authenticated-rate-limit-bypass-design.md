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

The API middleware will admit trusted internal actors immediately. Other
credential-bearing requests enter fixed-size client and credential verification
gates before unknown credentials can trigger JWT/JWKS work or remote API-key
introspection. The client gate reserves credential-attempt capacity before work;
the credential gate makes concurrent API-key cache misses across clients share
the first completed introspection. Successful verification refunds the client
reservation. Valid accounts therefore accumulate neither credential nor
anonymous quota, while invalid credentials retain the reservation and then enter
the ordinary anonymous read/write and hourly buckets. Fixed lock striping bounds
gate memory without retaining client addresses or credentials.

Failed bearer verification results will be cached briefly by a one-way token
fingerprint. Successful bearer tokens are verified on every request so a cache
cannot outlive the token's own expiry. API-key verification keeps using its
bounded principal cache, and the credential gate makes concurrent cache misses
share the first completed introspection before the next request checks that
cache. A completed negative API-key result is carried into the protected-route
dependency so the same request cannot introspect twice. Rotating invalid values
cannot reach verification after their client's credential-attempt capacity is
exhausted. Cache size and lifetime remain bounded by the existing rate-limit
cache constants.

## Safety and failure behavior

The API remains the only authority that decides whether a supplied credential is
valid. Merely adding an `Authorization` or `X-API-Key` header cannot bypass API
admission control. Invalid credentials are bounded before expensive verification
even when an attacker rotates values, continue to produce privacy-safe logs
without raw tokens, and receive standard `429` responses when their credential
or anonymous buckets are exhausted.

Each external request must use exactly one authentication method. Supplying both
`Authorization` and `X-API-Key` is treated as an invalid credential attempt and
cannot use one valid credential to refund work caused by another invalid one.

No endpoint-specific exception or production-only limit increase is introduced.
The invariant applies consistently to every currently limited API surface,
preventing the same bug from recurring in discovery sync, moderation, or another
authenticated workflow.

## Verification

Behavioral tests will prove that valid bearer tokens and API keys can exceed
configured anonymous and credential limits, while repeated and rotating invalid
values are stopped before additional verification. A concurrent API-key test
will prove that one client's first cache miss cannot multiply introspection.
App-proxy tests will prove that credential-bearing requests reach the API on
repeated calls, while requests without credentials remain constrained by proxy
anonymous limits.

Focused API and app rate-limit suites must pass, followed by the relevant API
and frontend quality checks. Production verification will use an authenticated
moderation request volume above the old threshold and confirm that anonymous
traffic remains limited.
