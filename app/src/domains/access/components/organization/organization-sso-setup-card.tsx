import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AtlasOrganizationDetails } from "../../organization-contracts";

/**
 * Props for the enterprise sign-in summary card on the workspace page.
 */
interface OrganizationSSOSetupCardProps {
  organization: AtlasOrganizationDetails;
}

type SetupState = "not-configured" | "needs-verification" | "verified" | "primary-set";

interface StateAffordance {
  badgeBgClass: string;
  badgeColorClass: string;
  badgeLabel: string;
  cta: string;
  icon: ReactNode;
  primaryProviderSummary: string;
  providerSummary: string;
}

/**
 * Focused summary card that points operators to the dedicated enterprise SSO
 * configuration page.  The card now mirrors the underlying setup state with
 * a colored state badge and adapts its CTA copy so an admin can tell at a
 * glance whether SSO is unconfigured, partially set up, or live for the
 * workspace without opening the full setup page first.
 */
export function OrganizationSSOSetupCard({ organization }: OrganizationSSOSetupCardProps) {
  const providers = organization.sso.providers;
  const configuredProviderCount = providers.length;
  const verifiedProviderCount = providers.filter((provider) => provider.domainVerified).length;
  const primaryProvider = providers.find((provider) => provider.isPrimary);

  const state: SetupState =
    configuredProviderCount === 0
      ? "not-configured"
      : verifiedProviderCount === 0
        ? "needs-verification"
        : primaryProvider
          ? "primary-set"
          : "verified";

  const affordance: StateAffordance = (() => {
    if (state === "not-configured") {
      return {
        badgeBgClass: "bg-surface-container",
        badgeColorClass: "text-ink-soft",
        badgeLabel: "Not configured",
        cta: "Configure enterprise SSO",
        icon: <Circle aria-hidden="true" className="text-outline h-4 w-4" />,
        primaryProviderSummary: "Once a provider is verified, mark one as primary to enable SSO.",
        providerSummary: "No enterprise providers configured yet.",
      };
    }
    if (state === "needs-verification") {
      return {
        badgeBgClass: "bg-amber-50",
        badgeColorClass: "text-amber-700",
        badgeLabel: "Needs domain verification",
        cta: "Finish SSO setup",
        icon: <ShieldAlert aria-hidden="true" className="h-4 w-4 text-amber-700" />,
        primaryProviderSummary: "Verify your domain before enabling SSO for sign-in.",
        providerSummary: `${configuredProviderCount} provider${configuredProviderCount === 1 ? "" : "s"} configured, awaiting verification.`,
      };
    }
    if (state === "verified") {
      return {
        badgeBgClass: "bg-amber-50",
        badgeColorClass: "text-amber-700",
        badgeLabel: "No primary provider",
        cta: "Choose primary provider",
        icon: <ShieldAlert aria-hidden="true" className="h-4 w-4 text-amber-700" />,
        primaryProviderSummary:
          "Pick a primary provider to route domain sign-ins through enterprise SSO.",
        providerSummary: `${configuredProviderCount} provider${configuredProviderCount === 1 ? "" : "s"} configured, ${verifiedProviderCount} verified.`,
      };
    }
    return {
      badgeBgClass: "bg-emerald-50",
      badgeColorClass: "text-emerald-700",
      badgeLabel: "SSO active",
      cta: "Manage enterprise SSO",
      icon: <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-700" />,
      primaryProviderSummary: primaryProvider
        ? `Primary provider: ${primaryProvider.providerId}.`
        : "No primary provider selected yet.",
      providerSummary: `${configuredProviderCount} provider${configuredProviderCount === 1 ? "" : "s"} configured, ${verifiedProviderCount} verified.`,
    };
  })();

  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-title-large text-ink-strong">Enterprise sign-in</h2>
          <span
            className={`type-label-small inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${affordance.badgeBgClass} ${affordance.badgeColorClass}`}
            aria-live="polite"
          >
            {affordance.icon}
            {affordance.badgeLabel}
          </span>
        </div>
        <p className="type-body-medium text-ink-soft">
          Keep provider setup, domain verification, and SAML or OIDC configuration on the focused
          setup page instead of mixing it into everyday workspace management.
        </p>
      </div>

      <div className="border-border bg-surface-container-lowest rounded-[1.25rem] border p-4">
        <p className="type-body-medium text-ink-strong">{affordance.providerSummary}</p>
        <p className="type-body-medium text-ink-soft mt-1">{affordance.primaryProviderSummary}</p>
      </div>

      <Link
        className="type-label-large border-border-strong text-ink-strong inline-flex items-center justify-center rounded-2xl border px-4 py-3"
        to="/organization/sso"
      >
        {affordance.cta}
      </Link>
    </article>
  );
}
