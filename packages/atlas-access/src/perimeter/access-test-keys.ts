/**
 * A stand-in Cloudflare Access for tests: an RSA key pair made in the test,
 * tokens signed with it the way Access signs them, and the certs endpoint
 * Access publishes them from.
 */

export const TEST_TEAM_DOMAIN = "atlas-test.cloudflareaccess.com";
export const TEST_AUDIENCE = "a".repeat(64);
export const TEST_OPERATOR = "willie@rebuildingus.org";

export interface AccessTestKeys {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string };
}

/** Generates an RS256 key pair under the given key id. */
export async function makeAccessTestKeys(
  kid = "test-key",
): Promise<AccessTestKeys> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: { ...exported, alg: "RS256", kid, use: "sig" },
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64url-encodes a JSON value as a JWT segment. */
export function encodeSegment(value: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Signs a token as Access would for the operator, with any header or claims
 * changed. A claim set to `undefined` is removed.
 */
export async function signAccessToken(
  keys: AccessTestKeys,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = encodeSegment({
    alg: "RS256",
    kid: keys.kid,
    typ: "JWT",
    ...header,
  });
  const body = encodeSegment(
    Object.fromEntries(
      Object.entries({
        aud: [TEST_AUDIENCE],
        email: TEST_OPERATOR,
        exp: now + 3600,
        iat: now,
        iss: `https://${TEST_TEAM_DOMAIN}`,
        nbf: now,
        sub: "operator-subject",
        type: "app",
        ...claims,
      }).filter(([, value]) => value !== undefined),
    ),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

/** A fetch that serves the given keys from the team's certs endpoint and counts calls. */
export function certsFetch(...keySets: AccessTestKeys[][]): {
  calls: string[];
  fetch: typeof fetch;
} {
  const calls: string[] = [];
  let served = 0;
  const fetchCerts: typeof fetch = (input) => {
    calls.push(new Request(input).url);
    const keys = keySets[Math.min(served, keySets.length - 1)] ?? [];
    served += 1;
    return Promise.resolve(
      Response.json({ keys: keys.map((key) => key.publicJwk) }),
    );
  };
  return { calls, fetch: fetchCerts };
}
