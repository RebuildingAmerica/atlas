/**
 * Pure helpers shared by the workspace SSO setup forms.  Kept out of the
 * surrounding component files so the validation / classification logic can
 * be unit-tested without spinning up React, and so the form components stay
 * focused on layout and event wiring.
 */

/**
 * Common consumer-mailbox domains.  Atlas can route through SSO with these
 * registered, but a verified-domain check on `gmail.com` (or similar) is
 * almost certainly a workspace-domain misconfiguration; flag it so the
 * admin gets a chance to swap in their company's own DNS-controlled
 * domain.
 */
const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "ymail.com",
]);

/**
 * Returns true when `domain` is a consumer-mailbox host Atlas should warn
 * the admin about before they wire SSO to it.
 */
export function isLikelyFreeEmailDomain(domain: string): boolean {
  const lowered = domain.trim().toLowerCase();
  return lowered.length > 0 && FREE_EMAIL_DOMAINS.has(lowered);
}

export type PemCertificateClassification =
  | { kind: "empty" }
  | { kind: "ok"; bodyLines: number }
  | { kind: "invalid"; reason: string };

/**
 * Lightweight check that the pasted X.509 certificate at least has PEM
 * framing.  Atlas does not parse ASN.1 client-side — Better Auth does that
 * post-registration and surfaces the parsed details (subject, expiry, key
 * algorithm) in the provider list — but a quick frame check catches the
 * most common paste mistakes before submit.
 *
 * @param certificate - The candidate certificate text from the SAML form.
 */
export function classifyPemCertificate(certificate: string): PemCertificateClassification {
  const trimmed = certificate.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }
  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]?.trim() ?? "";
  const footer = lines[lines.length - 1]?.trim() ?? "";
  if (!header.startsWith("-----BEGIN") || !header.endsWith("-----")) {
    return {
      kind: "invalid",
      reason: "Certificate is missing the -----BEGIN CERTIFICATE----- header.",
    };
  }
  if (!footer.startsWith("-----END") || !footer.endsWith("-----")) {
    return {
      kind: "invalid",
      reason: "Certificate is missing the -----END CERTIFICATE----- footer.",
    };
  }
  const bodyLines = lines.slice(1, -1).filter((line) => line.trim().length > 0);
  if (bodyLines.length === 0) {
    return { kind: "invalid", reason: "Certificate body is empty." };
  }
  const body = bodyLines.join("");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
    return {
      kind: "invalid",
      reason: "Certificate body has non-base64 characters.",
    };
  }
  return { kind: "ok", bodyLines: bodyLines.length };
}

/**
 * Returns the candidate SAML issuer's origin when the value parses as a
 * URL, otherwise null.  The allowlist is matched by URL origin so per-tenant
 * query parameters do not need to be enumerated.
 *
 * @param issuer - The candidate SAML issuer URL pasted by the workspace
 *   admin.
 */
export function extractIssuerOrigin(issuer: string): string | null {
  const trimmed = issuer.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}
