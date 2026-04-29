import { useDirtyFormGuard } from "@/platform/hooks/use-dirty-form-guard";
import type { AtlasOrganizationDetails } from "../../organization-contracts";
import type {
  WorkspaceOIDCSetupFormState,
  WorkspaceSAMLSetupFormState,
} from "./organization-page-controller";
import { WorkspaceSSOOidcForm } from "./workspace-sso-oidc-form";
import { WorkspaceSSOProviderList } from "./workspace-sso-provider-list";
import { WorkspaceSSOSamlForm } from "./workspace-sso-saml-form";

/**
 * Props for the enterprise SSO management section.
 */
interface WorkspaceSSOSectionProps {
  canManageOrganization: boolean;
  domainVerificationTokens: Record<string, string>;
  isPending: boolean;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
  organization: AtlasOrganizationDetails;
  samlAllowedIssuerOrigins: readonly string[];
  samlSetupForm: WorkspaceSAMLSetupFormState;
  samlVerificationTimedOutProviderIds?: readonly string[];
  setOidcSetupForm: (
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) => void;
  setSamlSetupForm: (
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) => void;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onOidcSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onRotateSAMLCertificate: (providerId: string, certificate: string) => Promise<void>;
  onSamlSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onVerifyDomain: (providerId: string) => Promise<void>;
}

/**
 * Enterprise SSO management surface for team workspaces.  Renders the
 * intro card, the configured-provider list, and the OIDC + SAML
 * registration forms; the dirty-form guard prevents losing in-progress
 * edits when the operator switches workspaces or hits Back.
 */
export function WorkspaceSSOSection({
  canManageOrganization,
  domainVerificationTokens,
  isPending,
  oidcSetupForm,
  organization,
  samlAllowedIssuerOrigins,
  samlSetupForm,
  samlVerificationTimedOutProviderIds,
  setOidcSetupForm,
  setSamlSetupForm,
  onDeleteProvider,
  onOidcSubmit,
  onRequestDomainVerification,
  onRotateSAMLCertificate,
  onSamlSubmit,
  onSavePrimaryProvider,
  onVerifyDomain,
}: WorkspaceSSOSectionProps) {
  const { setup } = organization.sso;

  // Forms count as dirty when any user-entered field has content.  The
  // guard stops a navigation away from the SSO surface — workspace switch
  // or browser back — when those edits would be lost on next render.
  const oidcFormDirty =
    !isPending &&
    Boolean(
      oidcSetupForm.domain.trim() ||
      oidcSetupForm.clientId.trim() ||
      oidcSetupForm.clientSecret.trim() ||
      oidcSetupForm.providerId.trim(),
    );
  const samlFormDirty =
    !isPending &&
    Boolean(
      samlSetupForm.domain.trim() ||
      samlSetupForm.issuer.trim() ||
      samlSetupForm.entryPoint.trim() ||
      samlSetupForm.certificate.trim() ||
      samlSetupForm.providerId.trim(),
    );
  useDirtyFormGuard(canManageOrganization && (oidcFormDirty || samlFormDirty));

  return (
    <section className="space-y-6">
      <article className="border-outline bg-surface space-y-4 rounded-[1.5rem] border p-6">
        <div className="space-y-2">
          <h2 className="type-title-large text-on-surface">Enterprise SSO</h2>
          <p className="type-body-medium text-outline">
            Configure enterprise sign-in for your team. Atlas generates the provider IDs and
            callback URLs to copy directly into Google Workspace or any SAML 2.0 admin console.
          </p>
        </div>
      </article>

      <WorkspaceSSOProviderList
        canManageOrganization={canManageOrganization}
        domainVerificationTokens={domainVerificationTokens}
        isPending={isPending}
        organization={organization}
        verificationTimedOutProviderIds={samlVerificationTimedOutProviderIds ?? []}
        onDeleteProvider={onDeleteProvider}
        onRequestDomainVerification={onRequestDomainVerification}
        onRotateSAMLCertificate={onRotateSAMLCertificate}
        onSavePrimaryProvider={onSavePrimaryProvider}
        onVerifyDomain={onVerifyDomain}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <WorkspaceSSOOidcForm
          canManageOrganization={canManageOrganization}
          isPending={isPending}
          oidcSetupForm={oidcSetupForm}
          setOidcSetupForm={setOidcSetupForm}
          setup={setup}
          onOidcSubmit={onOidcSubmit}
        />
        <WorkspaceSSOSamlForm
          canManageOrganization={canManageOrganization}
          isPending={isPending}
          samlAllowedIssuerOrigins={samlAllowedIssuerOrigins}
          samlSetupForm={samlSetupForm}
          setSamlSetupForm={setSamlSetupForm}
          setup={setup}
          onSamlSubmit={onSamlSubmit}
        />
      </div>
    </section>
  );
}
