import type { AtlasWorkspaceSSOSetupValues } from "../../organization-sso-defaults";
import { isLikelyFreeEmailDomain } from "../../sso-form-helpers";
import type { WorkspaceOIDCSetupFormState } from "./organization-page-controller";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";
import { WorkspaceSSODomainHint } from "./workspace-sso-domain-hint";
import { SaveButtonWithMissingFields } from "./workspace-sso-save-button";
import { Input } from "@/platform/ui/input";

interface WorkspaceSSOOidcFormProps {
  canManageOrganization: boolean;
  isPending: boolean;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
  setOidcSetupForm: (
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) => void;
  setup: AtlasWorkspaceSSOSetupValues;
  onOidcSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}

/**
 * Google Workspace OIDC configuration article — copyable Atlas-side
 * values plus the form admins fill in to register a Google OAuth
 * client.  Renders a placeholder line when the operator is not an
 * organization owner/admin.
 */
export function WorkspaceSSOOidcForm({
  canManageOrganization,
  isPending,
  oidcSetupForm,
  setOidcSetupForm,
  setup,
  onOidcSubmit,
}: WorkspaceSSOOidcFormProps) {
  const oidcDomainTrimmed = oidcSetupForm.domain.trim().toLowerCase();
  const oidcDomainIsFreeEmail = isLikelyFreeEmailDomain(oidcDomainTrimmed);
  const hasWorkspaceDomainSuggestion = Boolean(setup.workspaceDomainSuggestion);

  return (
    <article className="border-outline bg-surface space-y-5 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h3 className="type-title-large text-on-surface">Google Workspace OIDC</h3>
        <p className="type-body-medium text-outline">
          Use this for teams signing in through Google Workspace.
        </p>
      </div>

      <ol className="type-body-medium text-outline list-decimal space-y-2 pl-5">
        <li>Create or open the Google Cloud OAuth client for this workspace.</li>
        <li>Paste the redirect URI and issuer details shown below into Google.</li>
        <li>Paste the workspace domain, client ID, and client secret into Atlas.</li>
        <li>Save the provider, publish the DNS TXT verification record, then verify it here.</li>
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
          <div className="space-y-1">
            <Input
              label="Workspace domain"
              value={oidcSetupForm.domain}
              onChange={(value) => {
                setOidcSetupForm((current) => ({ ...current, domain: value }));
              }}
              placeholder={setup.workspaceDomainSuggestion || "your-org.example"}
            />
            {oidcDomainIsFreeEmail ? (
              <p className="type-body-small rounded-2xl bg-amber-50 px-3 py-2 text-amber-800">
                {oidcDomainTrimmed} is a consumer mailbox host. Use the domain your team actually
                receives email at.
              </p>
            ) : null}
          </div>
          {hasWorkspaceDomainSuggestion ? (
            <WorkspaceSSODomainHint suggestion={setup.workspaceDomainSuggestion} />
          ) : null}
          <Input
            label="Client ID"
            value={oidcSetupForm.clientId}
            onChange={(value) => {
              setOidcSetupForm((current) => ({ ...current, clientId: value }));
            }}
          />
          <Input
            label="Client secret"
            type="password"
            value={oidcSetupForm.clientSecret}
            onChange={(value) => {
              setOidcSetupForm((current) => ({ ...current, clientSecret: value }));
            }}
          />
          <details className="text-outline space-y-2">
            <summary className="type-label-medium cursor-pointer">
              Advanced: override the suggested provider ID
            </summary>
            <Input
              label="Provider ID"
              value={oidcSetupForm.providerId}
              onChange={(value) => {
                setOidcSetupForm((current) => ({ ...current, providerId: value }));
              }}
              placeholder={setup.oidcProviderIdSuggestion}
            />
            <p className="type-body-small text-outline">
              Keep the suggested value unless you have a reason to change it. Provider IDs must be
              unique across Atlas; collisions cause registration to fail.{" "}
              <a
                href="https://atlas.rebuildingus.org/docs/deployment/google-workspace-oidc-sso"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                Learn more
              </a>
              .
            </p>
          </details>
          <OidcSaveButton isPending={isPending} oidcSetupForm={oidcSetupForm} />
        </form>
      ) : (
        <p className="type-body-medium text-outline">
          Only owners and admins can register enterprise providers.
        </p>
      )}
    </article>
  );
}

function OidcSaveButton({
  isPending,
  oidcSetupForm,
}: {
  isPending: boolean;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
}) {
  const missing: string[] = [];
  if (!oidcSetupForm.domain.trim()) missing.push("workspace domain");
  if (!oidcSetupForm.clientId.trim()) missing.push("client ID");
  if (!oidcSetupForm.clientSecret.trim()) missing.push("client secret");
  if (!oidcSetupForm.providerId.trim()) missing.push("provider ID");
  return (
    <SaveButtonWithMissingFields
      isPending={isPending}
      label="Save Google Workspace OIDC"
      missing={missing}
      pendingLabel="Saving..."
    />
  );
}
