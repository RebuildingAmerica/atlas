import type { AtlasOrganizationDetails } from "../../organization-contracts";
import type {
  WorkspaceOIDCSetupFormState,
  WorkspaceSAMLSetupFormState,
} from "./organization-page-types";
import { WorkspaceSSODomainHint } from "./workspace-sso-domain-hint";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";
import { WorkspaceSSOProviderList } from "./workspace-sso-provider-list";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { Textarea } from "@/platform/ui/textarea";

/**
 * Props for the enterprise SSO management section.
 */
interface WorkspaceSSOSectionProps {
  canManageOrganization: boolean;
  domainVerificationTokens: Record<string, string>;
  isPending: boolean;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
  organization: AtlasOrganizationDetails;
  samlSetupForm: WorkspaceSAMLSetupFormState;
  setOidcSetupForm: (
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) => void;
  setSamlSetupForm: (
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) => void;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onOidcSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onSamlSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onVerifyDomain: (providerId: string) => Promise<void>;
}

/**
 * Enterprise SSO management surface for team workspaces.
 */
export function WorkspaceSSOSection({
  canManageOrganization,
  domainVerificationTokens,
  isPending,
  oidcSetupForm,
  organization,
  samlSetupForm,
  setOidcSetupForm,
  setSamlSetupForm,
  onDeleteProvider,
  onOidcSubmit,
  onRequestDomainVerification,
  onSamlSubmit,
  onSavePrimaryProvider,
  onVerifyDomain,
}: WorkspaceSSOSectionProps) {
  const { setup } = organization.sso;
  const hasWorkspaceDomainSuggestion = Boolean(setup.workspaceDomainSuggestion);

  return (
    <section className="space-y-6">
      <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Enterprise SSO</h2>
          <p className="type-body-medium text-ink-soft">
            Atlas keeps team sign-in explicit. The workspace domain stays editable, while Atlas
            suggests it from the signed-in operator email and generates the provider IDs and
            callback URLs you can copy directly into Google Workspace or any SAML 2.0 admin console.
          </p>
        </div>

        <div className="border-border bg-surface-container-lowest rounded-[1.25rem] border p-4">
          <p className="type-title-small text-ink-strong">How Better Auth SSO works</p>
          <p className="type-body-medium text-ink-soft mt-2">
            Each provider is linked to this workspace by Better Auth. Atlas uses the verified domain
            and the workspace primary-provider setting to route sign-in attempts through the right
            OIDC or SAML flow, then Better Auth provisions successful users into the organization as
            members.
          </p>
        </div>
      </article>

      <WorkspaceSSOProviderList
        canManageOrganization={canManageOrganization}
        domainVerificationTokens={domainVerificationTokens}
        isPending={isPending}
        organization={organization}
        onDeleteProvider={onDeleteProvider}
        onRequestDomainVerification={onRequestDomainVerification}
        onSavePrimaryProvider={onSavePrimaryProvider}
        onVerifyDomain={onVerifyDomain}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <article className="border-border-strong bg-surface space-y-5 rounded-[1.5rem] border p-6">
          <div className="space-y-2">
            <h3 className="type-title-large text-ink-strong">Google Workspace OIDC</h3>
            <p className="type-body-medium text-ink-soft">
              Use this when the customer wants Google Workspace managed sign-in with Google as the
              OpenID Connect identity provider.
            </p>
          </div>

          <ol className="type-body-medium text-ink-soft list-decimal space-y-2 pl-5">
            <li>Create or open the Google Cloud OAuth client for this workspace.</li>
            <li>Paste the redirect URI and issuer details shown below into Google.</li>
            <li>Paste the workspace domain, client ID, and client secret into Atlas.</li>
            <li>
              Save the provider, publish the DNS TXT verification record, then verify it here.
            </li>
          </ol>

          <div className="grid gap-3">
            <WorkspaceSSOCopyField label="Google issuer" value={setup.googleWorkspaceIssuer} />
            <WorkspaceSSOCopyField
              label="Requested scopes"
              value={setup.googleWorkspaceScopes.join(" ")}
            />
            <WorkspaceSSOCopyField
              label="Suggested provider ID"
              value={setup.oidcProviderIdSuggestion}
            />
            <WorkspaceSSOCopyField label="Authorized redirect URI" value={setup.oidcRedirectUrl} />
          </div>

          {canManageOrganization ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                void onOidcSubmit(e);
              }}
            >
              <Input
                label="Workspace domain"
                value={oidcSetupForm.domain}
                onChange={(value) => {
                  setOidcSetupForm((current) => ({
                    ...current,
                    domain: value,
                  }));
                }}
                placeholder={setup.workspaceDomainSuggestion || "your-org.example"}
              />
              {hasWorkspaceDomainSuggestion ? (
                <WorkspaceSSODomainHint suggestion={setup.workspaceDomainSuggestion} />
              ) : null}
              <Input
                label="Provider ID"
                value={oidcSetupForm.providerId}
                onChange={(value) => {
                  setOidcSetupForm((current) => ({
                    ...current,
                    providerId: value,
                  }));
                }}
                placeholder={setup.oidcProviderIdSuggestion}
              />
              <Input
                label="Client ID"
                value={oidcSetupForm.clientId}
                onChange={(value) => {
                  setOidcSetupForm((current) => ({
                    ...current,
                    clientId: value,
                  }));
                }}
              />
              <Input
                label="Client secret"
                type="password"
                value={oidcSetupForm.clientSecret}
                onChange={(value) => {
                  setOidcSetupForm((current) => ({
                    ...current,
                    clientSecret: value,
                  }));
                }}
              />
              <label className="text-ink-soft flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={oidcSetupForm.setAsPrimary}
                  onChange={(event) => {
                    const isChecked = event.target.checked;

                    setOidcSetupForm((current) => ({
                      ...current,
                      setAsPrimary: isChecked,
                    }));
                  }}
                />
                Set this as the workspace primary provider
              </label>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !oidcSetupForm.clientId.trim() ||
                  !oidcSetupForm.clientSecret.trim() ||
                  !oidcSetupForm.domain.trim() ||
                  !oidcSetupForm.providerId.trim()
                }
              >
                {isPending ? "Saving..." : "Save Google Workspace OIDC"}
              </Button>
            </form>
          ) : (
            <p className="type-body-medium text-ink-soft">
              Only owners and admins can register enterprise providers.
            </p>
          )}
        </article>

        <article className="border-border-strong bg-surface space-y-5 rounded-[1.5rem] border p-6">
          <div className="space-y-2">
            <h3 className="type-title-large text-ink-strong">SAML 2.0</h3>
            <p className="type-body-medium text-ink-soft">
              Use this when the customer wants a SAML app in Google Workspace or another enterprise
              identity provider and needs Atlas to act as the service provider.
            </p>
          </div>

          <ol className="type-body-medium text-ink-soft list-decimal space-y-2 pl-5">
            <li>Create a custom SAML app in the customer identity provider.</li>
            <li>Paste the ACS URL, metadata URL, and entity ID shown below into that app.</li>
            <li>Copy the IdP issuer, sign-in URL, and certificate back into Atlas.</li>
            <li>
              Save the provider, publish the DNS TXT verification record, then verify it here.
            </li>
          </ol>

          <div className="grid gap-3">
            <WorkspaceSSOCopyField
              label="Suggested provider ID"
              value={setup.samlProviderIdSuggestion}
            />
            <WorkspaceSSOCopyField label="ACS URL" value={setup.samlAcsUrl} />
            <WorkspaceSSOCopyField label="SP metadata URL" value={setup.samlMetadataUrl} />
            <WorkspaceSSOCopyField label="Entity ID / audience" value={setup.samlEntityId} />
          </div>

          {canManageOrganization ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                void onSamlSubmit(e);
              }}
            >
              <Input
                label="Workspace domain"
                value={samlSetupForm.domain}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({
                    ...current,
                    domain: value,
                  }));
                }}
                placeholder={setup.workspaceDomainSuggestion || "your-org.example"}
              />
              {hasWorkspaceDomainSuggestion ? (
                <WorkspaceSSODomainHint suggestion={setup.workspaceDomainSuggestion} />
              ) : null}
              <Input
                label="Provider ID"
                value={samlSetupForm.providerId}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({
                    ...current,
                    providerId: value,
                  }));
                }}
                placeholder={setup.samlProviderIdSuggestion}
              />
              <Input
                label="Identity provider issuer"
                value={samlSetupForm.issuer}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({
                    ...current,
                    issuer: value,
                  }));
                }}
                placeholder="https://accounts.google.com/o/saml2?idpid=..."
              />
              <Input
                label="Identity provider sign-in URL"
                value={samlSetupForm.entryPoint}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({
                    ...current,
                    entryPoint: value,
                  }));
                }}
                placeholder="https://accounts.google.com/o/saml2/idp?idpid=..."
              />
              <Textarea
                label="X.509 certificate"
                rows={8}
                value={samlSetupForm.certificate}
                onChange={(value) => {
                  setSamlSetupForm((current) => ({
                    ...current,
                    certificate: value,
                  }));
                }}
                placeholder="-----BEGIN CERTIFICATE-----"
              />
              <label className="text-ink-soft flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={samlSetupForm.setAsPrimary}
                  onChange={(event) => {
                    const isChecked = event.target.checked;

                    setSamlSetupForm((current) => ({
                      ...current,
                      setAsPrimary: isChecked,
                    }));
                  }}
                />
                Set this as the workspace primary provider
              </label>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !samlSetupForm.certificate.trim() ||
                  !samlSetupForm.domain.trim() ||
                  !samlSetupForm.entryPoint.trim() ||
                  !samlSetupForm.issuer.trim() ||
                  !samlSetupForm.providerId.trim()
                }
              >
                {isPending ? "Saving..." : "Save SAML provider"}
              </Button>
            </form>
          ) : (
            <p className="type-body-medium text-ink-soft">
              Only owners and admins can register enterprise providers.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
