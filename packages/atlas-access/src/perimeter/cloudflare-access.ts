/**
 * The internal app's own check of Cloudflare Access: the second lock behind
 * Access itself.
 *
 * Access signs in an operator through Google Workspace and adds a signed token
 * to every request it lets through, in the `Cf-Access-Jwt-Assertion` header.
 * The token is good only when it is signed with RS256 by one of the team's
 * published keys, was issued by the team for this application (its `aud`
 * holds the application's audience tag), is current, and names a person by
 * email. A service token, which names a client rather than a person, never
 * becomes a staff principal.
 *
 * The cookie Access also sets is ignored: Cloudflare recommends validating the
 * header, and the header is what Access adds after its own checks.
 *
 * https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import type { PerimeterResult, PerimeterVerifier } from "./perimeter";

export interface AccessConfig {
  /** The team's host, `<team>.cloudflareaccess.com`. */
  teamDomain: string;
  /** The application's audience tag. */
  audience: string;
}

interface AccessEnv {
  ATLAS_ACCESS_TEAM_DOMAIN?: string;
  ATLAS_ACCESS_AUD?: string;
}

interface VerifierOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

type Claims = Record<string, unknown>;

/** The team's keys are kept for an hour; Access rotates them every six weeks. */
const KEYS_FOR_MS = 3_600_000;
/** A token naming an unknown key refetches at most once a minute, so forged tokens cannot make every request fetch. */
const REFETCH_AFTER_MS = 60_000;
/** Allowed difference between Cloudflare's clock and ours, for "not before". */
const CLOCK_SKEW_S = 60;

const TEAM_DOMAIN_PATTERN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const AUDIENCE_PATTERN = /^[a-f0-9]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The team's host from a domain written with or without a scheme, a trailing slash or capitals. */
function teamHost(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Reads and checks the Access settings. Missing or malformed settings throw,
 * so a misconfigured app fails at startup instead of serving an open door.
 */
export function parseAccessConfig(env: AccessEnv): AccessConfig {
  const rawDomain = env.ATLAS_ACCESS_TEAM_DOMAIN?.trim();
  if (!rawDomain) throw new Error("ATLAS_ACCESS_TEAM_DOMAIN is required.");
  const audience = env.ATLAS_ACCESS_AUD?.trim();
  if (!audience) throw new Error("ATLAS_ACCESS_AUD is required.");
  const teamDomain = teamHost(rawDomain);
  if (!TEAM_DOMAIN_PATTERN.test(teamDomain)) {
    throw new Error(
      "ATLAS_ACCESS_TEAM_DOMAIN must be a <team>.cloudflareaccess.com host.",
    );
  }
  if (!AUDIENCE_PATTERN.test(audience)) {
    throw new Error(
      "ATLAS_ACCESS_AUD must be the 64-character application audience tag.",
    );
  }
  return { audience, teamDomain };
}

function decodeBase64url(segment: string): Uint8Array<ArrayBuffer> {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeObject(segment: string): Claims | null {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder().decode(decodeBase64url(segment)),
    );
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Claims)
      : null;
  } catch {
    return null;
  }
}

function audienceMatches(aud: unknown, expected: string): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Verifies the Access assertion on each request against one team and one
 * application. Keep one instance per process so its key cache is shared.
 */
export class CloudflareAccessVerifier implements PerimeterVerifier {
  private keySet: KeySet | null = null;
  private readonly fetchCerts: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: AccessConfig,
    options: VerifierOptions = {},
  ) {
    this.fetchCerts = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async verify(request: Request): Promise<PerimeterResult> {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return { ok: false, reason: "missing" };

    const segments = token.split(".");
    if (segments.length !== 3) return { ok: false, reason: "malformed" };
    const [head = "", body = "", signature = ""] = segments;
    const header = decodeObject(head);
    const claims = decodeObject(body);
    if (!header || !claims) return { ok: false, reason: "malformed" };
    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      return { ok: false, reason: "wrong_algorithm" };
    }

    const refusal = this.checkClaims(claims);
    if (refusal) return refusal;

    let key: CryptoKey | null;
    try {
      key = await this.keyFor(header.kid);
    } catch {
      // Neither the token nor the provider's error body belongs in logs.
      return { ok: false, reason: "key_fetch_failed" };
    }
    if (!key) return { ok: false, reason: "unknown_key" };

    const signed = new TextEncoder().encode(`${head}.${body}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64url(signature),
      signed,
    );
    if (!valid) return { ok: false, reason: "bad_signature" };

    return {
      ok: true,
      principal: {
        email: (claims.email as string).trim().toLowerCase(),
        issuer: `https://${this.config.teamDomain}`,
        plane: "staff",
        subject: typeof claims.sub === "string" ? claims.sub : "",
      },
    };
  }

  /** Cheap checks that run before any key is fetched. */
  private checkClaims(claims: Claims): PerimeterResult | null {
    const seconds = this.now() / 1000;
    const { aud, email, exp, iss, nbf } = claims;
    if (!audienceMatches(aud, this.config.audience))
      return { ok: false, reason: "wrong_audience" };
    if (iss !== `https://${this.config.teamDomain}`)
      return { ok: false, reason: "wrong_issuer" };
    if (!isFiniteNumber(exp) || exp <= seconds)
      return { ok: false, reason: "expired" };
    if (
      Object.hasOwn(claims, "nbf") &&
      (!isFiniteNumber(nbf) || nbf > seconds + CLOCK_SKEW_S)
    ) {
      return { ok: false, reason: "not_yet_valid" };
    }
    if (email === undefined && typeof claims.common_name === "string") {
      return { ok: false, reason: "service_token" };
    }
    if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
      return { ok: false, reason: "no_email" };
    }
    return null;
  }

  private async keyFor(kid: string): Promise<CryptoKey | null> {
    const now = this.now();
    let set = this.keySet;
    const stale = !set || now - set.fetchedAt > KEYS_FOR_MS;
    const unknown =
      set && !set.keys.has(kid) && now - set.fetchedAt > REFETCH_AFTER_MS;
    if (stale || unknown) set = await this.fetchKeys(now);
    return set?.keys.get(kid) ?? null;
  }

  private async fetchKeys(now: number): Promise<KeySet> {
    const response = await this.fetchCerts(
      `https://${this.config.teamDomain}/cdn-cgi/access/certs`,
    );
    if (!response.ok)
      throw new Error(`Access certs answered ${String(response.status)}`);
    const body = (await response.json()) as {
      keys?: (JsonWebKey & { kid?: string })[];
    };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== "RSA" || !jwk.kid) continue;
      const { kid, ...material } = jwk;
      keys.set(
        kid,
        await crypto.subtle.importKey(
          "jwk",
          material,
          { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
          false,
          ["verify"],
        ),
      );
    }
    const set = { fetchedAt: now, keys };
    this.keySet = set;
    return set;
  }
}
