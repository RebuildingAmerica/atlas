# Signal Stale Passkeys to the Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Better Auth's server rejects a passkey sign-in because it no
longer has a record of that credential (`PASSKEY_NOT_FOUND`), tell the browser
via the WebAuthn Signal API so it stops suggesting the dead passkey — and do the
same immediately when a user explicitly deletes a passkey from Account Settings.

**Architecture:** One new client-only helper (`signalUnknownPasskey`) wraps
`PublicKeyCredential.signalUnknownCredential` with feature detection and
swallowed errors. It's called from three existing call sites — the explicit
"Sign in with passkey" button, the silent autofill sign-in effect, and the
Account Settings delete-passkey mutation — using credential IDs Better Auth's
client already returns.

**Tech Stack:** React 19, TanStack Start/Router, `@better-auth/passkey` client
(`authClient.signIn.passkey`), TypeScript 6.0.3 (WebAuthn Signal API types
already present in `lib.dom.d.ts`), Vitest + Testing Library, 100% coverage
gate.

**Full design context:**
`docs/superpowers/specs/2026-07-05-passkey-stale-credential-signal-design.md`

---

### Task 1: `signalUnknownPasskey` helper

**Files:**

- Create: `app/src/domains/access/passkey-signal.ts`
- Test: `app/tests/unit/domains/access/passkey-signal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { signalUnknownPasskey } from "@/domains/access/passkey-signal";

describe("signalUnknownPasskey", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });

  it("does nothing when PublicKeyCredential is unavailable", () => {
    expect(() => signalUnknownPasskey("cred-123")).not.toThrow();
  });

  it("does nothing when signalUnknownCredential is not a function", () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: {},
    });

    expect(() => signalUnknownPasskey("cred-123")).not.toThrow();
  });

  it("calls signalUnknownCredential with the current hostname and credential id", () => {
    const signalUnknownCredential = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { signalUnknownCredential },
    });

    signalUnknownPasskey("cred-123");

    expect(signalUnknownCredential).toHaveBeenCalledWith({
      rpId: window.location.hostname,
      credentialId: "cred-123",
    });
  });

  it("swallows a rejection from signalUnknownCredential", async () => {
    const signalUnknownCredential = vi
      .fn()
      .mockRejectedValue(new Error("not supported"));
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { signalUnknownCredential },
    });

    expect(() => signalUnknownPasskey("cred-123")).not.toThrow();
    await vi.waitFor(() => {
      expect(signalUnknownCredential).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/passkey-signal.test.ts`
Expected: FAIL — `Cannot find module '@/domains/access/passkey-signal'` (file
doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Tells a supporting browser's credential store that a passkey no longer
 * exists server-side, via the WebAuthn Signal API. Best-effort: browsers
 * without support, or a rejected call, are silently ignored — this is
 * hygiene cleanup, never a required step in any auth or account flow.
 */
export function signalUnknownPasskey(credentialId: string): void {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.signalUnknownCredential !== "function"
  ) {
    return;
  }

  void PublicKeyCredential.signalUnknownCredential({
    rpId: window.location.hostname,
    credentialId,
  }).catch(() => {
    return;
  });
}
```

Note: `PublicKeyCredential.signalUnknownCredential` and its
`UnknownCredentialOptions` (`{ credentialId: string; rpId: string }`) are
already declared in TypeScript 6.0.3's bundled `lib.dom.d.ts` — no type
augmentation needed. The `typeof PublicKeyCredential === "undefined"` check
alone (without a separate `typeof window` check) is sufficient: in any
environment where `PublicKeyCredential` doesn't exist as a global (Node/SSR, or
an unsupported browser), this branch returns before `window.location` is ever
read.

- [ ] **Step 4: Run test to verify it passes**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/passkey-signal.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git restore --staged . && git add app/src/domains/access/passkey-signal.ts app/tests/unit/domains/access/passkey-signal.test.ts && git commit -F - <<'EOF'
feat(app): Signal unknown passkeys to the browser

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `describePasskeyError` code-aware messaging + explicit sign-in button

**Files:**

- Modify: `app/src/domains/access/auth-errors.ts:51-67`
- Modify: `app/src/domains/access/pages/auth/sign-in-page.tsx:1-19` (imports),
  `:207-229` (`handlePasskey`)
- Test: `app/tests/unit/domains/access/auth-errors.test.ts:45-78`
- Test: `app/tests/unit/domains/access/pages/sign-in-page.test.tsx`

- [ ] **Step 1: Update the failing/updated tests in `auth-errors.test.ts`**

Replace the `describePasskeyError` describe block (lines 45-78) with:

```ts
describe("describePasskeyError", () => {
  it("returns the generic message when no error is supplied", () => {
    expect(describePasskeyError(undefined)).toBe(
      "Passkey authentication failed. Please try again.",
    );
  });

  it("explains that the passkey is gone when the server returns PASSKEY_NOT_FOUND", () => {
    expect(
      describePasskeyError({
        code: "PASSKEY_NOT_FOUND",
        message: "Passkey not found",
      }),
    ).toBe(
      "This passkey is no longer linked to your account. Please sign in another way.",
    );
  });

  it("treats NotAllowedError or AbortError as cancellation", () => {
    expect(describePasskeyError({ message: "NotAllowedError: blocked" })).toBe(
      "Passkey authentication was cancelled.",
    );
    expect(describePasskeyError({ message: "AbortError: user aborted" })).toBe(
      "Passkey authentication was cancelled.",
    );
  });

  it("explains NotSupportedError in plain language", () => {
    expect(describePasskeyError({ message: "NotSupportedError: nope" })).toBe(
      "Passkeys are not supported on this device or browser.",
    );
  });

  it("flags InvalidStateError as a duplicate registration", () => {
    expect(
      describePasskeyError({
        message: "InvalidStateError: already registered",
      }),
    ).toBe("This passkey is already registered on your account.");
  });

  it("falls back to the generic message for unknown errors", () => {
    expect(describePasskeyError({ message: "RandomError: weird" })).toBe(
      "Passkey authentication failed. Please try again.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && pnpm vitest run tests/unit/domains/access/auth-errors.test.ts`
Expected: FAIL — every case throws or mismatches, since `describePasskeyError`
still expects a raw string and calls `.includes` directly on the object
argument.

- [ ] **Step 3: Update `describePasskeyError` in `auth-errors.ts`**

Replace lines 51-67 (the JSDoc comment and `describePasskeyError` function)
with:

```ts
export interface PasskeySignInError {
  code?: string;
  message?: string;
}

/**
 * Maps a raw WebAuthn or BetterAuth passkey error to a safe, user-facing
 * string. Never surfaces internal error details.
 */
export function describePasskeyError(
  error: PasskeySignInError | undefined,
): string {
  if (error?.code === "PASSKEY_NOT_FOUND") {
    return "This passkey is no longer linked to your account. Please sign in another way.";
  }

  const rawMessage = error?.message;
  if (!rawMessage) return "Passkey authentication failed. Please try again.";
  if (
    rawMessage.includes("NotAllowedError") ||
    rawMessage.includes("AbortError")
  ) {
    return "Passkey authentication was cancelled.";
  }
  if (rawMessage.includes("NotSupportedError")) {
    return "Passkeys are not supported on this device or browser.";
  }
  if (rawMessage.includes("InvalidStateError")) {
    return "This passkey is already registered on your account.";
  }
  return "Passkey authentication failed. Please try again.";
}
```

This copy intentionally does not suggest adding a new passkey:
`describePasskeyError` is only ever called from the sign-in page, before
authentication, where the user has no session and no way to reach Account
Settings.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && pnpm vitest run tests/unit/domains/access/auth-errors.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing test for the sign-in button wiring**

In `app/tests/unit/domains/access/pages/sign-in-page.test.tsx`, add
`signalUnknownPasskey: vi.fn()` to the `vi.hoisted` `mocks` object (after
`readLastUsedAtlasEmail: vi.fn(),` at line 14):

```ts
const mocks = vi.hoisted(() => ({
  requestMagicLink: vi.fn(),
  resolveWorkspaceSSOSignIn: vi.fn(),
  waitForAtlasAuthenticatedSession: vi.fn(),
  setLastUsedAtlasLoginMethod: vi.fn(),
  getAuthClient: vi.fn(),
  getAuthConfig: vi.fn(),
  readLastUsedAtlasEmail: vi.fn(),
  signalUnknownPasskey: vi.fn(),
}));
```

Add a new `vi.mock` call (after the `last-used-email` mock at line 44):

```ts
vi.mock("@/domains/access/passkey-signal", () => ({
  signalUnknownPasskey: mocks.signalUnknownPasskey,
}));
```

Add a new test after
`"describes the passkey error when sign-in returns an error"` (after line 304):

```ts
  it("signals the browser and shows a specific message when the passkey no longer exists", async () => {
    authClient.signIn.passkey.mockResolvedValue({
      error: { code: "PASSKEY_NOT_FOUND", message: "Passkey not found" },
      webauthn: { response: { id: "cred-dead" } },
    });

    render(<SignInPage />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Sign in with passkey/i));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(
        screen.getByText(
          "This passkey is no longer linked to your account. Please sign in another way.",
        ),
      ).toBeInTheDocument();
    });
    expect(mocks.signalUnknownPasskey).toHaveBeenCalledWith("cred-dead");
    expect(authClient.signIn.passkey).toHaveBeenCalledWith(
      expect.objectContaining({ returnWebAuthnResponse: true }),
    );
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/pages/sign-in-page.test.tsx`
Expected: FAIL — the new test's `signalUnknownPasskey` assertion and the
specific message text are not produced yet; `handlePasskey` doesn't pass
`returnWebAuthnResponse` or inspect `result.error.code`.

- [ ] **Step 7: Wire the explicit sign-in button**

In `app/src/domains/access/pages/auth/sign-in-page.tsx`, add the import after
the `session-confirmation` import (line 13):

```ts
import { waitForAtlasAuthenticatedSession } from "@/domains/access/client/session-confirmation";
import { signalUnknownPasskey } from "@/domains/access/passkey-signal";
```

Replace `handlePasskey` (lines 207-229) with:

```ts
const handlePasskey = async () => {
  setErrorMessage(null);
  setStatusMessage(null);
  setIsPasskeyPending(true);

  try {
    const result = await authClient.signIn.passkey({
      returnWebAuthnResponse: true,
    });

    if (result.error) {
      if (
        "code" in result.error &&
        result.error.code === "PASSKEY_NOT_FOUND" &&
        "webauthn" in result
      ) {
        signalUnknownPasskey(result.webauthn.response.id);
      }
      setErrorMessage(describePasskeyError(result.error));
      return;
    }

    await waitForAtlasAuthenticatedSession();
    setLastUsedAtlasLoginMethod("passkey");
    setLastMethod("passkey");
    window.location.assign(callbackURL);
  } catch {
    setErrorMessage("Passkey sign-in failed. Please try again.");
  } finally {
    setIsPasskeyPending(false);
  }
};
```

- [ ] **Step 8: Run test to verify it passes**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/pages/sign-in-page.test.tsx`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 9: Commit**

```bash
git restore --staged . && git add app/src/domains/access/auth-errors.ts app/src/domains/access/pages/auth/sign-in-page.tsx app/tests/unit/domains/access/auth-errors.test.ts app/tests/unit/domains/access/pages/sign-in-page.test.tsx && git commit -F - <<'EOF'
feat(app): Show a specific message and clean up dead passkeys on sign-in

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Silent autofill sign-in cleanup

**Files:**

- Modify: `app/src/domains/access/pages/auth/sign-in-page.tsx:104-150`
- Test: `app/tests/unit/domains/access/pages/sign-in-page.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a new test after the `"signals the browser and shows a specific message..."`
test from Task 2 (or after the existing
`"skips the conditional autofill when isConditionalMediationAvailable returns false"`
test at the end of the file, before the closing `});`):

```ts
  it("signals the browser when the autofill sign-in returns a stale passkey", async () => {
    const isConditionalMediationAvailable = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { isConditionalMediationAvailable },
    });
    authClient.signIn.passkey.mockImplementation(
      (options: { autoFill?: boolean; returnWebAuthnResponse?: boolean }) => {
        if (options?.autoFill) {
          return Promise.resolve({
            error: { code: "PASSKEY_NOT_FOUND", message: "Passkey not found" },
            webauthn: { response: { id: "cred-dead-autofill" } },
          });
        }
        return Promise.resolve({ data: null });
      },
    );

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(mocks.signalUnknownPasskey).toHaveBeenCalledWith("cred-dead-autofill");
    });
    expect(authClient.signIn.passkey).toHaveBeenCalledWith(
      expect.objectContaining({ autoFill: true, returnWebAuthnResponse: true }),
    );
    expect(screen.queryByText(/no longer linked/)).toBeNull();

    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/pages/sign-in-page.test.tsx`
Expected: FAIL — the autofill effect doesn't pass `returnWebAuthnResponse` or
read the result, so `signalUnknownPasskey` is never called.

- [ ] **Step 3: Wire the autofill effect**

Replace the `useEffect` block (lines 104-150) with:

```ts
useEffect(() => {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
  ) {
    return;
  }

  let active = true;

  const startConditionalPasskeyAutofill = async () => {
    try {
      const conditionalMediationAvailable =
        await PublicKeyCredential.isConditionalMediationAvailable();

      if (!conditionalMediationAvailable || !active) {
        return;
      }

      const result = await authClient.signIn.passkey({
        autoFill: true,
        returnWebAuthnResponse: true,
        fetchOptions: {
          onError: () => {
            return;
          },
          onSuccess: async () => {
            if (!active) {
              return;
            }
            await waitForAtlasAuthenticatedSession();
            setLastUsedAtlasLoginMethod("passkey");
            setLastMethod("passkey");
            window.location.assign(callbackURL);
          },
        },
      });

      if (
        result.error &&
        "code" in result.error &&
        result.error.code === "PASSKEY_NOT_FOUND" &&
        "webauthn" in result
      ) {
        signalUnknownPasskey(result.webauthn.response.id);
      }
    } catch {
      return;
    }
  };

  void startConditionalPasskeyAutofill();

  return () => {
    active = false;
  };
}, [authClient, callbackURL]);
```

This stays silent on error exactly as before — no `setErrorMessage` call — the
only change is that a dead credential now also gets signaled to the browser in
the background.

- [ ] **Step 4: Run test to verify it passes**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/pages/sign-in-page.test.tsx`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git restore --staged . && git add app/src/domains/access/pages/auth/sign-in-page.tsx app/tests/unit/domains/access/pages/sign-in-page.test.tsx && git commit -F - <<'EOF'
feat(app): Clean up stale passkeys surfaced via autofill sign-in

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Signal on explicit passkey deletion

**Files:**

- Modify: `app/src/domains/access/pages/workspace/account-page.tsx:1-20`
  (imports), `:65-77` (`deletePasskeyMutation`)
- Test: `app/tests/unit/domains/access/pages/account-page.test.tsx`

- [ ] **Step 1: Write the failing test setup and assertion**

In `app/tests/unit/domains/access/pages/account-page.test.tsx`, add
`signalUnknownPasskey: vi.fn()` to the `vi.hoisted` `mocks` object (after
`updatePasskey: vi.fn(),` at line 19):

```ts
const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  deletePasskey: vi.fn(),
  listScoutDevices: vi.fn(),
  invalidateQueries: vi.fn(),
  revokeScoutDevice: vi.fn(),
  updatePasskey: vi.fn(),
  signalUnknownPasskey: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
```

Add a new `vi.mock` call (after the `@/domains/access/passkeys.functions` mock
at line 125):

```ts
vi.mock("@/domains/access/passkey-signal", () => ({
  signalUnknownPasskey: mocks.signalUnknownPasskey,
}));
```

Update the shared `useMutation` mock implementation (lines 262-289) so
`onSuccess` receives the mutation's input as its second argument, matching real
TanStack Query's `onSuccess(data, variables)` signature:

```ts
mocks.useMutation.mockImplementation(
  (config: {
    mutationFn?: (input?: unknown) => Promise<unknown>;
    onError?: () => void;
    onSuccess?: (result?: unknown, variables?: unknown) => void | Promise<void>;
  }) => ({
    isPending: false,
    mutate: (input?: unknown) => {
      Promise.resolve(config.mutationFn?.(input))
        .then(async (result) => {
          await config.onSuccess?.(result, input);
        })
        .catch(() => {
          config.onError?.();
        });
    },
    mutateAsync: async (input?: unknown) => {
      try {
        const result = await config.mutationFn?.(input);
        await config.onSuccess?.(result, input);
        return result;
      } catch (error) {
        config.onError?.();
        throw error;
      }
    },
  }),
);
```

Add `mocks.signalUnknownPasskey.mockReset();` to `beforeEach` (after
`mocks.updatePasskey.mockReset();` at line 254).

In the first test,
`"renders account data and supports passkey and API-key actions"`, add an
assertion right after the existing `deletePasskey` assertion (line 409-411):

```ts
expect(mocks.deletePasskey).toHaveBeenCalledWith({
  data: { id: "pk_123" },
});
expect(mocks.signalUnknownPasskey).toHaveBeenCalledWith("pk_123");
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/pages/account-page.test.tsx`
Expected: FAIL — `signalUnknownPasskey` is never called by `account-page.tsx`
yet.

- [ ] **Step 3: Wire the delete mutation**

In `app/src/domains/access/pages/workspace/account-page.tsx`, add the import
after the `passkey-names` import (line 8):

```ts
import { resolvePasskeyName } from "@/domains/access/passkey-names";
import { signalUnknownPasskey } from "@/domains/access/passkey-signal";
```

Replace `deletePasskeyMutation` (lines 65-77) with:

```ts
const deletePasskeyMutation = useMutation({
  mutationFn: (id: string) => deletePasskey({ data: { id } }),
  onSuccess: async (_data, id) => {
    setFlashMessage("Passkey removed.");
    signalUnknownPasskey(id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: atlasSessionQueryKey }),
    ]);
  },
  onError: () => {
    setErrorMessage("Atlas could not remove that passkey. Please try again.");
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`cd app && pnpm vitest run tests/unit/domains/access/pages/account-page.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git restore --staged . && git add app/src/domains/access/pages/workspace/account-page.tsx app/tests/unit/domains/access/pages/account-page.test.tsx && git commit -F - <<'EOF'
feat(app): Clean up the browser's copy of a passkey on delete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Type-check the app**

Run: `cd app && pnpm tsc --noEmit` Expected: No errors.

- [ ] **Step 2: Lint the app**

Run: `cd app && pnpm run lint` Expected: No errors.

- [ ] **Step 3: Format check**

Run: `cd app && pnpm run format` Expected: No changes reported (or auto-fixes
applied cleanly).

- [ ] **Step 4: Full test suite with coverage**

Run: `cd app && pnpm vitest run --coverage` Expected: All tests pass;
`app/src/domains/access/passkey-signal.ts`, the touched regions of
`auth-errors.ts`, `sign-in-page.tsx`, and `account-page.tsx` show 100%
statements/branches/functions/lines coverage; the overall coverage gate (100%
thresholds in `app/vitest.config.ts`) passes.

- [ ] **Step 5: Manual smoke check (optional but recommended)**

Since this feature depends on a real Chromium browser's WebAuthn credential
store (`PublicKeyCredential.signalUnknownCredential` cannot be meaningfully
exercised in jsdom), consider a manual check in Chrome/Edge 129+: register a
passkey in Account Settings, delete it, then confirm in
`chrome://settings/passkeys` (or the OS credential manager) that the entry is
gone. This is exploratory verification, not a blocking gate — the automated test
suite already covers all application-level logic.

## Spec coverage check

- Helper + feature detection → Task 1.
- Explicit sign-in button (signal + specific message) → Task 2.
- Silent autofill signal → Task 3.
- Account Settings delete signal → Task 4.
- Non-goals (no `signalAllAcceptedCredentials`, no server changes, no
  `handlePasskeyAdd` changes) → not implemented, as intended.
