import {
  buildWorkspaceSSOSelectionProvider,
  selectPreferredWorkspaceSSOProvider,
  workspaceSSOProviderMatchesDomain,
  type AtlasSSOSignInResolution,
  type AtlasSSOProviderType,
} from "./organization-sso";
import type {
  StoredWorkspaceIdentity,
  StoredWorkspaceSSOProvider,
} from "./server/sso-provider-store";

/**
 * Returns the provider type Atlas should use for one stored provider row.
 *
 * When a provider row exposes both OIDC and SAML configuration, Atlas prefers
 * SAML unless the workspace has a more explicit primary-provider choice at the
 * routing layer.
 *
 * @param provider - The stored provider record.
 */
export function resolveStoredProviderType(
  provider: StoredWorkspaceSSOProvider,
): AtlasSSOProviderType {
  if (provider.hasSAML && !provider.hasOIDC) {
    return "saml";
  }

  if (provider.hasOIDC && !provider.hasSAML) {
    return "oidc";
  }

  return "saml";
}

/**
 * Builds the minimal provider candidates Atlas needs while choosing one stored
 * provider for pre-auth SSO routing.
 *
 * @param params - The provider-selection inputs.
 * @param params.primaryProviderId - The workspace primary-provider id.
 * @param params.providers - The stored provider records for one workspace.
 */
function buildStoredWorkspaceSelectionProviders(params: {
  primaryProviderId: string | null;
  providers: StoredWorkspaceSSOProvider[];
}) {
  const selectionProviders = params.providers.map((provider) =>
    buildWorkspaceSSOSelectionProvider({
      domain: provider.domain,
      domainVerified: provider.domainVerified,
      isPrimary: provider.providerId === params.primaryProviderId,
      issuer: provider.issuer,
      organizationId: provider.organizationId,
      providerId: provider.providerId,
      providerType: resolveStoredProviderType(provider),
    }),
  );

  return selectionProviders;
}

/**
 * Resolves the preferred provider for one stored workspace identity.
 *
 * @param params - The workspace/provider-selection inputs.
 * @param params.emailDomain - The operator email domain Atlas is resolving.
 * @param params.workspaceIdentity - The stored workspace identity.
 * @param params.workspaceProviders - The stored provider records for the
 * workspace.
 */
export function resolveStoredWorkspaceSSOSignIn(params: {
  emailDomain: string;
  workspaceIdentity: StoredWorkspaceIdentity;
  workspaceProviders: StoredWorkspaceSSOProvider[];
}): AtlasSSOSignInResolution | null {
  const selectionProviders = buildStoredWorkspaceSelectionProviders({
    primaryProviderId: params.workspaceIdentity.primaryProviderId,
    providers: params.workspaceProviders,
  });
  const preferredProvider = selectPreferredWorkspaceSSOProvider({
    domain: params.emailDomain,
    primaryProviderId: params.workspaceIdentity.primaryProviderId,
    providers: selectionProviders,
  });

  if (!preferredProvider) {
    return null;
  }

  return {
    organizationName: params.workspaceIdentity.name,
    organizationSlug: params.workspaceIdentity.slug,
    providerId: preferredProvider.providerId,
    providerType: preferredProvider.providerType,
  };
}

/**
 * Groups verified stored providers by workspace for one email domain.
 *
 * Atlas returns `null` when more than one workspace matches the same verified
 * domain because the public sign-in page has no safe way to infer which
 * workspace the operator intended.
 *
 * @param params - The grouping inputs.
 * @param params.emailDomain - The operator email domain Atlas is resolving.
 * @param params.storedProviders - Every stored SSO provider Atlas can inspect.
 */
export function groupStoredProvidersByWorkspace(params: {
  emailDomain: string;
  storedProviders: StoredWorkspaceSSOProvider[];
}) {
  const providersByWorkspace = new Map<string, StoredWorkspaceSSOProvider[]>();

  for (const provider of params.storedProviders) {
    if (!provider.organizationId || !provider.domainVerified) {
      continue;
    }

    const providerMatchesDomain = workspaceSSOProviderMatchesDomain(
      provider.domain,
      params.emailDomain,
    );

    if (!providerMatchesDomain) {
      continue;
    }

    const currentProviders = providersByWorkspace.get(provider.organizationId) ?? [];

    providersByWorkspace.set(provider.organizationId, [...currentProviders, provider]);
  }

  return providersByWorkspace;
}
