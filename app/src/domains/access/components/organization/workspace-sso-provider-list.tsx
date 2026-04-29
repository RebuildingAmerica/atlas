import { useRef, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import type { AtlasOrganizationDetails } from "../../organization-contracts";
import {
  assessCertExpiry,
  describeCertExpiryAction,
  severityToBannerPalette,
} from "../../cert-expiry-helpers";
import {
  type AtlasSAMLProviderHealth,
  checkWorkspaceSAMLProviderHealth,
} from "../../sso.functions";
import { Button } from "@/platform/ui/button";
import { Textarea } from "@/platform/ui/textarea";
import { useConfirmDialog } from "@/platform/ui/confirm-dialog";
import { CertLifecycleBar } from "./cert-lifecycle-bar";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";

/**
 * Returns the relative TXT host (the leading subdomain Atlas asks the admin
 * to publish) and the full FQDN, given the host string Better Auth returns
 * and the workspace's email domain.  Both are surfaced in the verification
 * card so admins running their DNS at the apex can paste the relative form
 * and admins managing zones from a parent provider can copy the full FQDN.
 *
 * @param verificationHost - Either a relative `_better-auth-token-…` host or
 *   the fully-qualified equivalent already including the workspace domain.
 * @param workspaceDomain - The verified-domain value stored on the provider.
 */
function splitVerificationHost(
  verificationHost: string,
  workspaceDomain: string,
): { fqdn: string; relative: string } {
  const trimmedHost = verificationHost.trim();
  const trimmedDomain = workspaceDomain.trim().toLowerCase();
  if (!trimmedHost) {
    return { fqdn: "", relative: "" };
  }
  const lowered = trimmedHost.toLowerCase();
  if (trimmedDomain && lowered.endsWith(`.${trimmedDomain}`)) {
    return {
      fqdn: trimmedHost,
      relative: trimmedHost.slice(0, trimmedHost.length - trimmedDomain.length - 1),
    };
  }
  if (trimmedDomain && lowered === trimmedDomain) {
    return { fqdn: trimmedHost, relative: "@" };
  }
  return {
    fqdn: trimmedDomain ? `${trimmedHost}.${trimmedDomain}` : trimmedHost,
    relative: trimmedHost,
  };
}

/**
 * Per-DNS-provider snippets so admins running Cloudflare/Route 53/GoDaddy
 * see the dialog-specific instructions next to the generic "publish a TXT
 * record" copy.  Stored statically — the hostnames each console expects are
 * stable enough to bake in.
 */
const DNS_PROVIDER_GUIDES: readonly { id: string; name: string; body: string }[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    body: "Open the DNS tab for the domain, click Add record, set Type to TXT, paste the relative host into Name, and the token into Content. Leave TTL on Auto.",
  },
  {
    id: "route53",
    name: "AWS Route 53",
    body: "Open the hosted zone for the domain, click Create record, set Record type to TXT, paste the FQDN into Record name (Route 53 expects fully-qualified names), and the token into Value (with quotes around it).",
  },
  {
    id: "google-domains",
    name: "Google Cloud DNS",
    body: "Open the zone for the domain, click Add record set, set Resource record type to TXT, paste the FQDN into DNS name, and the token into TXT data.",
  },
  {
    id: "godaddy",
    name: "GoDaddy / Namecheap",
    body: "Open Domain Manager → DNS Records, add a new record with Type=TXT, paste the relative host into Host, and the token into TXT Value.",
  },
] as const;

/**
 * Formats an ISO timestamp returned by Better Auth's certificate parser into a
 * stable, human-friendly expiry label that does not depend on the user's
 * locale.
 *
 * @param isoTimestamp - The certificate `notAfter` value from Better Auth.
 */
function formatCertificateExpiry(isoTimestamp: string, now?: number): string {
  const assessment = assessCertExpiry(isoTimestamp, now);
  if (!assessment) return isoTimestamp;
  const datePart = isoTimestamp.slice(0, 10);
  if (assessment.daysUntil < 0) {
    return `${datePart} (expired ${String(Math.abs(assessment.daysUntil))}d ago)`;
  }
  return `${datePart} (in ${String(assessment.daysUntil)}d)`;
}

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
 * Action banner for an expiring or expired signing certificate.  Returns
 * null when the assessment is missing or the severity is `ok`, so callers
 * can render unconditionally without a wrapping check.
 */
function CertExpiryBanner({
  notAfter,
  now,
}: {
  notAfter: string | null | undefined;
  now?: number;
}) {
  const assessment = assessCertExpiry(notAfter, now);
  if (!assessment || assessment.severity === "ok") return null;
  const message = describeCertExpiryAction(assessment);
  if (!message) return null;
  return (
    <p
      className={`type-body-small rounded-2xl px-3 py-2 ${severityToBannerPalette(assessment.severity)}`}
      role={assessment.severity === "expired" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

/**
 * Returns true when a health-check result indicates a healthy SAML
 * provider — entry point reachable, certificate parseable, not expired.
 * Drives the top-line verdict banner.
 */
function isHealthyResult(result: AtlasSAMLProviderHealth): boolean {
  return (
    result.entryPointReachable &&
    result.certificateValid !== false &&
    result.certificateExpired !== true &&
    !result.reason
  );
}

/**
 * Renders the most recent SAML provider health-check result.  Pings the
 * IdP entry point and inspects the stored signing certificate; does not
 * run a full AuthnRequest.
 */
function SamlProviderHealthCheck(props: { providerId: string }) {
  const [result, setResult] = useState<AtlasSAMLProviderHealth | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoRunRef = useRef(false);

  async function runCheck() {
    setPending(true);
    setError(null);
    try {
      const checkResult = await checkWorkspaceSAMLProviderHealth({
        data: { providerId: props.providerId },
      });
      setResult(checkResult);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Atlas could not run the SAML health check.",
      );
    } finally {
      setPending(false);
    }
  }

  // Auto-run lazily on first disclosure open instead of on mount, so a
  // workspace with several SAML providers does not fan out N parallel
  // probes against the IdP just because the list was rendered.
  function handleToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && !hasAutoRunRef.current) {
      hasAutoRunRef.current = true;
      void runCheck();
    }
  }

  const verdict = result ? (isHealthyResult(result) ? "healthy" : "unhealthy") : null;

  return (
    <details className="text-outline space-y-2" onToggle={handleToggle}>
      <summary className="type-label-medium cursor-pointer">SAML health check</summary>
      {verdict ? (
        <p
          className={`type-label-medium rounded-2xl px-3 py-2 ${
            verdict === "healthy" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {verdict === "healthy"
            ? "Provider looks healthy — entry point reachable and certificate valid."
            : "Provider needs attention — review the details below before telling users to sign in."}
        </p>
      ) : null}
      <p className="type-body-small text-outline">
        Pings the IdP entry point and inspects the stored signing certificate. Does not start a full
        sign-in flow.
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          void runCheck();
        }}
      >
        {pending ? "Checking..." : "Re-run health check"}
      </Button>
      {error ? <p className="type-body-small text-error">{error}</p> : null}
      {result ? (
        <ul className="type-body-small text-outline list-disc space-y-1 pl-5">
          <li>
            IdP entry point:{" "}
            {result.entryPointReachable
              ? `reachable (HTTP ${result.entryPointStatus ?? "?"})`
              : `unreachable${result.entryPointStatus ? ` (HTTP ${result.entryPointStatus})` : ""}`}
          </li>
          <li>
            Signing certificate:{" "}
            {result.certificateValid === false
              ? "could not parse"
              : result.certificateExpired === true
                ? `expired ${result.certificateNotAfter ?? ""}`
                : result.certificateExpired === false
                  ? `valid (expires ${result.certificateNotAfter ?? "unknown"})`
                  : "unknown"}
          </li>
          {result.reason ? <li>Notes: {result.reason}</li> : null}
        </ul>
      ) : null}
    </details>
  );
}

/**
 * Inline rotation form rendered inside the SAML provider card.  Keeping it
 * collapsed by default avoids cluttering the list while still letting an
 * admin update the certificate without losing the verified domain or
 * primary-provider state.
 *
 * @param props - The component props.
 * @param props.providerId - The provider whose cert is being rotated.
 * @param props.isPending - Whether any SSO mutation is currently running.
 * @param props.onSubmit - Async rotation handler from the SSO actions hook.
 */
function SamlCertificateRotationForm(props: {
  providerId: string;
  isPending: boolean;
  onSubmit: (providerId: string, certificate: string) => Promise<void>;
}) {
  const [certificate, setCertificate] = useState("");

  async function handleSubmit() {
    await props.onSubmit(props.providerId, certificate);
    setCertificate("");
  }

  return (
    <details className="text-outline space-y-2">
      <summary className="type-label-medium cursor-pointer">Rotate signing certificate</summary>
      <p className="type-body-small text-outline">
        Paste the new PEM-encoded X.509 certificate the IdP just issued. Atlas keeps the existing
        domain verification, primary-provider marker, and SP signing key.
      </p>
      <p className="type-body-small rounded-2xl bg-amber-50 px-3 py-2 text-amber-800">
        Browser sessions started before the rotation stay valid until they expire — Atlas can't
        pre-validate the new certificate against the IdP's published metadata yet, so we recommend
        scheduling rotations during a low-traffic window and re-running the health check immediately
        after.
      </p>
      <Textarea
        label="New X.509 certificate"
        rows={8}
        autoExpand
        maxRows={32}
        value={certificate}
        onChange={setCertificate}
        placeholder="-----BEGIN CERTIFICATE-----"
        className="font-mono text-sm"
      />
      <Button
        type="button"
        variant="secondary"
        disabled={props.isPending || !certificate.trim()}
        onClick={() => {
          void handleSubmit();
        }}
      >
        Replace certificate
      </Button>
    </details>
  );
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
