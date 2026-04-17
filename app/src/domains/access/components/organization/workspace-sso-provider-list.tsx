import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Button } from "@/platform/ui/button";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";

/**
 * Props for the configured SSO provider list.
 */
interface WorkspaceSSOProviderListProps {
  canManageOrganization: boolean;
  domainVerificationTokens: Record<string, string>;
  isPending: boolean;
  organization: AtlasOrganizationDetails;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onVerifyDomain: (providerId: string) => Promise<void>;
}

/**
 * Lists the configured enterprise providers for the active team workspace.
 */
export function WorkspaceSSOProviderList({
  canManageOrganization,
  domainVerificationTokens,
  isPending,
  onDeleteProvider,
  onRequestDomainVerification,
  onSavePrimaryProvider,
  onVerifyDomain,
  organization,
}: WorkspaceSSOProviderListProps) {
  const providers = organization.sso.providers;

  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h3 className="type-title-large text-ink-strong">Configured providers</h3>
        <p className="type-body-medium text-ink-soft">
          Every saved provider stays visible here with its verification status and the exact values
          Atlas expects the operator to copy into the identity provider.
        </p>
      </div>

      {providers.length === 0 ? (
        <div className="border-border bg-surface-container-lowest rounded-[1.25rem] border p-4">
          <p className="type-title-small text-ink-strong">No enterprise providers yet</p>
          <p className="type-body-medium text-ink-soft mt-2">
            Save either Google Workspace OIDC or SAML below to enable organization-managed sign-in.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => {
            const verificationToken = domainVerificationTokens[provider.providerId] ?? "";

            return (
              <article
                key={provider.providerId}
                className="border-border space-y-4 rounded-[1.25rem] border bg-white/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="type-title-small text-ink-strong">{provider.providerId}</p>
                    <p className="type-body-medium text-ink-soft">
                      {provider.providerType.toUpperCase()} · {provider.domain}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {provider.isPrimary ? (
                      <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
                        Primary
                      </span>
                    ) : null}
                    <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
                      {provider.domainVerified ? "Domain verified" : "Verification pending"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <WorkspaceSSOCopyField label="Workspace domain" value={provider.domain} />
                  <WorkspaceSSOCopyField label="Issuer" value={provider.issuer} />
                  <WorkspaceSSOCopyField label="Provider ID" value={provider.providerId} />
                  <WorkspaceSSOCopyField
                    label="Verification host"
                    value={provider.domainVerificationHost}
                  />
                  <WorkspaceSSOCopyField label="SP metadata URL" value={provider.spMetadataUrl} />
                  {provider.providerType === "saml" ? (
                    <WorkspaceSSOCopyField
                      label="ACS URL"
                      value={provider.saml?.callbackUrl ?? ""}
                    />
                  ) : (
                    <WorkspaceSSOCopyField
                      label="Discovery endpoint"
                      value={provider.oidc?.discoveryEndpoint ?? ""}
                    />
                  )}
                </div>

                {provider.providerType === "saml" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <WorkspaceSSOCopyField
                      label="Audience / Entity ID"
                      value={provider.saml?.audience ?? provider.spMetadataUrl}
                    />
                    <WorkspaceSSOCopyField
                      label="IdP entry point"
                      value={provider.saml?.entryPoint ?? ""}
                    />
                    {provider.saml?.certificate.fingerprintSha256 ? (
                      <WorkspaceSSOCopyField
                        label="Certificate fingerprint"
                        value={provider.saml.certificate.fingerprintSha256}
                      />
                    ) : null}
                    {provider.saml?.certificate.errorMessage ? (
                      <WorkspaceSSOCopyField
                        label="Certificate parse status"
                        value={provider.saml.certificate.errorMessage}
                      />
                    ) : null}
                  </div>
                ) : null}

                {!provider.domainVerified ? (
                  <div className="border-border bg-surface-container-lowest space-y-3 rounded-[1rem] border p-4">
                    <p className="type-title-small text-ink-strong">DNS verification record</p>
                    <p className="type-body-medium text-ink-soft">
                      Create a TXT record for the host below. If you need a fresh token, generate
                      one here and Atlas will show the exact value to paste.
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <WorkspaceSSOCopyField
                        label="TXT host"
                        value={provider.domainVerificationHost}
                      />
                      <WorkspaceSSOCopyField
                        label="TXT value"
                        value={
                          verificationToken ||
                          "Generate a verification token here to reveal the exact TXT value."
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {canManageOrganization ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {!provider.isPrimary ? (
                      <Button
                        variant="secondary"
                        disabled={isPending}
                        onClick={() => {
                          void onSavePrimaryProvider(provider.providerId);
                        }}
                      >
                        Make primary
                      </Button>
                    ) : null}
                    {!provider.domainVerified ? (
                      <>
                        <Button
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => {
                            void onRequestDomainVerification(provider.providerId);
                          }}
                        >
                          Generate verification token
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => {
                            void onVerifyDomain(provider.providerId);
                          }}
                        >
                          Verify domain
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        void onDeleteProvider(provider.providerId);
                      }}
                    >
                      Remove provider
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </article>
  );
}
