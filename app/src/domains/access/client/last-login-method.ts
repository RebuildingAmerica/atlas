/**
 * Login methods Atlas highlights on the email-first sign-in screen.
 */
export type AtlasLastLoginMethod = "magic-link" | "passkey";

const LAST_LOGIN_METHOD_COOKIE_NAME = "better-auth.last_used_login_method";
const LAST_LOGIN_METHOD_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Persists the last successful Atlas sign-in method in a browser-readable
 * cookie so the sign-in page can surface the small "Last used" hint without
 * relying on the Better Auth server plugin.
 *
 * @param method - The sign-in method Atlas should remember for the browser.
 */
export function setLastUsedAtlasLoginMethod(method: AtlasLastLoginMethod): void {
  if (typeof document === "undefined") {
    return;
  }

  const encodedMethod = encodeURIComponent(method);
  document.cookie =
    `${LAST_LOGIN_METHOD_COOKIE_NAME}=${encodedMethod}; ` +
    `Max-Age=${LAST_LOGIN_METHOD_COOKIE_MAX_AGE_SECONDS}; ` +
    "Path=/; SameSite=Lax";
}
