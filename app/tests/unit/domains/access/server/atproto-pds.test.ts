import { beforeEach, describe, expect, it, vi } from "vitest";

const pdsMocks = vi.hoisted(() => ({
  createAccount: vi.fn(),
  fetch: vi.fn(),
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
    pdsMocks.fetch.mockReset();
    pdsMocks.getAuthRuntimeConfig.mockReset();
    vi.stubGlobal("fetch", pdsMocks.fetch);
    vi.unstubAllEnvs();
  });

  it("requires an HTTPS Atlas PDS URL", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({ atprotoPdsUrl: null });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({
        email: "operator@atlas.test",
        handle: "civic.atlas.test",
        userId: "user_1",
      }),
    ).rejects.toThrow("ATLAS_PDS_PUBLIC_URL is required to provision an Atlas identity.");
  });

  it("creates an Atlas PDS account while returning only public identity data", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsAdminPassword: null,
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.createAccount.mockImplementation(
      (input: { email: string; handle: string; password: string }) => {
        expect(input.email).toBe("operator@atlas.test");
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
      },
    );
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({
        email: "operator@atlas.test",
        handle: "civic.atlas.test",
        userId: "user_1",
      }),
    ).resolves.toEqual({
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      pds_url: "https://pds.atlas.test",
    });
    expect(pdsMocks.createAccount).toHaveBeenCalledTimes(1);
    expect(pdsMocks.fetch).not.toHaveBeenCalled();
  });

  it("mints a one-use Atlas PDS invite when the admin password is configured", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsAdminPassword: "admin-password", // pragma: allowlist secret
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.fetch.mockResolvedValue({
      json: () => Promise.resolve({ code: "invite-code" }),
      ok: true,
    });
    pdsMocks.createAccount.mockResolvedValue({
      data: {
        did: "did:plc:managed",
        handle: "civic.atlas.test",
      },
    });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({
        email: "operator@atlas.test",
        handle: "civic.atlas.test",
        userId: "user_1",
      }),
    ).resolves.toEqual({
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      pds_url: "https://pds.atlas.test",
    });
    const [inviteUrl, inviteRequest] = pdsMocks.fetch.mock.calls[0] as [URL, RequestInit];
    expect(inviteUrl).toEqual(
      new URL("https://pds.atlas.test/xrpc/com.atproto.server.createInviteCode"),
    );
    expect(inviteRequest.body).toBe(JSON.stringify({ useCount: 1 }));
    expect(inviteRequest.method).toBe("POST");
    expect(inviteRequest.headers).toEqual({
      authorization: `Basic ${Buffer.from("admin:admin-password").toString("base64")}`, // pragma: allowlist secret
      "content-type": "application/json",
    });
    expect(pdsMocks.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "operator@atlas.test",
        handle: "civic.atlas.test",
        inviteCode: "invite-code",
      }),
    );
  });

  it("fails explicitly when Atlas PDS invite creation is rejected", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsAdminPassword: "admin-password", // pragma: allowlist secret
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
    });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({
        email: "operator@atlas.test",
        handle: "civic.atlas.test",
        userId: "user_1",
      }),
    ).rejects.toThrow("Atlas PDS invite creation failed with HTTP 401.");
    expect(pdsMocks.createAccount).not.toHaveBeenCalled();
  });

  it("uses a credential-free managed identity fixture in the managed PDS E2E harness", async () => {
    vi.stubEnv("ATLAS_ATPROTO_PDS_E2E_HARNESS", "1");
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({ atprotoPdsUrl: null });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({
        email: "operator@atlas.test",
        handle: "Workspace.Atlas.Test",
        userId: "user_1",
      }),
    ).resolves.toEqual({
      current_handle: "workspace.atlas.test",
      did: "did:web:workspace.atlas.test",
      pds_url: "https://pds.atlas-e2e.test",
    });
    expect(pdsMocks.createAccount).not.toHaveBeenCalled();
  });
});
