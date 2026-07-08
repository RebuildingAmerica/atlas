import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  buildGoogleWorkspaceOIDCProviderId,
  buildGoogleWorkspaceSAMLProviderId,
  buildWorkspaceOIDCRedirectUrl,
  buildWorkspaceSamlAcsUrl,
  buildWorkspaceSamlEntityId,
  buildWorkspaceSamlMetadataUrl,
} from "./organization-sso";
import {
  mergeAtlasOrganizationMetadata,
  normalizeAtlasOrganizationMetadata,
} from "./organization-metadata";
import {
  loadOrganizationRequestContext,
  requireManagedTeamWorkspace,
} from "./organization-server-helpers";

export async function loadWorkspaceSSOServerModules() {
  if (import.meta.env.SSR) {
    const [auth, requestHeaders, ssoProviderStore, runtime] = await Promise.all([
      import("./server/auth"),
      import("./server/request-headers"),
      import("./server/sso-provider-store"),
      import("./server/runtime"),
    ]);
    return { auth, requestHeaders, ssoProviderStore, runtime };
  }

  throw new Error("Workspace SSO server modules are only available on the server.");
}

const googleWorkspaceOIDCProviderSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  providerId: z.string().trim().min(1).optional(),
  setAsPrimary: z.boolean().default(false),
});

const googleWorkspaceSAMLProviderSchema = z.object({
  certificate: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  entryPoint: z.string().trim().url(),
  issuer: z.string().trim().min(1),
  providerId: z.string().trim().min(1).optional(),
  setAsPrimary: z.boolean().default(true),
});

const workspaceProviderIdSchema = z.object({
  providerId: z.string().trim().min(1),
});

const workspacePrimaryProviderSchema = z.object({
  providerId: z.string().trim().min(1).nullable(),
});

/**
 * Provider-registration payload Atlas returns after an owner saves a new
 * enterprise identity provider.
 */
export interface AtlasWorkspaceSSORegistrationResult {
  domainVerificationToken: string;
  providerId: string;
  redirectUrl: string;
  samlAcsUrl: string;
  samlEntityId: string;
  samlMetadataUrl: string;
}

/**
 * Returns the operator-managed SAML issuer allowlist so the workspace SSO
 * registration form can validate the issuer field client-side and disable
 * Save before the server-side check ever runs.  An empty array means SAML
 * registration is disabled for this deployment.
 */
export const getWorkspaceSAMLAllowedIssuers = createServerFn({ method: "GET" }).handler(
  async () => {
    const { runtime } = await loadWorkspaceSSOServerModules();
    const { getSamlAllowedIssuerOrigins } = runtime;
    return { issuerOrigins: getSamlAllowedIssuerOrigins() };
  },
);

/**
 * Persists one workspace-level primary SSO provider choice inside Better
 * Auth's organization metadata.
 *
 * @param providerId - The provider id Atlas should mark as primary.
 */
const SSO_PRIMARY_HISTORY_LIMIT = 20;

export async function saveWorkspacePrimarySSOProvider(providerId: string | null): Promise<void> {
  const organizationRequestContext = await loadOrganizationRequestContext();
  const { auth, headers, session } = organizationRequestContext;
  const activeWorkspace = requireManagedTeamWorkspace(session);
  const fullOrganization = await auth.api.getFullOrganization({
    headers,
    query: {
      organizationId: activeWorkspace.id,
    },
  });
  const previous = normalizeAtlasOrganizationMetadata(fullOrganization?.metadata);
  const isNoOp = (previous.ssoPrimaryProviderId ?? null) === providerId;
  const updatedHistory = isNoOp
    ? previous.ssoPrimaryHistory
    : [
        {
          changedAt: new Date().toISOString(),
          changedByEmail: session.user.email,
          providerId,
        },
        ...(previous.ssoPrimaryHistory ?? []),
      ].slice(0, SSO_PRIMARY_HISTORY_LIMIT);
  const mergedMetadata = mergeAtlasOrganizationMetadata(fullOrganization?.metadata, {
    ssoPrimaryProviderId: providerId,
    ssoPrimaryHistory: updatedHistory,
  });

  await auth.api.updateOrganization({
    body: {
      data: {
        metadata: mergedMetadata,
      },
      organizationId: activeWorkspace.id,
    },
    headers,
  });
}

/**
 * Builds the provider identifiers and callback values Atlas derives from the
 * active workspace.
 *
 * @param params - The active workspace context.
 * @param params.providerId - The optional provider id supplied by the operator.
 * @param params.workspaceSlug - The active workspace slug.
 */
async function buildWorkspaceSSORegistrationDefaults(params: {
  providerId?: string;
  workspaceSlug: string;
}) {
  const { runtime: runtimeModule } = await loadWorkspaceSSOServerModules();
  const { getAuthRuntimeConfig } = runtimeModule;
  const runtime = getAuthRuntimeConfig();
  const oidcProviderId =
    params.providerId ?? buildGoogleWorkspaceOIDCProviderId(params.workspaceSlug);
  const samlProviderId =
    params.providerId ?? buildGoogleWorkspaceSAMLProviderId(params.workspaceSlug);

  return {
    oidcProviderId,
    oidcRedirectUrl: buildWorkspaceOIDCRedirectUrl(runtime.publicBaseUrl),
    samlAcsUrl: buildWorkspaceSamlAcsUrl(runtime.publicBaseUrl, samlProviderId),
    samlEntityId: buildWorkspaceSamlEntityId(runtime.publicBaseUrl, samlProviderId),
    samlMetadataUrl: buildWorkspaceSamlMetadataUrl(runtime.publicBaseUrl, samlProviderId),
    samlProviderId,
  };
}

/**
 * Registers a Google Workspace OIDC provider for the active team workspace.
 */
export const registerWorkspaceGoogleOIDCProvider = createServerFn({ method: "POST" })
  .validator(googleWorkspaceOIDCProviderSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    const activeWorkspace = requireManagedTeamWorkspace(session);
    const registrationDefaults = await buildWorkspaceSSORegistrationDefaults({
      providerId: data.providerId,
      workspaceSlug: activeWorkspace.slug,
    });
    const registrationResult = await auth.api.registerSSOProvider({
      body: {
        domain: data.domain,
        issuer: "https://accounts.google.com",
        oidcConfig: {
          clientId: data.clientId,
          clientSecret: data.clientSecret,
          scopes: ["openid", "email", "profile"],
        },
        organizationId: activeWorkspace.id,
        providerId: registrationDefaults.oidcProviderId,
      },
      headers,
    });

    if (data.setAsPrimary) {
      await saveWorkspacePrimarySSOProvider(registrationResult.providerId);
    }

    return {
      domainVerificationToken: registrationResult.domainVerificationToken,
      providerId: registrationResult.providerId,
      redirectUrl: registrationResult.redirectURI,
      samlAcsUrl: registrationDefaults.samlAcsUrl,
      samlEntityId: registrationDefaults.samlEntityId,
      samlMetadataUrl: registrationDefaults.samlMetadataUrl,
    } satisfies AtlasWorkspaceSSORegistrationResult;
  });

/**
 * Registers a Google Workspace SAML provider for the active team workspace.
 *
 * The admin-supplied `issuer` is gated against the operator-managed allowlist
 * (`ATLAS_SAML_ALLOWED_ISSUERS`).  DNS TXT domain verification only proves that
 * the workspace controls the email domain — it does not prove ownership of the
 * IdP issuer URL, so the issuer host must be opted in by Atlas operators.
 */
export const registerWorkspaceSAMLProvider = createServerFn({ method: "POST" })
  .validator(googleWorkspaceSAMLProviderSchema)
  .handler(async ({ data }) => {
    const { runtime: runtimeModule } = await loadWorkspaceSSOServerModules();
    const { getAuthRuntimeConfig, isAllowedSamlIssuer } = runtimeModule;
    if (!isAllowedSamlIssuer(data.issuer)) {
      throw new Error(
        "This SAML issuer is not enabled on Atlas. Contact support to add it to the allowlist.",
      );
    }
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    const activeWorkspace = requireManagedTeamWorkspace(session);
    const registrationDefaults = await buildWorkspaceSSORegistrationDefaults({
      providerId: data.providerId,
      workspaceSlug: activeWorkspace.slug,
    });
    const runtime = getAuthRuntimeConfig();
    const samlSpPrivateKey = runtime.samlSpPrivateKey;
    const samlSpPrivateKeyPass = runtime.samlSpPrivateKeyPass ?? undefined;
    const registrationResult = await auth.api.registerSSOProvider({
      body: {
        domain: data.domain,
        issuer: data.issuer,
        organizationId: activeWorkspace.id,
        providerId: registrationDefaults.samlProviderId,
        samlConfig: {
          audience: registrationDefaults.samlEntityId,
          // SAML 2.0 §3.4 recommends signed AuthnRequests when the SP holds
          // signing keys.  When ATLAS_SAML_SP_PRIVATE_KEY is provisioned the
          // SP can sign requests; otherwise leave them unsigned so existing
          // IdP integrations that did not record an SP cert keep working.
          authnRequestsSigned: samlSpPrivateKey !== null,
          callbackUrl: registrationDefaults.samlAcsUrl,
          cert: data.certificate,
          entryPoint: data.entryPoint,
          identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
          spMetadata: {
            entityID: registrationDefaults.samlEntityId,
            ...(samlSpPrivateKey ? { privateKey: samlSpPrivateKey } : {}),
            ...(samlSpPrivateKeyPass ? { privateKeyPass: samlSpPrivateKeyPass } : {}),
          },
          wantAssertionsSigned: true,
          ...(samlSpPrivateKey ? { privateKey: samlSpPrivateKey } : {}),
        },
      },
      headers,
    });

    if (data.setAsPrimary) {
      await saveWorkspacePrimarySSOProvider(registrationResult.providerId);
    }

    return {
      domainVerificationToken: registrationResult.domainVerificationToken,
      providerId: registrationResult.providerId,
      redirectUrl: registrationResult.redirectURI,
      samlAcsUrl: registrationDefaults.samlAcsUrl,
      samlEntityId: registrationDefaults.samlEntityId,
      samlMetadataUrl: registrationDefaults.samlMetadataUrl,
    } satisfies AtlasWorkspaceSSORegistrationResult;
  });

/**
 * Marks one configured provider as the workspace's primary enterprise entry
 * point.
 */
export const setWorkspacePrimarySSOProvider = createServerFn({ method: "POST" })
  .validator(workspacePrimaryProviderSchema)
  .handler(async ({ data }) => {
    await saveWorkspacePrimarySSOProvider(data.providerId);

    return { ok: true };
  });

/**
 * Requests a fresh Better Auth domain-verification token for one provider.
 */
export const requestWorkspaceSSODomainVerification = createServerFn({ method: "POST" })
  .validator(workspaceProviderIdSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;

    requireManagedTeamWorkspace(session);

    const verificationResult = await auth.api.requestDomainVerification({
      body: {
        providerId: data.providerId,
      },
      headers,
    });

    return verificationResult;
  });

/**
 * Submits a Better Auth domain-verification check for one provider.
 */
export const verifyWorkspaceSSODomain = createServerFn({ method: "POST" })
  .validator(workspaceProviderIdSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;

    requireManagedTeamWorkspace(session);

    await auth.api.verifyDomain({
      body: {
        providerId: data.providerId,
      },
      headers,
    });

    return { ok: true };
  });

export type { AtlasSAMLProviderHealth } from "./sso-support.functions";
export {
  checkWorkspaceSAMLProviderHealth,
  deleteWorkspaceSSOProvider,
  resolveWorkspaceSSOSignIn,
  rotateWorkspaceSAMLCertificate,
} from "./sso-support.functions";
