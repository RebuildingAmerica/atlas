import { useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { formatCertificateExpiry } from "../../cert-expiry-helpers";
import { DNS_PROVIDER_GUIDES, splitVerificationHost } from "../../dns-verification-helpers";
import { Button } from "@/platform/ui/button";
import { useConfirmDialog } from "@/platform/ui/confirm-dialog";
import { CertExpiryBanner } from "./cert-expiry-banner";
import { CertLifecycleBar } from "./cert-lifecycle-bar";
import { SamlCertificateRotationForm } from "./saml-certificate-rotation-form";
import { SamlProviderHealthCheck } from "./saml-provider-health-check";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";

/**
 * Props for the configured SSO provider list.
 */
interface WorkspaceSSOProviderListProps {
  canManageOrganization: boolean;
  domainVerificationTokens: Record<string, string>;
  isPending: boolean;
  organization: AtlasOrganizationDetails;
  verificationTimedOutProviderIds?: readonly string[];
  onDeleteProvider: (providerId: string) => Promise<void>;
  onRequestDomainVerification: (providerId: string) => Promise<void>;
  onRotateSAMLCertificate: (providerId: string, certificate: string) => Promise<void>;
  onSavePrimaryProvider: (providerId: string | null) => Promise<void>;
  onVerifyDomain: (providerId: string) => Promise<void>;
}

/**
 * Lists the configured enterprise providers for the active team workspace.
 * Each card surfaces verification status, certificate health, copyable
 * IdP-side values, the inline rotation form, and the SAML health check.
 */
export function WorkspaceSSOProviderList({
  canManageOrganization,
  domainVerificationTokens,
  isPending,
  onDeleteProvider,
  onRequestDomainVerification,
  onRotateSAMLCertificate,
  onSavePrimaryProvider,
  onVerifyDomain,
  organization,
  verificationTimedOutProviderIds = [],
}: WorkspaceSSOProviderListProps) {
  const providers = organization.sso.providers;
  const primaryHistory = organization.sso.primaryHistory ?? [];
  const { confirm } = useConfirmDialog();
  const [verifyError, setVerifyError] = useState<Record<string, string>>({});

  async function handleMakePrimary(providerId: string) {
    const accepted = await confirm({
      title: "Make this provider primary?",
      body: "Atlas will route every workspace member whose email matches the verified domain through this provider on next sign-in. Existing browser sessions stay valid until they expire.",
      confirmLabel: "Make primary",
    });
    if (!accepted) return;
    await onSavePrimaryProvider(providerId);
  }

  async function handleGenerateToken(providerId: string, hasExisting: boolean) {
    if (hasExisting) {
      const accepted = await confirm({
        title: "Replace the existing verification token?",
        body: "Generating a new token invalidates the previous TXT value Atlas issued for this provider. Use this when the prior token expired or was lost — your DNS record will need to be updated to the new value.",
        confirmLabel: "Generate new token",
        destructive: true,
      });
      if (!accepted) return;
    }
    await onRequestDomainVerification(providerId);
  }

  async function handleBulkDisable() {
    const samlProviderIds = providers
      .filter((provider) => provider.providerType === "saml")
      .map((provider) => provider.providerId);
    if (samlProviderIds.length === 0) return;
    const accepted = await confirm({
      title: "Disable every SAML provider?",
      body: `Atlas will remove all ${String(samlProviderIds.length)} configured SAML providers from this workspace.  Sign-in will fall back to magic links until you re-register.  Useful for incident response — destructive otherwise.`,
      confirmLabel: "Disable all SAML",
      destructive: true,
    });
    if (!accepted) return;
    await Promise.all(
      samlProviderIds.map((providerId) =>
        onDeleteProvider(providerId).catch(() => {
          // Individual failures surface via the parent SSO actions hook.
        }),
      ),
    );
  }

  async function handleVerify(providerId: string) {
    setVerifyError((current) => {
      const { [providerId]: _, ...rest } = current;
      void _;
      return rest;
    });
    try {
      await onVerifyDomain(providerId);
    } catch (caught) {
      setVerifyError((current) => ({
        ...current,
        [providerId]:
          caught instanceof Error
            ? caught.message
            : "Atlas could not verify the TXT record.  Confirm the record exists and try again.",
      }));
    }
  }

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
      ) : null}

      {canManageOrganization && providers.some((provider) => provider.providerType === "saml") ? (
        <details className="text-outline space-y-2">
          <summary className="type-label-medium cursor-pointer">Incident response</summary>
          <p className="type-body-small text-outline pt-1">
            Disable every configured SAML provider in one click — useful when an IdP key leak or
            misconfiguration is causing sign-in failures and you want to fall back to magic links
            while you triage.
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              void handleBulkDisable();
            }}
          >
            Disable all SAML providers
          </Button>
        </details>
      ) : null}

      {providers.length > 0 && primaryHistory.length > 0 ? (
        <details className="text-outline space-y-2">
          <summary className="type-label-medium cursor-pointer">
            Primary-provider change history
          </summary>
          <ul className="type-body-small text-outline space-y-1 pt-2">
            {primaryHistory.map((entry) => (
              <li key={`${entry.changedAt}-${entry.providerId ?? "none"}`}>
                <span className="text-on-surface font-medium">
                  {entry.providerId ?? "(no primary)"}
                </span>{" "}
                set on {new Date(entry.changedAt).toISOString().slice(0, 19).replace("T", " ")}
                {entry.changedByEmail ? ` by ${entry.changedByEmail}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {providers.length > 0 ? (
        <div className="space-y-4">
          {providers.map((provider) => {
            const verificationToken = domainVerificationTokens[provider.providerId] ?? "";
            const renderNow = Date.now();

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
                      <span className="type-label-large rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                        Primary · routes new sign-ins
                      </span>
                    ) : provider.domainVerified ? (
                      <span className="type-label-large border-outline-variant text-outline rounded-full border px-3 py-1">
                        Secondary · ready to promote
                      </span>
                    ) : null}
                    <span
                      className={`type-label-large inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
                        provider.domainVerified
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-outline-variant text-outline"
                      }`}
                    >
                      {provider.domainVerified ? (
                        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : (
                        <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
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
                      truncateAt={64}
                    />
                    {provider.saml?.certificate.fingerprintSha256 ? (
                      <WorkspaceSSOCopyField
                        label="Certificate fingerprint"
                        value={provider.saml.certificate.fingerprintSha256}
                      />
                    ) : null}
                    {provider.saml?.certificate.notAfter ? (
                      <div className="space-y-2">
                        <WorkspaceSSOCopyField
                          label="Certificate expires"
                          value={formatCertificateExpiry(
                            provider.saml.certificate.notAfter,
                            renderNow,
                          )}
                        />
                        <CertLifecycleBar
                          notAfter={provider.saml.certificate.notAfter}
                          notBefore={provider.saml.certificate.notBefore ?? null}
                          now={renderNow}
                        />
                        <CertExpiryBanner
                          notAfter={provider.saml.certificate.notAfter}
                          now={renderNow}
                        />
                      </div>
                    ) : null}
                    {provider.saml?.certificate.errorMessage ? (
                      <WorkspaceSSOCopyField
                        label="Certificate parse status"
                        value={provider.saml.certificate.errorMessage}
                      />
                    ) : null}
                  </div>
                ) : null}

                {provider.providerType === "saml" && canManageOrganization ? (
                  <>
                    <SamlProviderHealthCheck providerId={provider.providerId} />
                    <SamlCertificateRotationForm
                      providerId={provider.providerId}
                      isPending={isPending}
                      onSubmit={onRotateSAMLCertificate}
                    />
                  </>
                ) : null}

                {!provider.domainVerified ? (
                  <div className="border-outline-variant bg-surface-container-lowest space-y-3 rounded-[1rem] border p-4">
                    <p className="type-title-small text-on-surface">DNS verification record</p>
                    <p className="type-body-medium text-outline">
                      Create a TXT record using the host and value below. If you need a fresh token,
                      generate one here and Atlas will show the exact value to paste.
                    </p>
                    {(() => {
                      const split = splitVerificationHost(
                        provider.domainVerificationHost,
                        provider.domain,
                      );
                      return (
                        <div className="grid gap-3 md:grid-cols-2">
                          <WorkspaceSSOCopyField
                            label="TXT host (relative)"
                            value={split.relative}
                          />
                          <WorkspaceSSOCopyField label="TXT host (FQDN)" value={split.fqdn} />
                          <WorkspaceSSOCopyField
                            label="TXT value"
                            value={
                              verificationToken ||
                              "Generate a verification token to reveal the exact TXT value."
                            }
                          />
                        </div>
                      );
                    })()}
                    <details className="text-outline space-y-2">
                      <summary className="type-label-medium cursor-pointer">
                        DNS provider quick references
                      </summary>
                      <ul className="type-body-small text-outline space-y-2 pt-2">
                        {DNS_PROVIDER_GUIDES.map((guide) => (
                          <li key={guide.id} className="space-y-0.5">
                            <p className="type-label-medium text-on-surface">{guide.name}</p>
                            <p className="leading-relaxed">{guide.body}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                    {verificationTimedOutProviderIds.includes(provider.providerId) ? (
                      <div className="rounded-2xl bg-amber-50 px-3 py-2">
                        <p className="type-body-small text-amber-800">
                          Atlas stopped polling DNS after 10 minutes without seeing the TXT record.
                          If you've published it, click <em>Check now</em> below; if you still need
                          to publish it, do that first.
                        </p>
                      </div>
                    ) : null}
                    {verifyError[provider.providerId] ? (
                      <p className="type-body-small text-error">
                        {verifyError[provider.providerId]} Atlas resolves{" "}
                        <code>
                          {
                            splitVerificationHost(provider.domainVerificationHost, provider.domain)
                              .fqdn
                          }
                        </code>{" "}
                        — confirm that exact host returns the issued token via <code>dig TXT</code>{" "}
                        or your DNS provider's diagnostics.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {canManageOrganization ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {!provider.isPrimary ? (
                      <Button
                        variant="secondary"
                        disabled={isPending}
                        onClick={() => {
                          void handleMakePrimary(provider.providerId);
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
                            void handleGenerateToken(
                              provider.providerId,
                              Boolean(verificationToken),
                            );
                          }}
                        >
                          {verificationToken
                            ? "Generate new verification token"
                            : "Generate verification token"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => {
                            void handleVerify(provider.providerId);
                          }}
                        >
                          Check now
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
      ) : null}
    </article>
  );
}
