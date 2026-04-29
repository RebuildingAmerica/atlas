import { CheckCircle2, Clock } from "lucide-react";
import type { AtlasWorkspaceSSOProvider } from "../../organization-sso";
import { formatCertificateExpiry } from "../../cert-expiry-helpers";
import { DNS_PROVIDER_GUIDES, splitVerificationHost } from "../../dns-verification-helpers";
import { Button } from "@/platform/ui/button";
import { CertExpiryBanner } from "./cert-expiry-banner";
import { CertLifecycleBar } from "./cert-lifecycle-bar";
import { SamlCertificateRotationForm } from "./saml-certificate-rotation-form";
import { SamlProviderHealthCheck } from "./saml-provider-health-check";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";

interface WorkspaceSSOProviderCardProps {
  canManageOrganization: boolean;
  isPending: boolean;
  provider: AtlasWorkspaceSSOProvider;
  verificationToken: string;
  verificationTimedOut: boolean;
  verifyError: string | undefined;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onGenerateToken: (providerId: string, hasExisting: boolean) => Promise<void>;
  onMakePrimary: (providerId: string) => Promise<void>;
  onRotateSAMLCertificate: (providerId: string, certificate: string) => Promise<void>;
  onVerify: (providerId: string) => Promise<void>;
}

/**
 * Per-provider card rendered inside the workspace SSO provider list.
 * Shows status badges, copyable IdP-side values, the per-provider DNS
 * verification panel, the SAML health check + cert rotation forms, and
 * the row of management actions (Make primary, generate / re-check
 * token, remove).
 */
export function WorkspaceSSOProviderCard({
  canManageOrganization,
  isPending,
  provider,
  verificationToken,
  verificationTimedOut,
  verifyError,
  onDeleteProvider,
  onGenerateToken,
  onMakePrimary,
  onRotateSAMLCertificate,
  onVerify,
}: WorkspaceSSOProviderCardProps) {
  const renderNow = Date.now();
  const split = splitVerificationHost(provider.domainVerificationHost, provider.domain);

  return (
    <article className="border-outline-variant space-y-4 rounded-[1.25rem] border bg-white/70 p-4">
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
        <WorkspaceSSOCopyField label="Verification host" value={provider.domainVerificationHost} />
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
          <WorkspaceSSOCopyField label="ACS URL" value={provider.saml?.callbackUrl ?? ""} />
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
                value={formatCertificateExpiry(provider.saml.certificate.notAfter, renderNow)}
              />
              <CertLifecycleBar
                notAfter={provider.saml.certificate.notAfter}
                notBefore={provider.saml.certificate.notBefore ?? null}
                now={renderNow}
              />
              <CertExpiryBanner notAfter={provider.saml.certificate.notAfter} now={renderNow} />
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
            Create a TXT record using the host and value below. If you need a fresh token, generate
            one here and Atlas will show the exact value to paste.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <WorkspaceSSOCopyField label="TXT host (relative)" value={split.relative} />
            <WorkspaceSSOCopyField label="TXT host (FQDN)" value={split.fqdn} />
            <WorkspaceSSOCopyField
              label="TXT value"
              value={
                verificationToken || "Generate a verification token to reveal the exact TXT value."
              }
            />
          </div>
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
          {verificationTimedOut ? (
            <div className="rounded-2xl bg-amber-50 px-3 py-2">
              <p className="type-body-small text-amber-800">
                Atlas stopped polling DNS after 10 minutes without seeing the TXT record. If you've
                published it, click <em>Check now</em> below; if you still need to publish it, do
                that first.
              </p>
            </div>
          ) : null}
          {verifyError ? (
            <p className="type-body-small text-error">
              {verifyError} Atlas resolves <code>{split.fqdn}</code> — confirm that exact host
              returns the issued token via <code>dig TXT</code> or your DNS provider's diagnostics.
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
                void onMakePrimary(provider.providerId);
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
                  void onGenerateToken(provider.providerId, Boolean(verificationToken));
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
                  void onVerify(provider.providerId);
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
}
