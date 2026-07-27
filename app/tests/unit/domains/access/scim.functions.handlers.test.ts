import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveCapabilities,
  serializeResolvedCapabilities,
} from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type * as OrganizationServerHelpersModule from "@/domains/access/organization-server-helpers";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  deleteSCIMProviderConnection: vi.fn(),
  generateSCIMToken: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  listSCIMProviderConnections: vi.fn(),
  loadOrganizationRequestContext: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub, createServerOnlyFnStub } =
    await import("../../../helpers/server-fn-stub");
  return {
    createServerFn: createServerFnStub(),
    createServerOnlyFn: createServerOnlyFnStub(),
  };
});

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/organization-server-helpers", async () => {
  const actual = await vi.importActual<typeof OrganizationServerHelpersModule>(
    "@/domains/access/organization-server-helpers",
  );
  return {
    ...actual,
    loadOrganizationRequestContext: mocks.loadOrganizationRequestContext,
  };
});

describe("scim.functions handlers", () => {
  const headers = new Headers({ cookie: "better-auth.session_token=test-token" });

  beforeEach(() => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ publicBaseUrl: "https://atlas.test" });
    mocks.listSCIMProviderConnections.mockResolvedValue({
      providers: [
        { id: "conn_1", organizationId: "org_team", providerId: "atlas-team-scim" },
        { id: "conn_2", organizationId: "org_other", providerId: "other-team-scim" },
        { id: "conn_3", organizationId: null, providerId: "unscoped-scim" },
      ],
    });
    mocks.generateSCIMToken.mockResolvedValue({ scimToken: "scim_secret_token" });
    mocks.deleteSCIMProviderConnection.mockResolvedValue(undefined);
    mocks.loadOrganizationRequestContext.mockResolvedValue({
      auth: {
        api: {
          deleteSCIMProviderConnection: mocks.deleteSCIMProviderConnection,
          generateSCIMToken: mocks.generateSCIMToken,
          listSCIMProviderConnections: mocks.listSCIMProviderConnections,
        },
      },
      headers,
      session: createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          activeProducts: ["atlas_team"],
          resolvedCapabilities: serializeResolvedCapabilities(resolveCapabilities(["atlas_team"])),
        }),
      }),
    });
  });

  it("hands an admin the SCIM endpoints and a provider id their IdP can use", async () => {
    const { loadWorkspaceSCIMSetup } = await import("@/domains/access/scim.functions");

    const response = (await loadWorkspaceSCIMSetup.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      defaultProviderId: "atlas-team-scim",
      providers: [{ id: "conn_1", organizationId: "org_team", providerId: "atlas-team-scim" }],
      scimBaseUrl: "https://atlas.test/api/auth/scim/v2",
      serviceProviderConfigUrl: "https://atlas.test/api/auth/scim/v2/ServiceProviderConfig",
      usersUrl: "https://atlas.test/api/auth/scim/v2/Users",
    });
    expect(mocks.listSCIMProviderConnections).toHaveBeenCalledWith({ headers });
  });

  it("keeps the SCIM endpoints on the deployment's own origin", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      publicBaseUrl: "https://atlas.example.org/workspace/",
    });
    const { loadWorkspaceSCIMSetup } = await import("@/domains/access/scim.functions");

    const response = (await loadWorkspaceSCIMSetup.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse<{ scimBaseUrl: string; usersUrl: string }>;

    expect(response.result?.scimBaseUrl).toBe("https://atlas.example.org/api/auth/scim/v2");
    expect(response.result?.usersUrl).toBe("https://atlas.example.org/api/auth/scim/v2/Users");
  });

  it("refuses SCIM setup to a workspace without the Team capability", async () => {
    mocks.loadOrganizationRequestContext.mockResolvedValue({
      auth: { api: { listSCIMProviderConnections: mocks.listSCIMProviderConnections } },
      headers,
      session: createAtlasSessionFixture(),
    });
    const { loadWorkspaceSCIMSetup } = await import("@/domains/access/scim.functions");

    const response = (await loadWorkspaceSCIMSetup.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toEqual(new Error("SCIM setup is available on Atlas Team."));
    expect(mocks.listSCIMProviderConnections).not.toHaveBeenCalled();
  });

  it("issues a bearer token scoped to the workspace and returns it once", async () => {
    const { generateWorkspaceSCIMToken } = await import("@/domains/access/scim.functions");

    const response = (await generateWorkspaceSCIMToken.__executeServer({
      data: { providerId: "  okta-scim  " },
      method: "POST",
    })) as ServerFnExecutionResponse<{ providerId: string; scimToken: string; usersUrl: string }>;

    expect(response.error).toBeUndefined();
    expect(response.result?.scimToken).toBe("scim_secret_token");
    expect(response.result?.providerId).toBe("okta-scim");
    expect(response.result?.usersUrl).toBe("https://atlas.test/api/auth/scim/v2/Users");
    expect(mocks.generateSCIMToken).toHaveBeenCalledWith({
      body: { organizationId: "org_team", providerId: "okta-scim" },
      headers,
    });
  });

  it("rejects a provider id an IdP could never send", async () => {
    const { generateWorkspaceSCIMToken } = await import("@/domains/access/scim.functions");

    const response = (await generateWorkspaceSCIMToken.__executeServer({
      data: { providerId: "okta scim!" },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(String(response.error)).toContain(
      "Use letters, numbers, periods, underscores, colons, or hyphens.",
    );
    expect(mocks.generateSCIMToken).not.toHaveBeenCalled();
  });

  it("rejects an empty provider id rather than minting an unusable token", async () => {
    const { generateWorkspaceSCIMToken } = await import("@/domains/access/scim.functions");

    const response = (await generateWorkspaceSCIMToken.__executeServer({
      data: { providerId: "   " },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeDefined();
    expect(mocks.generateSCIMToken).not.toHaveBeenCalled();
  });

  it("removes a SCIM connection an admin no longer wants", async () => {
    const { deleteWorkspaceSCIMProviderConnection } =
      await import("@/domains/access/scim.functions");

    const response = (await deleteWorkspaceSCIMProviderConnection.__executeServer({
      data: { providerId: "atlas-team-scim" },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ ok: true });
    expect(mocks.deleteSCIMProviderConnection).toHaveBeenCalledWith({
      body: { providerId: "atlas-team-scim" },
      headers,
    });
  });

  it("refuses to remove a SCIM connection from a workspace without the capability", async () => {
    mocks.loadOrganizationRequestContext.mockResolvedValue({
      auth: { api: { deleteSCIMProviderConnection: mocks.deleteSCIMProviderConnection } },
      headers,
      session: createAtlasSessionFixture(),
    });
    const { deleteWorkspaceSCIMProviderConnection } =
      await import("@/domains/access/scim.functions");

    const response = (await deleteWorkspaceSCIMProviderConnection.__executeServer({
      data: { providerId: "atlas-team-scim" },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toEqual(new Error("SCIM setup is available on Atlas Team."));
    expect(mocks.deleteSCIMProviderConnection).not.toHaveBeenCalled();
  });

  it("refuses to run outside the server", async () => {
    vi.stubEnv("SSR", false);
    vi.resetModules();
    const { loadWorkspaceSCIMSetup } = await import("@/domains/access/scim.functions");

    const response = (await loadWorkspaceSCIMSetup.__executeServer({
      method: "GET",
      data: undefined,
    })) as ServerFnExecutionResponse;

    expect(response.error).toEqual(
      new Error("Workspace SCIM server modules are only available on the server."),
    );
  });
});
