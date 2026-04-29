import { useState } from "react";
import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Button } from "@/platform/ui/button";
import { useConfirmDialog } from "@/platform/ui/confirm-dialog";
import { WorkspaceSSOProviderCard } from "./workspace-sso-provider-card";

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
          {providers.map((provider) => (
            <WorkspaceSSOProviderCard
              key={provider.providerId}
              canManageOrganization={canManageOrganization}
              isPending={isPending}
              provider={provider}
              verificationToken={domainVerificationTokens[provider.providerId] ?? ""}
              verificationTimedOut={verificationTimedOutProviderIds.includes(provider.providerId)}
              verifyError={verifyError[provider.providerId]}
              onDeleteProvider={onDeleteProvider}
              onGenerateToken={handleGenerateToken}
              onMakePrimary={handleMakePrimary}
              onRotateSAMLCertificate={onRotateSAMLCertificate}
              onVerify={handleVerify}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}
