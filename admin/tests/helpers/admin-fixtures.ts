/**
 * A working admin runtime for tests: real settings, a real Access verifier
 * pointed at a test key, and a real Ed25519 signing key.
 */

import { generateKeyPairSync } from "node:crypto";
import { CloudflareAccessVerifier } from "@rebuildingamerica/atlas-access/perimeter/cloudflare-access";
import {
  certsFetch,
  makeAccessTestKeys,
  signAccessToken,
  TEST_AUDIENCE,
  TEST_OPERATOR,
  TEST_TEAM_DOMAIN,
  type AccessTestKeys,
} from "@rebuildingamerica/atlas-access/perimeter/access-test-keys";
import { readAdminEnv, type AdminEnvSource } from "@/server/admin-env";
import type { AdminRuntime } from "@/server/admin-runtime";

export const ADMIN_ORIGIN = "https://atlas-admin.example.test";
export const API_ORIGIN = "https://atlas-api.example.test";
export { TEST_OPERATOR };

export interface SigningKeyPair {
  pkcs8: string;
  publicKey: CryptoKey;
}

/** Generates the admin's Ed25519 key pair, as the bootstrap phase would. */
export async function makeSigningKey(): Promise<SigningKeyPair> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    pkcs8,
    publicKey: await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "Ed25519" },
      false,
      ["verify"],
    ),
  };
}

/** Settings for a correctly configured admin, with any value changed. */
export function adminSource(
  overrides: AdminEnvSource = {},
  signingKey = "test-signing-key",
): AdminEnvSource {
  return {
    ATLAS_ACCESS_AUD: TEST_AUDIENCE,
    ATLAS_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
    ATLAS_ADMIN_PUBLIC_URL: ADMIN_ORIGIN,
    ATLAS_ADMIN_SIGNING_KEY: signingKey,
    ATLAS_API_URL: API_ORIGIN,
    ATLAS_PLATFORM_OPERATOR_EMAILS: TEST_OPERATOR,
    ...overrides,
  };
}

export interface TestRuntime {
  keys: AccessTestKeys;
  runtime: AdminRuntime;
}

/** A runtime whose Access verifier trusts a freshly made test key. */
export async function makeRuntime(
  overrides: AdminEnvSource = {},
  signingKey?: string,
): Promise<TestRuntime> {
  const keys = await makeAccessTestKeys();
  const env = readAdminEnv(adminSource(overrides, signingKey), {
    development: false,
  });
  const verifier = new CloudflareAccessVerifier(env.access, {
    fetch: certsFetch([keys]).fetch,
  });
  return { keys, runtime: { env, verifier } };
}

/** A request as Access forwards it, signed in as `email`. */
export async function signedInRequest(
  keys: AccessTestKeys,
  init: RequestInit = {},
  email = TEST_OPERATOR,
): Promise<Request> {
  const headers = new Headers(init.headers);
  headers.set(
    "Cf-Access-Jwt-Assertion",
    await signAccessToken(keys, { email }),
  );
  return new Request(`${ADMIN_ORIGIN}/discounts`, { ...init, headers });
}
