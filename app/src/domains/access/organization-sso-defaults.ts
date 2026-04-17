/**
 * Google Workspace's OpenID Connect issuer.
 */
export const GOOGLE_WORKSPACE_ISSUER = "https://accounts.google.com";

/**
 * OIDC scopes Atlas requests for Google Workspace enterprise sign-in.
 */
export const googleWorkspaceScopeList = ["openid", "email", "profile"] as const;

/**
 * Generated copy-paste values Atlas shows before an owner saves a provider.
 *
 * These values are all visible and editable in the organization UI. Atlas does
 * not infer customer domains or hide tenant-specific setup behind implicit
 * defaults.
 */
export interface AtlasWorkspaceSSOSetupValues {
  dnsTokenPrefix: string;
  googleWorkspaceIssuer: string;
  googleWorkspaceScopes: string[];
  oidcProviderIdSuggestion: string;
  oidcRedirectUrl: string;
  samlAcsUrl: string;
  samlEntityId: string;
  samlMetadataUrl: string;
  samlProviderIdSuggestion: string;
  workspaceDomainSuggestion: string;
}

/**
 * Trims trailing slashes from public origins before Atlas builds callback URLs.
 *
 * @param value - The public origin or path to normalize.
 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Builds the default Google Workspace OIDC provider identifier for a workspace.
 *
 * @param organizationSlug - The workspace slug used to namespace the provider.
 */
export function buildGoogleWorkspaceOIDCProviderId(organizationSlug: string): string {
  const normalizedSlug = organizationSlug.trim().toLowerCase();

  return `${normalizedSlug}-google-workspace-oidc`;
}

/**
 * Builds the default Google Workspace SAML provider identifier for a workspace.
 *
 * @param organizationSlug - The workspace slug used to namespace the provider.
 */
export function buildGoogleWorkspaceSAMLProviderId(organizationSlug: string): string {
  const normalizedSlug = organizationSlug.trim().toLowerCase();

  return `${normalizedSlug}-google-workspace-saml`;
}

/**
 * Builds the DNS host Atlas asks operators to create for Better Auth's domain
 * verification flow.
 *
 * @param providerId - The Better Auth SSO provider identifier.
 */
export function buildWorkspaceSSODomainVerificationHost(providerId: string): string {
  return `_better-auth-token-${providerId}`;
}

/**
 * Builds Atlas's shared OIDC callback URL.
 *
 * @param publicBaseUrl - The public Atlas origin.
 */
export function buildWorkspaceOIDCRedirectUrl(publicBaseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlash(publicBaseUrl);

  return `${normalizedBaseUrl}/api/auth/sso/callback`;
}

/**
 * Builds Atlas's SAML ACS URL for one workspace provider.
 *
 * @param publicBaseUrl - The public Atlas origin.
 * @param providerId - The Better Auth SAML provider identifier.
 */
export function buildWorkspaceSamlAcsUrl(publicBaseUrl: string, providerId: string): string {
  const normalizedBaseUrl = trimTrailingSlash(publicBaseUrl);

  return `${normalizedBaseUrl}/api/auth/sso/saml2/sp/acs/${providerId}`;
}

/**
 * Builds Atlas's XML metadata URL for one SAML service provider.
 *
 * @param publicBaseUrl - The public Atlas origin.
 * @param providerId - The Better Auth SAML provider identifier.
 */
export function buildWorkspaceSamlMetadataUrl(publicBaseUrl: string, providerId: string): string {
  const normalizedBaseUrl = trimTrailingSlash(publicBaseUrl);

  return `${normalizedBaseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}&format=xml`;
}

/**
 * Builds the SAML entity ID Atlas recommends pasting into enterprise IdPs.
 *
 * @param publicBaseUrl - The public Atlas origin.
 * @param providerId - The Better Auth SAML provider identifier.
 */
export function buildWorkspaceSamlEntityId(publicBaseUrl: string, providerId: string): string {
  return buildWorkspaceSamlMetadataUrl(publicBaseUrl, providerId);
}

/**
 * Builds Atlas's generated copy-paste values for Google Workspace setup.
 *
 * @param params - The workspace context Atlas uses to generate setup values.
 * @param params.organizationSlug - The active workspace slug.
 * @param params.publicBaseUrl - The public Atlas origin.
 * @param params.workspaceDomainSuggestion - The explicit domain suggestion
 * Atlas should prefill in setup forms.
 */
export function buildWorkspaceSSOSetupValues(params: {
  organizationSlug: string;
  publicBaseUrl: string;
  workspaceDomainSuggestion: string;
}): AtlasWorkspaceSSOSetupValues {
  const oidcProviderId = buildGoogleWorkspaceOIDCProviderId(params.organizationSlug);
  const samlProviderId = buildGoogleWorkspaceSAMLProviderId(params.organizationSlug);

  return {
    dnsTokenPrefix: "_better-auth-token",
    googleWorkspaceIssuer: GOOGLE_WORKSPACE_ISSUER,
    googleWorkspaceScopes: [...googleWorkspaceScopeList],
    oidcProviderIdSuggestion: oidcProviderId,
    oidcRedirectUrl: buildWorkspaceOIDCRedirectUrl(params.publicBaseUrl),
    samlAcsUrl: buildWorkspaceSamlAcsUrl(params.publicBaseUrl, samlProviderId),
    samlEntityId: buildWorkspaceSamlEntityId(params.publicBaseUrl, samlProviderId),
    samlMetadataUrl: buildWorkspaceSamlMetadataUrl(params.publicBaseUrl, samlProviderId),
    samlProviderIdSuggestion: samlProviderId,
    workspaceDomainSuggestion: params.workspaceDomainSuggestion,
  };
}

/**
 * Returns whether an SSO provider covers the requested email domain.
 *
 * Better Auth supports comma-separated domains for one provider, so Atlas
 * normalizes that format before sign-in resolution.
 *
 * @param providerDomain - The raw provider domain string stored by Better Auth.
 * @param emailDomain - The normalized email domain Atlas is resolving.
 */
export function workspaceSSOProviderMatchesDomain(
  providerDomain: string,
  emailDomain: string,
): boolean {
  const normalizedEmailDomain = emailDomain.trim().toLowerCase();
  const candidateDomains = providerDomain
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return candidateDomains.includes(normalizedEmailDomain);
}
