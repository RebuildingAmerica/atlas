import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Button } from "@/platform/ui/button";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";

/**
 * Formats an ISO timestamp returned by Better Auth's certificate parser into a
 * stable, human-friendly expiry label that does not depend on the user's
 * locale.
 *
 * @param isoTimestamp - The certificate `notAfter` value from Better Auth.
 */
function formatCertificateExpiry(isoTimestamp: string): string {
  const expiry = new Date(isoTimestamp);
  if (Number.isNaN(expiry.getTime())) {
    return isoTimestamp;
  }
  const now = Date.now();
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const daysUntilExpiry = Math.round((expiry.getTime() - now) / millisecondsPerDay);
  const datePart = expiry.toISOString().slice(0, 10);
  if (daysUntilExpiry < 0) {
    return `${datePart} (expired ${Math.abs(daysUntilExpiry)}d ago)`;
  }
  return `${datePart} (in ${daysUntilExpiry}d)`;
}

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
    <article className="border-outline bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h3 className="type-title-large text-on-surface">Configured providers</h3>
        <p className="type-body-medium text-outline">
          Every saved provider shows its verification status and the values you need to copy into
          your identity provider.
        </p>
      </div>

      {providers.length === 0 ? (
        <div className="border-outline-variant bg-surface-container-lowest rounded-[1.25rem] border p-4">
          <p className="type-title-small text-on-surface">No enterprise providers yet</p>
          <p className="type-body-medium text-outline mt-2">
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
                className="border-outline-variant space-y-4 rounded-[1.25rem] border bg-white/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="type-title-small text-on-surface">{provider.providerId}</p>
                    <p className="type-body-medium text-outline">
                      {provider.providerType.toUpperCase()} · {provider.domain}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {provider.isPrimary ? (
                      <span className="type-label-large border-outline-variant text-outline rounded-full border px-3 py-1">
                        Primary
                      </span>
                    ) : null}
                    <span className="type-label-large border-outline-variant text-outline rounded-full border px-3 py-1">
                      {provider.domainVerified ? "Domain verified" : "Verification pending"}
                    </span>
                    {provider.providerType === "saml" ? (
                      <span
                        className="type-label-large border-outline-variant text-outline rounded-full border px-3 py-1"
                        title={
                          provider.saml?.authnRequestsSigned
                            ? "Atlas signs outgoing AuthnRequests with the configured SP private key."
                            : "Atlas does not sign outgoing AuthnRequests because no SP private key is configured."
                        }
                      >
                        {provider.saml?.authnRequestsSigned
                          ? "Signed AuthnRequests"
                          : "Unsigned AuthnRequests"}
                      </span>
                    ) : null}
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
                  <div className="space-y-2">
                    <WorkspaceSSOCopyField label="SP metadata URL" value={provider.spMetadataUrl} />
                    <a
                      className="type-label-medium text-accent hover:underline"
                      href={provider.spMetadataUrl}
                      download={`${provider.providerId}-sp-metadata.xml`}
                    >
                      Download SP metadata XML &rarr;
                    </a>
                  </div>
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
                    {provider.saml?.certificate.notAfter ? (
                      <WorkspaceSSOCopyField
                        label="Certificate expires"
                        value={formatCertificateExpiry(provider.saml.certificate.notAfter)}
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
                  <div className="border-outline-variant bg-surface-container-lowest space-y-3 rounded-[1rem] border p-4">
                    <p className="type-title-small text-on-surface">DNS verification record</p>
                    <p className="type-body-medium text-outline">
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
