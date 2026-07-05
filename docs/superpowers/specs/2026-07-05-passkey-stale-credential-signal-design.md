# Signal Stale Passkeys to the Browser

## Problem

Atlas uses `@better-auth/passkey`. When a browser's OS/password-manager still offers a passkey that Better Auth's server no longer has a record for (e.g. it was deleted from another device or another session), the WebAuthn ceremony succeeds locally but the server rejects the assertion with `PASSKEY_NOT_FOUND`. Today nothing acts on this:

- The explicit "Sign in with passkey" button (`sign-in-page.tsx:207`, `handlePasskey`) falls through to a generic "Passkey authentication failed. Please try again." message via `describePasskeyError` (`auth-errors.ts:55`), which only pattern-matches raw WebAuthn `DOMException` names and doesn't recognize Better Auth's own error codes.
- The silent autofill/conditional-mediation sign-in path (`sign-in-page.tsx:104-150`) swallows every error, including this one, with no side effect at all.
- Nothing tells the browser the credential is dead, so it keeps re-suggesting it indefinitely.

The browser also has no way to remove a passkey from its own credential store outside of a JS API. Deletion in Account Settings (`account-page.tsx:65-77`) only removes the server-side record — the browser/OS keeps offering the now-dead credential.

## Mechanism

The WebAuthn Signal API (`PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })`) lets a relying party tell a supporting browser/password manager "this credential ID is not valid," so it can stop suggesting it. Supported in Chromium 129+; unsupported browsers no-op harmlessly via feature detection. No server changes are required — Better Auth already returns everything needed on the client.

**Ruled out:** `signalAllAcceptedCredentials` (full reconciliation of a user's entire credential set). Better Auth's passkey plugin mints a fresh random WebAuthn user handle for every registration (`index.mjs:159`, `generateRandomString(32, ...)` per `addPasskey` call) rather than a stable handle per account. Since `signalAllAcceptedCredentials` groups credentials by a single shared `userId`, and every passkey in this app has its own unrelated one, there is no value that represents "all of this person's passkeys" — the mechanism cannot prune across a user's multiple credentials in this data model.

Confirmed technical facts this design relies on:
- The `id` field Better Auth returns for a passkey (in `listPasskeys`, and the `id` argument to `deletePasskey`) is the raw `credentialID` column, not an opaque row ID (`index.mjs:169,276,439`: `id: passkey.credentialID`).
- `authClient.signIn.passkey({ returnWebAuthnResponse: true })` returns `{ ...verified, webauthn: { response, clientExtensionResults } }` even when the server-side verify call fails — `res` (the local WebAuthn ceremony result, captured before the failing fetch) is always attached (`client.mjs:37-55`). This gives access to the credential ID on the exact failure path we need.
- `ATLAS_PASSKEY_RP_ID` is never set in any `.env.example`; `rpID` always falls back to `runtime.publicDomain`, which is `new URL(ATLAS_PUBLIC_URL).hostname` (`runtime.ts:186,207`). So `window.location.hostname` is always the correct `rpId` client-side for this app's actual deployment topology.

## Design

### New helper

`app/src/domains/access/passkey-signal.ts`:

```ts
export function signalUnknownPasskey(credentialId: string): void {
  if (
    typeof window === "undefined" ||
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.signalUnknownCredential !== "function"
  ) {
    return;
  }
  void PublicKeyCredential.signalUnknownCredential({
    rpId: window.location.hostname,
    credentialId,
  }).catch(() => {
    // Best-effort browser hygiene; failures here must never surface to the user.
  });
}
```

Fire-and-forget by design — callers never `await` it, and it must never throw into or delay the calling flow.

### Integration points

1. **Explicit sign-in button** — `sign-in-page.tsx:207` (`handlePasskey`). Add `returnWebAuthnResponse: true` to the `authClient.signIn.passkey()` call. When `result.error?.code === "PASSKEY_NOT_FOUND"`, call `signalUnknownPasskey(result.webauthn.response.id)`, then show the specific message (see Copy below) instead of the generic fallback.
2. **Silent autofill sign-in** — `sign-in-page.tsx:104-150`. Add `returnWebAuthnResponse: true`; capture the currently-discarded return value. On `result?.error?.code === "PASSKEY_NOT_FOUND"`, call `signalUnknownPasskey` in the background. No UI change — this path stays silent on error exactly as it is today.
3. **Account Settings → Delete passkey** — `account-page.tsx:65-77` (`deletePasskeyMutation`). In `onSuccess(data, variables)`, call `signalUnknownPasskey(variables)` (the mutation function already receives the credential ID as its sole argument) so the browser forgets it immediately on explicit deletion, rather than waiting for a future failed sign-in attempt.

### Error messaging

`describePasskeyError` (`auth-errors.ts:55`) changes signature from a raw message string to an object, so it can match Better Auth's structured error `code` in addition to the existing raw `DOMException` name substring matches on `message`:

```ts
export function describePasskeyError(error: { code?: string; message?: string } | undefined): string
```

New branch, checked first:

```ts
if (error?.code === "PASSKEY_NOT_FOUND") {
  return "This passkey is no longer linked to your account. Please sign in another way.";
}
```

This copy intentionally does **not** suggest adding a new passkey — `handlePasskey` runs on the sign-in page, before authentication, where the user has no session and no way to reach Account Settings to add one.

All existing `DOMException`-name branches (`NotAllowedError`/`AbortError`/`NotSupportedError`/`InvalidStateError`) are unchanged in behavior, just read from `error?.message` on the new parameter shape. The one call site (`sign-in-page.tsx:216`) changes from `describePasskeyError(result.error.message)` to `describePasskeyError(result.error)`.

The account-page passkey registration flow (`handlePasskeyAdd`) is untouched — it has its own generic catch-all and is out of scope here.

### Testing

- New test file for `passkey-signal.ts`: unsupported browser → no-op, doesn't throw; supported browser → calls `signalUnknownCredential` with `{ rpId: window.location.hostname, credentialId }`; supported browser whose call rejects → rejection is swallowed, never propagates.
- `describePasskeyError` tests updated for the new object parameter shape, plus a new case for `PASSKEY_NOT_FOUND`.
- `sign-in-page.tsx` tests: explicit button path asserts `signalUnknownPasskey` is called with the credential ID from a mocked `PASSKEY_NOT_FOUND` response, and the specific message is shown; autofill path asserts the same signal call fires with no visible error state change.
- `account-page.tsx` tests: `deletePasskeyMutation` success asserts `signalUnknownPasskey` is called with the deleted credential ID.
- `PublicKeyCredential.signalUnknownCredential` is mocked in tests the same way existing tests already mock `PublicKeyCredential.isConditionalMediationAvailable`.
- Coverage gate is 100% (statements + branches + functions + lines) for `app/` — both the supported and unsupported branches of the feature-detection must be exercised.

## Out of scope

- No server-side changes — Better Auth's passkey plugin is used as-is.
- No `signalAllAcceptedCredentials` / full reconciliation (see Mechanism above for why).
- No changes to the "Add passkey" registration error flow or its messaging.
- No UI change to the autofill path beyond the invisible signal call — it stays silent on error.
- Browsers without `signalUnknownCredential` (Safari, Firefox, as of writing) get a harmless no-op; this feature is strictly additive on supporting browsers and neutral elsewhere.
