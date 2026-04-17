/**
 * Maps WebAuthn AAGUIDs to human-readable authenticator names.
 *
 * Each registered authenticator model has a unique AAGUID. After a passkey
 * registration completes, Better Auth returns the AAGUID in the Passkey record,
 * which we use to auto-name the passkey without asking the user.
 *
 * Source: https://github.com/nicholasess/passkey-authenticator-aaguids
 * Covers the authenticators most Atlas operators will encounter.
 */
const AAGUID_NAMES: Record<string, string> = {
  // iCloud Keychain (Apple)
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  // Google Password Manager
  "ea9b8d66-4d01-1d21-3ce4-016c2316b432": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Android",
  "b5397666-4885-aa6b-cebf-e52262a439a2": "Chrome on iOS",
  // Windows Hello
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "Windows Hello",
  "aed0a29c-0b90-4b7b-b20a-9f66e87f6c28": "Windows Hello",
  // 1Password
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  // Bitwarden
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  // Dashlane
  "dbd0a9a2-9e2e-4c2d-a4ab-3f7f8a6b1d3e": "Dashlane",
  // YubiKey 5 series
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": "YubiKey 5",
  "73bb0cd4-e502-49b8-9c6f-b59445bf720b": "YubiKey 5 NFC",
  "c1f9a0bc-1dd2-404a-b27f-8e29047a43fd": "YubiKey 5C",
  "85203421-48f9-4355-9bc8-8a53846e5083": "YubiKey 5Ci",
  "a4e9fc6d-4cbe-4758-b8ba-37598bb5bbaa": "YubiKey Bio",
  // Passkeys.io / Hanko
  "d41f5a69-b817-4144-a13c-9ebd6d9254d6": "Hanko Passkey",
};

/** All-zeros AAGUID means the authenticator is privacy-preserving. */
const PRIVACY_AAGUID = "00000000-0000-0000-0000-000000000000";

/**
 * Returns a display name for the given AAGUID, or null if unknown.
 */
export function nameFromAaguid(aaguid: string | null | undefined): string | null {
  if (!aaguid || aaguid === PRIVACY_AAGUID) return null;
  return AAGUID_NAMES[aaguid.toLowerCase()] ?? null;
}

/**
 * Returns a best-effort display name for a passkey using the AAGUID first,
 * then falling back to OS detection from the User-Agent.
 */
export function resolvePasskeyName(aaguid: string | null | undefined): string {
  const fromAaguid = nameFromAaguid(aaguid);
  if (fromAaguid) return fromAaguid;

  // UA fallback — less precise but better than a generic label
  if (typeof navigator !== "undefined") {
    const uaPlatform = (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform;
    const platform = uaPlatform ?? navigator.platform ?? "";
    const ua = navigator.userAgent ?? "";

    if (/iphone|ipad/i.test(ua)) return "iPhone passkey";
    if (/mac/i.test(platform) || /mac/i.test(ua)) return "Mac passkey";
    if (/win/i.test(platform) || /windows/i.test(ua)) return "Windows passkey";
    if (/android/i.test(ua)) return "Android passkey";
    if (/linux/i.test(platform)) return "Linux passkey";
  }

  return "My passkey";
}
