import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  groupStoredProvidersByWorkspace,
  resolveStoredWorkspaceSSOSignIn,
} from "./sso-sign-in-resolution";
import {
  loadOrganizationRequestContext,
  requireManagedTeamWorkspace,
} from "./organization-server-helpers";
import { loadWorkspaceSSOServerModules, saveWorkspacePrimarySSOProvider } from "./sso.functions";

/**
 * Hostnames Atlas refuses to fetch SAML IdP entry points from. The list
 * mirrors the CIMD resolver's private-host blocklist so an admin who
 * registers a SAML provider with a localhost or RFC-1918 entry point
 * cannot use the health-check probe to pivot Atlas's egress through
 * cloud-metadata services or internal infrastructure.
 */
const SAML_DENIED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^\[::1\]$/,
];

const workspaceProviderIdSchema = z.object({
  providerId: z.string().trim().min(1),
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
 * Returns the parsed URL when `value` is a public HTTPS URL Atlas is
 * willing to send a server-side health probe to, or null otherwise.
 */
function asPublicHttpsUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  for (const pattern of SAML_DENIED_HOST_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      return null;
    }
  }
  return parsed;
}

export interface AtlasSAMLProviderHealth {
  certificateExpired: boolean | null;
  certificateNotAfter: string | null;
  certificateValid: boolean | null;
  entryPointReachable: boolean;
  entryPointStatus: number | null;
  reason: string | null;
}

export const checkWorkspaceSAMLProviderHealth = createServerFn({ method: "POST" })
  .validator(workspaceProviderIdSchema)
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

    const safeEntryPoint = asPublicHttpsUrl(provider.samlConfig.entryPoint);
    if (!safeEntryPoint) {
      reason = `Atlas refuses to probe a non-public or non-HTTPS IdP entry point (${provider.samlConfig.entryPoint}).`;
    } else {
      try {
        const response = await fetch(safeEntryPoint.toString(), {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        entryPointStatus = response.status;
        entryPointReachable = response.status < 500;
      } catch (error) {
        reason = error instanceof Error ? error.message : "Atlas could not reach the IdP.";
      }
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

export const rotateWorkspaceSAMLCertificate = createServerFn({ method: "POST" })
  .validator(workspaceSamlCertificateRotationSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;

    const activeWorkspace = requireManagedTeamWorkspace(session);

    const provider = await auth.api.getSSOProvider({
      query: { providerId: data.providerId },
      headers,
    });
    if (provider?.organizationId !== activeWorkspace.id) {
      throw new Error("This SAML provider is not registered to the active workspace.");
    }

    await auth.api.updateSSOProvider({
      body: {
        providerId: data.providerId,
        samlConfig: { cert: data.certificate },
      },
      headers,
    });

    return { ok: true };
  });

export const deleteWorkspaceSSOProvider = createServerFn({ method: "POST" })
  .validator(workspaceProviderIdSchema)
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

    const { ssoProviderStore } = await loadWorkspaceSSOServerModules();
    const { loadStoredWorkspaceIdentity } = ssoProviderStore;
    const workspaceIdentity = await loadStoredWorkspaceIdentity(activeWorkspace.id);
    if (workspaceIdentity?.primaryProviderId === data.providerId) {
      await saveWorkspacePrimarySSOProvider(null);
    }

    return { ok: true };
  });

export const resolveWorkspaceSSOSignIn = createServerFn({ method: "POST" })
  .validator(publicSSOResolutionSchema)
  .handler(async ({ data }) => {
    const rawDomain = data.email.split("@")[1];
    /* v8 ignore start -- Unreachable: the validator already enforces z.string().email(), so a domain part always exists. */
    if (!rawDomain) {
      throw new Error("Atlas SSO email invariant: validated email always contains a domain part.");
    }
    /* v8 ignore stop */
    const emailDomain = rawDomain.trim().toLowerCase();
    const {
      auth: authModule,
      requestHeaders,
      ssoProviderStore,
    } = await loadWorkspaceSSOServerModules();
    const { ensureAuthReady } = authModule;
    const { getBrowserSessionHeaders } = requestHeaders;
    const { listStoredWorkspaceSSOProviders, loadStoredWorkspaceIdentity } = ssoProviderStore;
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
    const firstWorkspace = groupedWorkspaces[0];
    /* v8 ignore start -- Unreachable: the size !== 1 guard above already returned, so entry zero always exists. */
    if (!firstWorkspace) {
      throw new Error("Atlas SSO grouping invariant: size === 1 implies a first workspace.");
    }
    /* v8 ignore stop */
    const [organizationId, workspaceProviders] = firstWorkspace;

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
