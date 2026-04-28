/**
 * Recognised Better Auth SSO error codes Atlas surfaces with admin-readable
 * copy.  Codes outside this list fall back to a generic message; the raw
 * code is recorded alongside in the diagnostics log so an admin can match
 * it against IdP traces.
 */
export const SSO_ERROR_CODES = {
  ACCESS_DENIED: "access_denied",
  CERTIFICATE_INVALID: "certificate_invalid",
  DOMAIN_NOT_VERIFIED: "domain_not_verified",
  EMAIL_NOT_FOUND: "email_not_found",
  EMAIL_NOT_VERIFIED: "email_not_verified",
  IDP_RESPONSE_INVALID: "idp_response_invalid",
  PROVIDER_NOT_FOUND: "provider_not_found",
  SIGNATURE_INVALID: "signature_invalid",
  TOKEN_EXPIRED: "token_expired",
  USER_NOT_PROVISIONED: "user_not_provisioned",
} as const;

export type AtlasSsoErrorCode = (typeof SSO_ERROR_CODES)[keyof typeof SSO_ERROR_CODES];

const MESSAGES: Record<AtlasSsoErrorCode, string> = {
  [SSO_ERROR_CODES.ACCESS_DENIED]:
    "Your identity provider denied the sign-in request.  Confirm the SAML or OIDC app at the IdP is active and assigned to your account.",
  [SSO_ERROR_CODES.CERTIFICATE_INVALID]:
    "Atlas could not validate the IdP signing certificate.  Have a workspace admin rotate the certificate from the SSO setup page.",
  [SSO_ERROR_CODES.DOMAIN_NOT_VERIFIED]:
    "Your workspace domain hasn't been verified yet.  Have a workspace admin publish the DNS TXT record from the SSO setup page.",
  [SSO_ERROR_CODES.EMAIL_NOT_FOUND]:
    "Atlas couldn't find an account for this email.  Ask a workspace admin to invite you, or sign up with the address your team uses.",
  [SSO_ERROR_CODES.EMAIL_NOT_VERIFIED]:
    "Your IdP returned an email that isn't marked verified.  Confirm the address is verified at the IdP and try again.",
  [SSO_ERROR_CODES.IDP_RESPONSE_INVALID]:
    "Atlas couldn't parse the response from your identity provider.  Have a workspace admin run the SAML health check from the provider card.",
  [SSO_ERROR_CODES.PROVIDER_NOT_FOUND]:
    "Atlas couldn't find a matching SSO provider for this workspace.  Have a workspace admin re-register the provider on the SSO setup page.",
  [SSO_ERROR_CODES.SIGNATURE_INVALID]:
    "The SAML assertion signature didn't validate.  Re-check the IdP signing certificate and audience values.",
  [SSO_ERROR_CODES.TOKEN_EXPIRED]:
    "The sign-in attempt expired before Atlas could validate it.  Try again — clock skew between the IdP and Atlas can also cause this.",
  [SSO_ERROR_CODES.USER_NOT_PROVISIONED]:
    "Your IdP user isn't provisioned for Atlas yet.  Ask a workspace admin to grant you access in the SSO app at the IdP.",
};

/**
 * Returns a human-readable message for a Better Auth SSO error code, or
 * null when the code is unknown.  Callers should fall back to a generic
 * "couldn't complete sign-in" message and surface the raw code separately
 * for support purposes.
 */
export function describeSsoError(rawCode: string | null | undefined): string | null {
  if (!rawCode) return null;
  const normalized = rawCode.toLowerCase();
  const knownCode = Object.values(SSO_ERROR_CODES).find((code) => code === normalized);
  return knownCode ? MESSAGES[knownCode] : null;
}
