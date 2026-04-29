import { hasSerializedCapability } from "@/domains/access/capabilities";
import type { OrganizationPageController } from "./organization-page-controller";
import { OrganizationEmptyState } from "./organization-empty-state";
import { OrganizationLoadingState } from "./organization-loading-state";
import { OrganizationPageFeedback } from "./organization-page-feedback";
import { OrganizationPageHeader } from "./organization-page-header";
import { OrganizationTeamWorkspaceRequiredState } from "./organization-team-workspace-required-state";
import { PendingWorkspaceInvitationsSection } from "./pending-workspace-invitations-section";
import { SsoDiagnosticsDisclosure } from "./sso-diagnostics-disclosure";
import { SsoShareLinkButton } from "./sso-share-link";
import { WorkspaceCreationSection } from "./workspace-creation-section";
import { WorkspaceSSOSection } from "./workspace-sso-section";
import { WorkspaceSwitcherSection } from "./workspace-switcher-section";

/**
 * Props for the focused enterprise SSO setup view.
 */
interface OrganizationSSOPageViewProps {
  controller: OrganizationPageController;
}

interface SetupStep {
  body: string;
  title: string;
}

const SETUP_STEPS: readonly SetupStep[] = [
  {
    body: "Save your IdP issuer, sign-in URL, and signing certificate. Most teams paste IdP metadata XML to fill all three at once.",
    title: "Configure your identity provider",
  },
  {
    body: "Publish the DNS TXT record Atlas generates. Atlas auto-polls every 30 seconds for ten minutes after the record goes live.",
    title: "Verify your email domain",
  },
  {
    body: "Mark one configured provider as primary so anyone signing in from your workspace's email domain is routed through it.",
    title: "Mark the provider as primary",
  },
] as const;

/**
 * Three-step orientation block plus realistic time estimate, rendered above
 * the OIDC and SAML forms so the admin can preview the path before diving in.
 */
function SsoSetupOverview() {
  return (
    <section className="border-outline-variant bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-title-medium text-on-surface">Setup at a glance</h2>
        <p className="type-body-small text-outline">
          Most teams finish in 15–30 minutes — DNS propagation is usually the long pole.
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {SETUP_STEPS.map((step, index) => (
          <li
            key={step.title}
            className="border-outline-variant bg-surface-container-lowest rounded-[1.25rem] border p-4"
          >
            <p className="type-label-small text-ink-muted font-mono">
              {String(index + 1).padStart(2, "0")}
            </p>
            <p className="type-title-small text-on-surface mt-1">{step.title}</p>
            <p className="type-body-small text-outline mt-1 leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Focused enterprise sign-in setup view for OIDC, SAML, and domain
 * verification.
 */
export function OrganizationSSOPageView({ controller }: OrganizationSSOPageViewProps) {
  const canConfigureSSO = controller.session
    ? hasSerializedCapability(controller.session.workspace.resolvedCapabilities, "auth.sso")
    : false;
  if (!canConfigureSSO) {
    return (
      <div className="space-y-8 py-2">
        <OrganizationPageHeader
          description="Enterprise SSO configuration is not available for your current workspace plan."
          label="Enterprise SSO setup"
          links={[{ label: "View full organization settings", to: "/organization" }]}
          title="Enterprise sign-in"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-2">
      <OrganizationPageHeader
        description="Use this page to configure Google Workspace OIDC, SAML 2.0, domain verification, and the workspace primary provider."
        label="Enterprise SSO setup"
        links={[{ label: "View full organization settings", to: "/organization" }]}
        title="Configure enterprise sign-in"
      />

      {controller.organization && controller.canUseTeamFeatures ? <SsoSetupOverview /> : null}

      {controller.organization && controller.canUseTeamFeatures ? (
        <SsoDiagnosticsDisclosure />
      ) : null}

      {controller.organization && controller.canUseTeamFeatures ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="type-body-small text-outline">Need your IT team to handle SSO setup?</p>
          <SsoShareLinkButton workspaceSlug={controller.organization.slug} />
        </div>
      ) : null}

      {controller.organization && controller.canUseTeamFeatures ? (
        <details className="text-outline space-y-2">
          <summary className="type-label-medium cursor-pointer">Per-IdP setup guides</summary>
          <p className="type-body-small text-outline pt-2">
            Atlas's deployment docs cover end-to-end setup for the most common identity providers.
          </p>
          <ul className="type-body-small text-outline list-disc space-y-1 pl-5">
            <li>
              <a
                href="/docs/deployment/google-workspace-saml-sso"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                Google Workspace (SAML)
              </a>
            </li>
            <li>
              <a
                href="/docs/deployment/google-workspace-oidc-sso"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                Google Workspace (OIDC)
              </a>
            </li>
            <li>
              Okta, Entra, Auth0, JumpCloud, Keycloak: paste each IdP's metadata XML into the form
              below — Atlas's metadata parser handles the issuer, sign-in URL, and certificate the
              same way for every SAML 2.0–compliant provider.
            </li>
          </ul>
        </details>
      ) : null}

      {controller.organization && controller.canUseTeamFeatures ? (
        <p className="border-outline-variant text-outline rounded-2xl border bg-amber-50/40 px-4 py-3 text-amber-900">
          If multiple Atlas workspaces verify the same email domain, sign-in routing becomes
          ambiguous and Atlas falls back to a magic link instead of routing through SSO. Make sure
          your DNS-verified domain is unique to this workspace.
        </p>
      ) : null}

      <OrganizationPageFeedback
        errorMessage={controller.errorMessage}
        flashMessage={controller.flashMessage}
      />

      {controller.canSwitchOrganizations ? (
        <WorkspaceSwitcherSection
          isPending={controller.selectWorkspacePending}
          memberships={controller.memberships}
          selectedOrganizationId={controller.selectedOrganizationId}
          onChange={(id) => {
            void controller.onSelectWorkspace(id);
          }}
        />
      ) : null}

      {controller.hasPendingInvitations ? (
        <PendingWorkspaceInvitationsSection
          invitations={controller.pendingInvitations}
          isPending={controller.pendingInvitationMutationPending}
          onDecision={(id, action) => {
            void controller.onInvitationDecision(id, action);
          }}
        />
      ) : null}

      {controller.needsWorkspace ? (
        <WorkspaceCreationSection
          isPending={controller.createWorkspacePending}
          workspaceDelegatedEmail={controller.workspaceDelegatedEmail}
          workspaceDomain={controller.workspaceDomain}
          workspaceName={controller.workspaceName}
          workspaceSlug={controller.workspaceSlug}
          workspaceType={controller.workspaceType}
          onDelegatedEmailChange={controller.setWorkspaceDelegatedEmail}
          onDomainChange={controller.setWorkspaceDomain}
          onNameChange={controller.onUpdateWorkspaceName}
          onSlugChange={controller.onUpdateWorkspaceSlug}
          onSubmit={(e) => {
            void controller.onCreateWorkspace(e);
          }}
          onWorkspaceTypeChange={controller.onUpdateWorkspaceType}
        />
      ) : null}

      {controller.organizationLoading ? <OrganizationLoadingState /> : null}

      {controller.organization && controller.canUseTeamFeatures ? (
        <WorkspaceSSOSection
          canManageOrganization={controller.canManageOrganization}
          domainVerificationTokens={controller.domainVerificationTokens}
          isPending={controller.ssoMutationPending}
          oidcSetupForm={controller.oidcSetupForm}
          organization={controller.organization}
          samlAllowedIssuerOrigins={controller.samlAllowedIssuerOrigins}
          samlSetupForm={controller.samlSetupForm}
          samlVerificationTimedOutProviderIds={controller.samlVerificationTimedOutProviderIds}
          setOidcSetupForm={controller.setOidcSetupForm}
          setSamlSetupForm={controller.setSamlSetupForm}
          onDeleteProvider={controller.onDeleteSSOProvider}
          onOidcSubmit={controller.onOidcFormSubmit}
          onRequestDomainVerification={controller.onRequestDomainVerification}
          onRotateSAMLCertificate={controller.onRotateSAMLCertificate}
          onSamlSubmit={controller.onSamlFormSubmit}
          onSavePrimaryProvider={controller.onSavePrimaryProvider}
          onVerifyDomain={controller.onVerifyDomain}
        />
      ) : null}

      {controller.organization && !controller.canUseTeamFeatures ? (
        <OrganizationTeamWorkspaceRequiredState />
      ) : null}

      {!controller.needsWorkspace &&
      !controller.hasPendingInvitations &&
      !controller.organization ? (
        <OrganizationEmptyState />
      ) : null}
    </div>
  );
}
