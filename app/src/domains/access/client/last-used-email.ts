const LAST_USED_EMAIL_STORAGE_KEY = "atlas:last-used-email";

/**
 * Persists the last email an operator successfully started a sign-in flow
 * with so the next visit can pre-fill the form.  Stored in localStorage so
 * it stays per-device and survives sign-out — operators sharing a browser
 * can clear it from devtools or by signing in with a different address.
 *
 * @param email - The email address the operator just submitted.
 */
export function rememberLastUsedAtlasEmail(email: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = email.trim();
  if (!trimmed) {
    window.localStorage.removeItem(LAST_USED_EMAIL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LAST_USED_EMAIL_STORAGE_KEY, trimmed);
}

/**
 * Returns the last email an operator successfully signed in or signed up
 * with on this device, or null when none has been remembered.
 */
export function readLastUsedAtlasEmail(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(LAST_USED_EMAIL_STORAGE_KEY);
  return raw?.trim() ? raw.trim() : null;
}
