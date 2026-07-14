import { beforeEach, describe, expect, it, vi } from "vitest";

const pdsMocks = vi.hoisted(() => ({
  createAccount: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: pdsMocks.getAuthRuntimeConfig,
}));

vi.mock("@atproto/api", () => ({
  AtpAgent: vi.fn(function AtpAgent() {
    return { createAccount: pdsMocks.createAccount };
  }),
}));

describe("provisionManagedAtprotoIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
    pdsMocks.createAccount.mockReset();
    pdsMocks.getAuthRuntimeConfig.mockReset();
    vi.unstubAllEnvs();
  });

  it("requires an HTTPS Atlas PDS URL", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({ atprotoPdsUrl: null });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({ handle: "civic.atlas.test", userId: "user_1" }),
    ).rejects.toThrow("ATLAS_PDS_PUBLIC_URL is required to provision an Atlas identity.");
  });

  it("creates an Atlas PDS account while returning only public identity data", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.createAccount.mockImplementation((input: { handle: string; password: string }) => {
      expect(input.handle).toBe("civic.atlas.test");
      expect(input.password).toHaveLength(43);
      return Promise.resolve({
        data: {
          accessJwt: "access-token-must-not-leave-the-adapter",
          did: "did:plc:managed",
          handle: "civic.atlas.test",
          refreshJwt: "refresh-token-must-not-leave-the-adapter",
        },
      });
    });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({ handle: "civic.atlas.test", userId: "user_1" }),
    ).resolves.toEqual({
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      pds_url: "https://pds.atlas.test",
    });
    expect(pdsMocks.createAccount).toHaveBeenCalledTimes(1);
  });

  it("uses a credential-free managed identity fixture in the ATProto E2E harness", async () => {
    vi.stubEnv("ATLAS_ATPROTO_OAUTH_E2E_HARNESS", "1");
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({ atprotoPdsUrl: null });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({ handle: "Workspace.Atlas.Test", userId: "user_1" }),
    ).resolves.toEqual({
      current_handle: "workspace.atlas.test",
      did: "did:web:workspace.atlas.test",
      pds_url: "https://pds.atlas-e2e.test",
    });
    expect(pdsMocks.createAccount).not.toHaveBeenCalled();
  });
});
