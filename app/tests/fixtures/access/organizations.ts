import type {
  AtlasOrganizationDetails,
  AtlasOrganizationInvitationRecord,
  AtlasOrganizationMemberRecord,
} from "@/domains/access/organization-contracts";
import type {
  AtlasWorkspaceSSOProvider,
  AtlasWorkspaceSSOState,
} from "@/domains/access/organization-sso";

/**
 * Builds a fully loaded workspace member fixture for organization-management
 * tests.
 *
 * @param overrides - Field overrides for the organization member fixture.
 */
export function createOrganizationMemberFixture(
  overrides: Partial<AtlasOrganizationMemberRecord> = {},
): AtlasOrganizationMemberRecord {
  return {
    createdAt: overrides.createdAt ?? "2026-04-10T00:00:00.000Z",
    email: overrides.email ?? "owner@atlas.test",
    id: overrides.id ?? "member_owner",
    image: overrides.image ?? null,
    name: overrides.name ?? "Owner Operator",
    role: overrides.role ?? "owner",
    userId: overrides.userId ?? "user_123",
  };
}

/**
 * Builds a pending invitation fixture for organization-management tests.
 *
 * @param overrides - Field overrides for the organization invitation fixture.
 */
export function createOrganizationInvitationFixture(
  overrides: Partial<AtlasOrganizationInvitationRecord> = {},
): AtlasOrganizationInvitationRecord {
  return {
    createdAt: overrides.createdAt ?? "2026-04-10T00:00:00.000Z",
    email: overrides.email ?? "teammate@atlas.test",
    expiresAt: overrides.expiresAt ?? "2026-04-20T00:00:00.000Z",
    id: overrides.id ?? "invite_123",
    role: overrides.role ?? "member",
    status: overrides.status ?? "pending",
  };
}

/**
 * Builds a configured enterprise provider fixture for organization-management
 * tests.
 *
 * @param overrides - Field overrides for the workspace SSO provider fixture.
 */
export function createWorkspaceSSOProviderFixture(
  overrides: Partial<AtlasWorkspaceSSOProvider> = {},
): AtlasWorkspaceSSOProvider {
  return {
    domain: overrides.domain ?? "atlas.test",
    domainVerificationHost:
      overrides.domainVerificationHost ?? "_better-auth-token-atlas-team-saml",
    domainVerificationTokenAvailable: overrides.domainVerificationTokenAvailable ?? true,
    domainVerified: overrides.domainVerified ?? true,
    isPrimary: overrides.isPrimary ?? true,
    issuer: overrides.issuer ?? "https://accounts.google.com",
    oidc: overrides.oidc ?? {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      clientIdLastFour: "1234",
      discoveryEndpoint: "https://accounts.google.com/.well-known/openid-configuration",
      jwksEndpoint: "https://www.googleapis.com/oauth2/v3/certs",
      pkce: true,
      scopes: ["openid", "email", "profile"],
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      tokenEndpointAuthentication: "client_secret_basic",
      userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    },
    organizationId: overrides.organizationId ?? "org_team",
    providerId: overrides.providerId ?? "atlas-team-google-workspace-oidc",
    providerType: overrides.providerType ?? "oidc",
    saml: overrides.saml ?? null,
    spMetadataUrl:
      overrides.spMetadataUrl ??
      "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
  };
}

/**
 * Builds the enterprise SSO state Atlas renders inside organization
 * management.
 *
 * @param overrides - Field overrides for the workspace SSO state fixture.
 */
export function createWorkspaceSSOStateFixture(
  overrides: Partial<AtlasWorkspaceSSOState> = {},
): AtlasWorkspaceSSOState {
  return {
    primaryHistory: overrides.primaryHistory ?? [],
    primaryProviderId: overrides.primaryProviderId ?? "atlas-team-google-workspace-oidc",
    providers: overrides.providers ?? [createWorkspaceSSOProviderFixture()],
    setup: overrides.setup ?? {
      dnsTokenPrefix: "_better-auth-token",
      googleWorkspaceIssuer: "https://accounts.google.com",
      googleWorkspaceScopes: ["openid", "email", "profile"],
      oidcProviderIdSuggestion: "atlas-team-google-workspace-oidc",
      oidcRedirectUrl: "https://atlas.test/api/auth/sso/callback",
      samlAcsUrl: "https://atlas.test/api/auth/sso/saml2/sp/acs/atlas-team-google-workspace-saml",
      samlEntityId:
        "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
      samlMetadataUrl:
        "https://atlas.test/api/auth/sso/saml2/sp/metadata?providerId=atlas-team-google-workspace-saml&format=xml",
      samlProviderIdSuggestion: "atlas-team-google-workspace-saml",
      workspaceDomainSuggestion: "atlas.test",
    },
  };
}

/**
 * Builds the expanded organization details payload used by the organization
 * page.
 *
 * @param overrides - Field overrides for the organization details fixture.
 */
export function createOrganizationDetailsFixture(
  overrides: Partial<AtlasOrganizationDetails> = {},
): AtlasOrganizationDetails {
  const defaultMembers = [
    createOrganizationMemberFixture(),
    createOrganizationMemberFixture({
      email: "analyst@atlas.test",
      id: "member_analyst",
      name: "Policy Analyst",
      role: "member",
      userId: "user_456",
    }),
  ];
  const defaultInvitations = [createOrganizationInvitationFixture()];

  return {
    capabilities: overrides.capabilities ?? {
      canInviteMembers: true,
      canManageOrganization: true,
      canSwitchOrganizations: false,
      canUseTeamFeatures: true,
    },
    createdAt: overrides.createdAt ?? "2026-04-10T00:00:00.000Z",
    id: overrides.id ?? "org_team",
    invitations: overrides.invitations ?? defaultInvitations,
    members: overrides.members ?? defaultMembers,
    name: overrides.name ?? "Atlas Team",
    role: overrides.role ?? "owner",
    slug: overrides.slug ?? "atlas-team",
    sso: overrides.sso ?? createWorkspaceSSOStateFixture(),
    workspaceType: overrides.workspaceType ?? "team",
  };
}
