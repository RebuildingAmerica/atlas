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
        expect(input.email).toMatch(/^operator\+atlas-[a-f0-9]{16}@atlas\.test$/);
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

  it("uses a unique managed PDS email for each Atlas identity owned by the same user", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsAdminPassword: null,
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.createAccount.mockImplementation(
      (input: { email: string; handle: string; password: string }) =>
        Promise.resolve({
          data: {
            did: `did:plc:${input.handle.split(".")[0]}`,
            handle: input.handle,
          },
        }),
    );
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await provisionManagedAtprotoIdentity({
      email: "operator@atlas.test",
      handle: "person.atlas.test",
      userId: "user_1",
    });
    await provisionManagedAtprotoIdentity({
      email: "operator@atlas.test",
      handle: "organization.atlas.test",
      userId: "user_1",
    });

    const emails = pdsMocks.createAccount.mock.calls.map((call) => {
      const input = call[0] as { email: string };
      return input.email;
    });
    expect(emails).toHaveLength(2);
    expect(emails[0]).not.toBe("operator@atlas.test");
    expect(emails[1]).not.toBe("operator@atlas.test");
    expect(emails[0]).not.toBe(emails[1]);
    expect(emails[0]).toMatch(/^operator\+atlas-[a-f0-9]{16}@atlas\.test$/);
    expect(emails[1]).toMatch(/^operator\+atlas-[a-f0-9]{16}@atlas\.test$/);
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
    expect(pdsMocks.createAccount).toHaveBeenCalledTimes(1);
    const [accountInput] = pdsMocks.createAccount.mock.calls[0] as unknown as [
      { email: string; handle: string; inviteCode?: string },
    ];
    expect(accountInput.email).toMatch(/^operator\+atlas-[a-f0-9]{16}@atlas\.test$/);
    expect(accountInput.handle).toBe("civic.atlas.test");
    expect(accountInput.inviteCode).toBe("invite-code");
  });

  it("mints a one-use Atlas PDS invite through the broker when configured", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsAdminPassword: "fallback-admin-password", // pragma: allowlist secret
      atprotoPdsInviteBrokerSecret: "broker-secret", // pragma: allowlist secret
      atprotoPdsInviteBrokerUrl: "https://pds.atlas.test/_atlas/pds/invites",
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.fetch.mockResolvedValue({
      json: () => Promise.resolve({ code: "broker-invite-code" }),
      ok: true,
    });
    pdsMocks.createAccount.mockResolvedValue({
      data: {
        did: "did:plc:managed",
        handle: "civic.atlas.test",
      },
    });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await provisionManagedAtprotoIdentity({
      email: "operator@atlas.test",
      handle: "civic.atlas.test",
      userId: "user_1",
    });

    const [inviteUrl, inviteRequest] = pdsMocks.fetch.mock.calls[0] as [URL, RequestInit];
    expect(inviteUrl).toEqual(new URL("https://pds.atlas.test/_atlas/pds/invites"));
    expect(inviteRequest.body).toBe(JSON.stringify({ useCount: 1 }));
    expect(inviteRequest.method).toBe("POST");
    expect(inviteRequest.headers).toEqual({
      authorization: "Bearer broker-secret", // pragma: allowlist secret
      "content-type": "application/json",
    });
    const [accountInput] = pdsMocks.createAccount.mock.calls[0] as unknown as [
      { inviteCode?: string },
    ];
    expect(accountInput.inviteCode).toBe("broker-invite-code");
  });

  it("fails explicitly when Atlas PDS invite broker creation is rejected", async () => {
    pdsMocks.getAuthRuntimeConfig.mockReturnValue({
      atprotoPdsAdminPassword: null,
      atprotoPdsInviteBrokerSecret: "broker-secret", // pragma: allowlist secret
      atprotoPdsInviteBrokerUrl: "https://pds.atlas.test/_atlas/pds/invites",
      atprotoPdsUrl: "https://pds.atlas.test",
    });
    pdsMocks.fetch.mockResolvedValue({
      ok: false,
      status: 502,
    });
    const { provisionManagedAtprotoIdentity } = await import("@/domains/access/server/atproto-pds");

    await expect(
      provisionManagedAtprotoIdentity({
        email: "operator@atlas.test",
        handle: "civic.atlas.test",
        userId: "user_1",
      }),
    ).rejects.toThrow("Atlas PDS invite broker failed with HTTP 502.");
    expect(pdsMocks.createAccount).not.toHaveBeenCalled();
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
