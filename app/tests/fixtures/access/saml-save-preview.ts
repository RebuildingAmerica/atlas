import type { WorkspaceSAMLSetupFormState } from "@/domains/access/components/organization/organization-page-controller";

export interface SamlSavePreviewFormOverrides {
  domain?: string;
  issuer?: string;
  entryPoint?: string;
  providerId?: string;
}

/**
 * Builds a minimally-populated WorkspaceSAMLSetupFormState fixture for the
 * workspace-sso-saml-save-preview tests.  Defaults to a fully-valid form so
 * each individual test only has to set the field it wants to invalidate.
 */
export function buildSamlSavePreviewForm(
  overrides: SamlSavePreviewFormOverrides = {},
): WorkspaceSAMLSetupFormState {
  return {
    domain: overrides.domain ?? "acme.example",
    issuer: overrides.issuer ?? "https://idp.acme.example",
    entryPoint: overrides.entryPoint ?? "https://idp.acme.example/sso",
    providerId: overrides.providerId ?? "saml-acme",
    certificate: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----",
    expiresAt: null,
    isPrimary: false,
  } as unknown as WorkspaceSAMLSetupFormState;
}
