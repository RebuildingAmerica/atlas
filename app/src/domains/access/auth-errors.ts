/**
 * Typed error codes for Atlas authentication and email-delivery operations.
 *
 * The string value of each code doubles as `error.message` when an
 * `AtlasAuthError` is thrown.  TanStack Start serializes errors across the
 * server-function boundary as plain `Error` objects — class instances and
 * custom properties (including `code`) are lost — but `error.message` is
 * preserved.  `extractAuthErrorCode` uses that invariant to recover the
 * discriminant on the client.
 */
export const AUTH_ERROR_CODE = {
  AUTH_UNAVAILABLE: "AUTH_UNAVAILABLE",
  EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED",
  LOCAL_MODE: "LOCAL_MODE",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODE)[keyof typeof AUTH_ERROR_CODE];

export class AtlasAuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = "AtlasAuthError";
  }
}

/**
 * Recovers an `AuthErrorCode` from an error after it has crossed the
 * server/client boundary.  Returns `null` for any error that was not an
 * `AtlasAuthError` on the server (e.g., an unexpected programming error).
 */
export function extractAuthErrorCode(error: unknown): AuthErrorCode | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message;
  return (Object.values(AUTH_ERROR_CODE) as string[]).includes(msg) ? (msg as AuthErrorCode) : null;
}

/**
 * Builds a Record mapping every `AuthErrorCode` to a human-readable string for
 * a given flow noun ("sign-in" or "sign-up").
 */
export function buildAuthErrorLabels(action: "sign-in" | "sign-up"): Record<AuthErrorCode, string> {
  const verb = action === "sign-in" ? "Sign-in" : "Sign-up";
  const linkNoun = action === "sign-in" ? "sign-in link" : "sign-up link";
  return {
    [AUTH_ERROR_CODE.AUTH_UNAVAILABLE]: `${verb} is temporarily unavailable.`,
    [AUTH_ERROR_CODE.EMAIL_DELIVERY_FAILED]: `Your ${linkNoun} couldn't be delivered. Please try again.`,
    [AUTH_ERROR_CODE.LOCAL_MODE]: `${verb} is not available in this environment.`,
  };
}

/**
 * Maps a raw WebAuthn or BetterAuth passkey error message to a safe,
 * user-facing string.  Never surfaces internal error details.
 */
export function describePasskeyError(rawMessage: string | undefined): string {
  if (!rawMessage) return "Passkey authentication failed. Please try again.";
  if (rawMessage.includes("NotAllowedError") || rawMessage.includes("AbortError")) {
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
