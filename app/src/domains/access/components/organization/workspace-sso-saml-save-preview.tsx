import type { WorkspaceSAMLSetupFormState } from "./organization-page-controller";
import { SaveButtonWithMissingFields } from "./workspace-sso-save-button";

interface WorkspaceSSOSamlSavePreviewProps {
  fallbackProviderId: string;
  isPending: boolean;
  samlCertificateLooksValid: boolean;
  samlIssuerAllowed: boolean;
  samlSetupForm: WorkspaceSAMLSetupFormState;
}

/**
 * Footer block on the SAML form: the "Atlas will save" preview card
 * (only shown when every required field passes validation), the multi-
 * domain support note, and the missing-field-aware submit button.
 */
export function WorkspaceSSOSamlSavePreview({
  fallbackProviderId,
  isPending,
  samlCertificateLooksValid,
  samlIssuerAllowed,
  samlSetupForm,
}: WorkspaceSSOSamlSavePreviewProps) {
  const previewReady =
    Boolean(samlSetupForm.domain.trim()) &&
    Boolean(samlSetupForm.issuer.trim()) &&
    Boolean(samlSetupForm.entryPoint.trim()) &&
    samlCertificateLooksValid &&
    samlIssuerAllowed;

  const missing: string[] = [];
  if (!samlSetupForm.domain.trim()) missing.push("workspace domain");
  if (!samlSetupForm.issuer.trim()) missing.push("issuer");
  else if (!samlIssuerAllowed) missing.push("issuer on allowlist");
  if (!samlSetupForm.entryPoint.trim()) missing.push("sign-in URL");
  if (!samlCertificateLooksValid) missing.push("valid PEM certificate");
  if (!samlSetupForm.providerId.trim()) missing.push("provider ID");

  return (
    <>
      {previewReady ? (
        <div className="border-outline-variant bg-surface-container-lowest rounded-2xl border px-4 py-3">
          <p className="type-label-medium text-on-surface mb-1">Atlas will save:</p>
          <ul className="type-body-small text-outline space-y-0.5">
            <li>Domain: {samlSetupForm.domain.trim()}</li>
            <li>Issuer: {samlSetupForm.issuer.trim()}</li>
            <li>Sign-in URL: {samlSetupForm.entryPoint.trim()}</li>
            <li>Provider ID: {samlSetupForm.providerId.trim() || fallbackProviderId}</li>
          </ul>
        </div>
      ) : null}
      <p className="type-body-small text-outline">
        Need to verify multiple domains for the same SAML IdP? Configure one provider per domain or{" "}
        <a
          href="mailto:hello@rebuildingus.org?subject=Atlas%20SAML%20multi-domain"
          className="underline"
        >
          email Atlas operators
        </a>{" "}
        to enable multi-domain on this provider.
      </p>
      <SaveButtonWithMissingFields
        isPending={isPending}
        label="Save SAML provider"
        missing={missing}
        pendingLabel="Saving..."
      />
    </>
  );
}
