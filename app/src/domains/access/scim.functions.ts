import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasSerializedCapability } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { AtlasSessionPayload, AtlasWorkspaceMembership } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import {
  loadOrganizationRequestContext,
  requireManagedTeamWorkspace,
} from "./organization-server-helpers";

const scimProviderIdSchema = z.object({
  providerId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9._:-]+$/, {
      message: "Use letters, numbers, periods, underscores, colons, or hyphens.",
    }),
});

const scimProviderConnectionSchema = z.object({
  id: z.string(),
  organizationId: z.string().nullable(),
  providerId: z.string(),
});

const scimProviderConnectionListSchema = z.object({
  providers: z.array(scimProviderConnectionSchema),
});

const scimTokenResultSchema = z.object({
  scimToken: z.string().min(1),
});

export type AtlasWorkspaceSCIMProviderConnection = z.infer<typeof scimProviderConnectionSchema>;

export interface AtlasWorkspaceSCIMSetup {
  defaultProviderId: string;
  providers: AtlasWorkspaceSCIMProviderConnection[];
  scimBaseUrl: string;
  serviceProviderConfigUrl: string;
  usersUrl: string;
}

export interface AtlasWorkspaceSCIMTokenResult extends AtlasWorkspaceSCIMSetup {
  providerId: string;
  scimToken: string;
}

async function loadWorkspaceSCIMServerModules() {
  if (import.meta.env.SSR) {
    const runtime = await import("./server/runtime");
    return { runtime };
  }

  throw new Error("Workspace SCIM server modules are only available on the server.");
}

/**
 * Requires an active managed Team workspace with the SCIM product capability.
 *
 * @param session - The current Atlas session payload.
 */
export function requireWorkspaceScimAccess(session: AtlasSessionPayload): AtlasWorkspaceMembership {
  const activeWorkspace = requireManagedTeamWorkspace(session);
  if (!hasSerializedCapability(session.workspace.resolvedCapabilities, "auth.scim")) {
    throw new Error("SCIM setup is available on Atlas Team.");
  }
  return activeWorkspace;
}

function buildWorkspaceScimSetup(
  publicBaseUrl: string,
  workspace: AtlasWorkspaceMembership,
  providers: AtlasWorkspaceSCIMProviderConnection[],
): AtlasWorkspaceSCIMSetup {
  const scimBaseUrl = new URL("/api/auth/scim/v2", publicBaseUrl).toString().replace(/\/$/, "");
  return {
    defaultProviderId: `${workspace.slug}-scim`,
    providers,
    scimBaseUrl,
    serviceProviderConfigUrl: `${scimBaseUrl}/ServiceProviderConfig`,
    usersUrl: `${scimBaseUrl}/Users`,
  };
}

async function loadWorkspaceSCIMSetupData(): Promise<AtlasWorkspaceSCIMSetup> {
  const organizationRequestContext = await loadOrganizationRequestContext();
  const { auth, headers, session } = organizationRequestContext;
  const activeWorkspace = requireWorkspaceScimAccess(session);
  const providerList = scimProviderConnectionListSchema.parse(
    await auth.api.listSCIMProviderConnections({ headers }),
  );
  const providers = providerList.providers.filter(
    (provider) => provider.organizationId === activeWorkspace.id,
  );
  const { runtime: runtimeModule } = await loadWorkspaceSCIMServerModules();
  const { getAuthRuntimeConfig } = runtimeModule;
  const runtime = getAuthRuntimeConfig();
  return buildWorkspaceScimSetup(runtime.publicBaseUrl, activeWorkspace, providers);
}

export const loadWorkspaceSCIMSetup = createServerFn({ method: "GET" }).handler(async () => {
  return loadWorkspaceSCIMSetupData();
});

export const generateWorkspaceSCIMToken = createServerFn({ method: "POST" })
  .validator(scimProviderIdSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    const activeWorkspace = requireWorkspaceScimAccess(session);
    const tokenResult = scimTokenResultSchema.parse(
      await auth.api.generateSCIMToken({
        body: {
          organizationId: activeWorkspace.id,
          providerId: data.providerId,
        },
        headers,
      }),
    );
    const setup = await loadWorkspaceSCIMSetupData();
    return {
      ...setup,
      providerId: data.providerId,
      scimToken: tokenResult.scimToken,
    } satisfies AtlasWorkspaceSCIMTokenResult;
  });

export const deleteWorkspaceSCIMProviderConnection = createServerFn({ method: "POST" })
  .validator(scimProviderIdSchema)
  .handler(async ({ data }) => {
    const organizationRequestContext = await loadOrganizationRequestContext();
    const { auth, headers, session } = organizationRequestContext;
    requireWorkspaceScimAccess(session);

    await auth.api.deleteSCIMProviderConnection({
      body: {
        providerId: data.providerId,
      },
      headers,
    });

    return { ok: true };
  });
