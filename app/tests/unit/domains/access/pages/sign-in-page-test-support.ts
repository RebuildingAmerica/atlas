import { vi, type Mock } from "vitest";

/**
 * The slice of the browser's WebAuthn client API the sign-in page touches:
 * one capability probe before it offers conditional autofill, and one hygiene
 * call after the server rejects a credential the browser still remembers.
 */
export interface PasskeyCredentialApiStub {
  isConditionalMediationAvailable: Mock<() => Promise<boolean>>;
  signalUnknownCredential: Mock<(options: { credentialId: string; rpId: string }) => Promise<void>>;
}

/**
 * A conditional-mediation probe whose answer the test controls, so it can
 * unmount the page while the browser is still deciding.
 */
export interface DeferredPasskeyCredentialApi {
  api: PasskeyCredentialApiStub;
  settle: (available: boolean) => void;
}

/**
 * The options the sign-in page hands Better Auth's passkey client. Conditional
 * autofill passes `autoFill` plus the fetch callbacks that establish the
 * session; the button press passes neither.
 */
export interface PasskeySignInOptions {
  autoFill?: boolean;
  fetchOptions?: {
    onError: () => void;
    onSuccess: () => Promise<void>;
  };
  returnWebAuthnResponse?: boolean;
}

/**
 * Builds a WebAuthn stub without installing it.
 *
 * @param probe - What the conditional-mediation capability check settles with.
 */
function buildPasskeyCredentialApi(probe: () => Promise<boolean>): PasskeyCredentialApiStub {
  return {
    isConditionalMediationAvailable: vi.fn(probe),
    signalUnknownCredential: vi.fn(() => Promise.resolve()),
  };
}

/**
 * Installs the WebAuthn client API a passkey-capable browser exposes.
 *
 * jsdom ships no `PublicKeyCredential`, so without this the sign-in page's
 * conditional-autofill effect returns before it does anything.
 *
 * @param probe - What `isConditionalMediationAvailable()` settles with; a
 *   rejection models a browser that refuses the probe outright.
 * @returns The installed stub, for asserting on signalled credentials.
 */
export function stubPasskeyCredentialApi(probe: () => Promise<boolean>): PasskeyCredentialApiStub {
  const api = buildPasskeyCredentialApi(probe);
  vi.stubGlobal("PublicKeyCredential", api);
  return api;
}

/**
 * Installs a WebAuthn API whose capability probe stays pending until the test
 * settles it.
 *
 * @returns The installed stub and the function that answers the probe.
 */
export function stubDeferredPasskeyCredentialApi(): DeferredPasskeyCredentialApi {
  let settle: (available: boolean) => void = () => undefined;
  const api = buildPasskeyCredentialApi(
    () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
  );
  vi.stubGlobal("PublicKeyCredential", api);
  return {
    api,
    settle: (available) => {
      settle(available);
    },
  };
}

/**
 * Installs a WebAuthn API from a browser that supports passkeys but predates
 * conditional mediation.
 */
export function stubLegacyPasskeyCredentialApi(): void {
  vi.stubGlobal("PublicKeyCredential", {});
}
