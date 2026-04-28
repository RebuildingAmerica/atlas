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
import { mergeAtlasOrganizationMetadata } from "./organization-metadata";
import {
  loadOrganizationRequestContext,
  requireManagedTeamWorkspace,
} from "./organization-server-helpers";
import {
  groupStoredProvidersByWorkspace,
  resolveStoredWorkspaceSSOSignIn,
} from "./sso-sign-in-resolution";
import { ensureAuthReady } from "./server/auth";
import { getBrowserSessionHeaders } from "./server/request-headers";
import {
  listStoredWorkspaceSSOProviders,
  loadStoredWorkspaceIdentity,
} from "./server/sso-provider-store";
import {
  getAuthRuntimeConfig,
  getSamlAllowedIssuerOrigins,
  isAllowedSamlIssuer,
} from "./server/runtime";

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

const workspaceSamlCertificateRotationSchema = z.object({
  certificate: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
});

const publicSSOResolutionSchema = z.object({
  email: z.string().trim().email(),
  invitationId: z.string().trim().min(1).optional(),
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
export const getWorkspaceSAMLAllowedIssuers = createServerFn({ method: "GET" }).handler(() => {
  return { issuerOrigins: getSamlAllowedIssuerOrigins() };
});

/**
 * Persists one workspace-level primary SSO provider choice inside Better
 * Auth's organization metadata.
 *
 * @param providerId - The provider id Atlas should mark as primary.
 */
async function saveWorkspacePrimarySSOProvider(providerId: string | null): Promise<void> {
  const organizationRequestContext = await loadOrganizationRequestContext();
  const { auth, headers, session } = organizationRequestContext;
  const activeWorkspace = requireManagedTeamWorkspace(session);
  const fullOrganization = await auth.api.getFullOrganization({
    headers,
    query: {
      organizationId: activeWorkspace.id,
    },
  });
  const mergedMetadata = mergeAtlasOrganizationMetadata(fullOrganization?.metadata, {
    ssoPrimaryProviderId: providerId,
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
function buildWorkspaceSSORegistrationDefaults(params: {
  providerId?: string;
  workspaceSlug: string;
}) {
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
  .inputValidator(googleWorkspaceOIDCProviderSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    const activeWorkspace = requireManagedTeamWorkspace(session);
    const registrationDefaults = buildWorkspaceSSORegistrationDefaults({
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
  .inputValidator(googleWorkspaceSAMLProviderSchema)
  .handler(async ({ data }) => {
    if (!isAllowedSamlIssuer(data.issuer)) {
      throw new Error(
        "This SAML issuer is not enabled on Atlas. Contact support to add it to the allowlist.",
      );
    }
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    const activeWorkspace = requireManagedTeamWorkspace(session);
    const registrationDefaults = buildWorkspaceSSORegistrationDefaults({
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
  .inputValidator(workspacePrimaryProviderSchema)
  .handler(async ({ data }) => {
    await saveWorkspacePrimarySSOProvider(data.providerId);

    return { ok: true };
  });

/**
 * Requests a fresh Better Auth domain-verification token for one provider.
 */
export const requestWorkspaceSSODomainVerification = createServerFn({ method: "POST" })
  .inputValidator(workspaceProviderIdSchema)
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
  .inputValidator(workspaceProviderIdSchema)
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

/**
 * Outcome of a SAML provider health check.  Atlas does not run a full SAML
 * roundtrip from the server (that requires a browser-driven AuthnRequest),
 * but a quick reachability + metadata check catches the most common
 * "configured wrong" cases — DNS broken, IdP down, certificate expired —
 * before an admin tells a user to sign in.
 */
export interface AtlasSAMLProviderHealth {
  certificateExpired: boolean | null;
  certificateNotAfter: string | null;
  certificateValid: boolean | null;
  entryPointReachable: boolean;
  entryPointStatus: number | null;
  reason: string | null;
}

/**
 * Runs a quick health probe against a configured SAML provider.  Verifies
 * the IdP entry point answers an HTTP request and that the stored signing
 * certificate has not expired.  No AuthnRequest is sent — this is a
 * pre-flight check for admins to catch obvious misconfigurations.
 */
export const checkWorkspaceSAMLProviderHealth = createServerFn({ method: "POST" })
  .inputValidator(workspaceProviderIdSchema)
  .handler(async ({ data }): Promise<AtlasSAMLProviderHealth> => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;

    const activeWorkspace = requireManagedTeamWorkspace(session);

    const provider = await auth.api.getSSOProvider({
      query: { providerId: data.providerId },
      headers,
    });

    if (provider?.organizationId !== activeWorkspace.id) {
      return {
        certificateExpired: null,
        certificateNotAfter: null,
        certificateValid: null,
        entryPointReachable: false,
        entryPointStatus: null,
        reason: "Provider is not registered to this workspace.",
      };
    }

    if (!provider.samlConfig) {
      return {
        certificateExpired: null,
        certificateNotAfter: null,
        certificateValid: null,
        entryPointReachable: false,
        entryPointStatus: null,
        reason: "Provider does not have a SAML configuration; this check is SAML-only.",
      };
    }

    const certificate = provider.samlConfig.certificate;
    const certificateValid = "fingerprintSha256" in certificate;
    const certificateNotAfter = certificateValid ? certificate.notAfter : null;
    const certificateExpired = certificateNotAfter
      ? new Date(certificateNotAfter).getTime() < Date.now()
      : null;

    let entryPointReachable = false;
    let entryPointStatus: number | null = null;
    let reason: string | null = null;

    try {
      const response = await fetch(provider.samlConfig.entryPoint, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      entryPointStatus = response.status;
      entryPointReachable = response.status < 500;
    } catch (error) {
      reason = error instanceof Error ? error.message : "Atlas could not reach the IdP.";
    }

    if (!certificateValid) {
      reason =
        reason ?? "Atlas could not parse the stored signing certificate; rotate it to recover.";
    } else if (certificateExpired) {
      reason = reason ?? `The stored signing certificate expired on ${certificateNotAfter}.`;
    }

    return {
      certificateExpired,
      certificateNotAfter,
      certificateValid,
      entryPointReachable,
      entryPointStatus,
      reason,
    };
  });

/**
 * Rotates the X.509 signing certificate on one configured SAML provider.
 *
 * The rotation goes through Better Auth's `updateSSOProvider` endpoint with
 * a partial `samlConfig` payload, so the workspace keeps its existing
 * domain verification, primary-provider marker, and IdP entry point.  The
 * SP-side signing key (when configured via `ATLAS_SAML_SP_PRIVATE_KEY`)
 * also stays put.
 */
export const rotateWorkspaceSAMLCertificate = createServerFn({ method: "POST" })
  .inputValidator(workspaceSamlCertificateRotationSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;

    requireManagedTeamWorkspace(session);

    await auth.api.updateSSOProvider({
      body: {
        providerId: data.providerId,
        samlConfig: { cert: data.certificate },
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Deletes one SSO provider from the active team workspace.
 */
export const deleteWorkspaceSSOProvider = createServerFn({ method: "POST" })
  .inputValidator(workspaceProviderIdSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    const activeWorkspace = requireManagedTeamWorkspace(session);

    await auth.api.deleteSSOProvider({
      body: {
        providerId: data.providerId,
      },
      headers,
    });

    const workspaceIdentity = await loadStoredWorkspaceIdentity(activeWorkspace.id);
    if (workspaceIdentity?.primaryProviderId === data.providerId) {
      await saveWorkspacePrimarySSOProvider(null);
    }

    return { ok: true };
  });

/**
 * Resolves whether Atlas should route a sign-in attempt through enterprise SSO.
 *
 * The Better Auth provider-management endpoints require a session, so Atlas
 * reads the internal auth tables directly for this public pre-auth routing
 * decision.
 */
export const resolveWorkspaceSSOSignIn = createServerFn({ method: "POST" })
  .inputValidator(publicSSOResolutionSchema)
  .handler(async ({ data }) => {
    const emailDomain = data.email.split("@")[1]?.trim().toLowerCase() ?? "";
    const authPromise = ensureAuthReady();
    const auth = await authPromise;
    const headers = getBrowserSessionHeaders();
    const storedProviders = await listStoredWorkspaceSSOProviders();

    if (data.invitationId) {
      const invitation = await auth.api.getInvitation({
        headers,
        query: {
          id: data.invitationId,
        },
      });

      if (invitation?.organizationId) {
        const workspaceIdentity = await loadStoredWorkspaceIdentity(invitation.organizationId);
        const workspaceProviders = storedProviders.filter(
          (provider) => provider.organizationId === invitation.organizationId,
        );

        if (workspaceIdentity) {
          const signInResolution = resolveStoredWorkspaceSSOSignIn({
            emailDomain,
            workspaceIdentity,
            workspaceProviders,
          });

          if (signInResolution) {
            return signInResolution;
          }
        }
      }
    }

    const providersByWorkspace = groupStoredProvidersByWorkspace({
      emailDomain,
      storedProviders,
    });

    if (providersByWorkspace.size !== 1) {
      return null;
    }

    const groupedWorkspaces = [...providersByWorkspace.entries()];
    const [organizationId, workspaceProviders] = groupedWorkspaces[0] ?? [];

    if (!organizationId || !workspaceProviders) {
      return null;
    }

    const workspaceIdentity = await loadStoredWorkspaceIdentity(organizationId);
    if (!workspaceIdentity) {
      return null;
    }

    return resolveStoredWorkspaceSSOSignIn({
      emailDomain,
      workspaceIdentity,
      workspaceProviders,
    });
  });
