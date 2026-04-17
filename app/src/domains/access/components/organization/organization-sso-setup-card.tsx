import { Link } from "@tanstack/react-router";
import type { AtlasOrganizationDetails } from "../../organization-contracts";

/**
 * Props for the enterprise sign-in summary card on the workspace page.
 */
interface OrganizationSSOSetupCardProps {
  organization: AtlasOrganizationDetails;
}

/**
 * Focused summary card that points operators to the dedicated enterprise SSO
 * configuration page.
 */
export function OrganizationSSOSetupCard({ organization }: OrganizationSSOSetupCardProps) {
  const configuredProviderCount = organization.sso.providers.length;
  const verifiedProviderCount = organization.sso.providers.filter(
    (provider) => provider.domainVerified,
  ).length;
  const primaryProvider = organization.sso.providers.find((provider) => provider.isPrimary);
  const providerSummary =
    configuredProviderCount === 0
      ? "No enterprise providers configured yet."
      : `${configuredProviderCount} provider${configuredProviderCount === 1 ? "" : "s"} configured, ${verifiedProviderCount} verified.`;
  const primaryProviderSummary = primaryProvider
    ? `Primary provider: ${primaryProvider.providerId}.`
    : "No primary provider selected yet.";

  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Enterprise sign-in</h2>
        <p className="type-body-medium text-ink-soft">
          Keep provider setup, domain verification, and SAML or OIDC configuration on the focused
          setup page instead of mixing it into everyday workspace management.
        </p>
      </div>

      <div className="border-border bg-surface-container-lowest rounded-[1.25rem] border p-4">
        <p className="type-body-medium text-ink-strong">{providerSummary}</p>
        <p className="type-body-medium text-ink-soft mt-1">{primaryProviderSummary}</p>
      </div>

      <Link
        className="type-label-large border-border-strong text-ink-strong inline-flex items-center justify-center rounded-2xl border px-4 py-3"
        to="/organization/sso"
      >
        Open focused SSO setup
      </Link>
    </article>
  );
}
