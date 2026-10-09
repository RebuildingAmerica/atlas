/**
 * The admin app's proof of itself to the Atlas API.
 *
 * Cloudflare Workers have no workload identity to trade for a Google token, so
 * the admin signs a short-lived Ed25519 JWT with a key held as a Worker
 * secret. The API trusts the matching public key through
 * `ATLAS_MACHINE_TRUSTED_ISSUERS`, for the platform actions only, and requires
 * the operator's own Access sign-in alongside it.
 */

import { PLATFORM_API_AUDIENCE } from "./admin-env";

/** Seconds a token lives; the API refuses any that claims more than two minutes. */
export const ADMIN_TOKEN_LIFETIME_SECONDS = 60;

interface SigningSettings {
  adminOrigin: string;
  signingKey: string;
}

const keys = new Map<string, Promise<CryptoKey>>();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeJson(value: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function importSigningKey(pkcs8Base64: string): Promise<CryptoKey> {
  let key = keys.get(pkcs8Base64);
  if (!key) {
    const der = Uint8Array.from(atob(pkcs8Base64), (character) =>
      character.charCodeAt(0),
    );
    key = crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, [
      "sign",
    ]);
    // A failed import is not kept, so the next call tries again instead of
    // failing for the life of the isolate.
    void key.catch(() => {
      keys.delete(pkcs8Base64);
    });
    keys.set(pkcs8Base64, key);
  }
  return key;
}

/**
 * Signs a token saying the admin app is acting for `email`.
 *
 * @param settings - The admin's origin (the token's issuer) and signing key.
 * @param email - The operator the request acts for, sent as the `act` claim.
 * @param nowMs - The current time, in milliseconds.
 */
export async function signAdminToken(
  settings: SigningSettings,
  email: string,
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = encodeJson({ alg: "EdDSA", typ: "JWT" });
  const claims = encodeJson({
    act: email,
    aud: PLATFORM_API_AUDIENCE,
    exp: issuedAt + ADMIN_TOKEN_LIFETIME_SECONDS,
    iat: issuedAt,
    iss: settings.adminOrigin,
    sub: "atlas-admin",
  });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    await importSigningKey(settings.signingKey),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
