/**
 * The contract every identity-aware gate in front of an Atlas internal app
 * satisfies. The gate decides who may reach the app at all; the app's own
 * authorization still decides what that person may do.
 */

/** A person the gate signed in. */
export interface PerimeterPrincipal {
  plane: "staff";
  /** The gate's stable identifier for the person. */
  subject: string;
  /** Lowercased email the identity provider vouched for. */
  email: string;
  /** Who issued the assertion, such as `https://<team>.cloudflareaccess.com`. */
  issuer: string;
}

/** Why a request was refused. Logged server side, never shown to the caller. */
export type PerimeterRefusalReason =
  | "bad_signature"
  | "expired"
  | "key_fetch_failed"
  | "malformed"
  | "missing"
  | "no_email"
  | "not_yet_valid"
  | "service_token"
  | "unknown_key"
  | "wrong_algorithm"
  | "wrong_audience"
  | "wrong_issuer";

export type PerimeterResult =
  | { ok: true; principal: PerimeterPrincipal }
  | { ok: false; reason: PerimeterRefusalReason };

export interface PerimeterVerifier {
  verify(request: Request): Promise<PerimeterResult>;
}
