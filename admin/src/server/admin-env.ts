/**
 * What the platform admin needs to run, read once and checked strictly.
 *
 * Missing or malformed settings throw, so a misconfigured Worker refuses every
 * request with a 503 instead of serving an open door. There is no development
 * bypass in a deployed Worker: `ATLAS_ADMIN_DEV_OPERATOR_EMAIL` is honored only
 * by `vite dev`, and its presence anywhere else is itself a refusal.
 */

import {
  parseAccessConfig,
  type AccessConfig,
} from "@rebuildingamerica/atlas-access/perimeter/cloudflare-access";

/** The audience the API's platform routes expect in the admin app's token. */
export const PLATFORM_API_AUDIENCE = "urn:atlas:platform-api";

export interface AdminEnvSource {
  ATLAS_ACCESS_AUD?: string;
  ATLAS_ACCESS_TEAM_DOMAIN?: string;
  ATLAS_ADMIN_DEV_OPERATOR_EMAIL?: string;
  ATLAS_ADMIN_PUBLIC_URL?: string;
  ATLAS_ADMIN_SIGNING_KEY?: string;
  ATLAS_API_URL?: string;
  ATLAS_PLATFORM_OPERATOR_EMAILS?: string;
}

export interface AdminEnv {
  /** The Cloudflare Access team and application this Worker sits behind. */
  access: AccessConfig;
  /** The admin's own origin, used as the `iss` of its tokens and for Origin checks. */
  adminOrigin: string;
  /** The Atlas API origin the platform routes live on. */
  apiOrigin: string;
  /** Development only: act as this operator without Access. */
  devOperatorEmail: string | null;
  /** People who may use the admin, matched exactly after lowercasing. */
  operators: ReadonlySet<string>;
  /** Base64 PKCS#8 Ed25519 private key the admin signs API calls with. */
  signingKey: string;
}

interface ReadOptions {
  /** True only under `vite dev`. */
  development: boolean;
}

function required(source: AdminEnvSource, key: keyof AdminEnvSource): string {
  const value = source[key]?.trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function httpsOrigin(value: string, key: string, development: boolean): string {
  const url = new URL(value);
  const local =
    development && url.protocol === "http:" && url.hostname === "localhost";
  if (url.protocol !== "https:" && !local)
    throw new Error(`${key} must use https.`);
  return url.origin;
}

/** The DER prefix every PKCS#8-wrapped Ed25519 private key starts with. */
const ED25519_PKCS8_PREFIX = [
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
];
const ED25519_PKCS8_LENGTH = 48;

/**
 * Checks the signing key's shape up front, so a mangled secret refuses every
 * request with the gate's 503 instead of failing inside each API call.
 */
function signingKey(value: string): string {
  const invalid = new Error(
    "ATLAS_ADMIN_SIGNING_KEY must be a base64 PKCS#8 Ed25519 private key.",
  );
  let der: Uint8Array;
  try {
    der = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw invalid;
  }
  const prefixMatches = ED25519_PKCS8_PREFIX.every(
    (byte, index) => der[index] === byte,
  );
  if (der.length !== ED25519_PKCS8_LENGTH || !prefixMatches) throw invalid;
  return value;
}

function operatorList(value: string): ReadonlySet<string> {
  const emails = value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0)
    throw new Error("ATLAS_PLATFORM_OPERATOR_EMAILS names no one.");
  return new Set(emails);
}

/**
 * Reads and checks the admin's settings.
 *
 * @param source - The Worker's environment (or `process.env` under `vite dev`).
 * @param options - Whether this is local development.
 * @throws When a setting is missing or malformed, or a development bypass is set outside development.
 */
export function readAdminEnv(
  source: AdminEnvSource,
  { development }: ReadOptions,
): AdminEnv {
  const devOperatorEmail =
    source.ATLAS_ADMIN_DEV_OPERATOR_EMAIL?.trim().toLowerCase() || null;
  if (devOperatorEmail && !development) {
    throw new Error(
      "ATLAS_ADMIN_DEV_OPERATOR_EMAIL must not be set on a deployed admin.",
    );
  }
  return {
    access: parseAccessConfig(source),
    adminOrigin: httpsOrigin(
      required(source, "ATLAS_ADMIN_PUBLIC_URL"),
      "ATLAS_ADMIN_PUBLIC_URL",
      development,
    ),
    apiOrigin: httpsOrigin(
      required(source, "ATLAS_API_URL"),
      "ATLAS_API_URL",
      development,
    ),
    devOperatorEmail,
    operators: operatorList(required(source, "ATLAS_PLATFORM_OPERATOR_EMAILS")),
    signingKey: signingKey(required(source, "ATLAS_ADMIN_SIGNING_KEY")),
  };
}
