import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getSession: vi.fn(),
  getToken: vi.fn(),
  registerOrTouchScoutDevice: vi.fn(),
  resolvePrimaryWorkspaceId: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/workspace-lookup", () => ({
  resolvePrimaryWorkspaceId: mocks.resolvePrimaryWorkspaceId,
}));

vi.mock("@/domains/access/server/scout-devices", () => {
  class ScoutDeviceRevokedError extends Error {}

  return {
    ScoutDeviceRevokedError,
    registerOrTouchScoutDevice: mocks.registerOrTouchScoutDevice,
  };
});

describe("issueScoutTokenRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.ensureAuthReady.mockReset();
    mocks.getSession.mockReset();
    mocks.getToken.mockReset();
    mocks.registerOrTouchScoutDevice.mockReset();
    mocks.resolvePrimaryWorkspaceId.mockReset();
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        getSession: mocks.getSession,
        getToken: mocks.getToken,
      },
    });
    mocks.registerOrTouchScoutDevice.mockResolvedValue({
      id: "worker-123",
    });
  });

  it("rejects non-POST token exchange requests", async () => {
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token"),
    );

    expect(response.status).toBe(405);
    expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
  });

  it("rejects missing bearer sessions", async () => {
    mocks.getSession.mockResolvedValue(null);
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("returns an API token and workspace hint for valid Scout sessions", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user-123", email: "user@example.org" },
    });
    mocks.getToken.mockResolvedValue({ token: "api-jwt" });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue("org-123");
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", {
        body: JSON.stringify({
          default_upload_target: "workspace",
          search_key_configured: true,
          worker_id: "worker-123",
          worker_name: "Willie's MacBook Pro",
          workspace_id: "org-123",
        }),
        headers: { Authorization: "Bearer device-session-token" },
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      token: "api-jwt",
      user: { id: "user-123", email: "user@example.org" },
      worker_id: "worker-123",
      workspace_id: "org-123",
    });
    expect(mocks.registerOrTouchScoutDevice).toHaveBeenCalledWith({
      defaultUploadTarget: "workspace",
      id: "worker-123",
      searchKeyConfigured: true,
      userId: "user-123",
      workerName: "Willie's MacBook Pro",
      workspaceId: "org-123",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("accepts first-run public Scout logins with no worker id yet", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user-123", email: "user@example.org" },
    });
    mocks.getToken.mockResolvedValue({ token: "api-jwt" });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue(null);
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", {
        body: JSON.stringify({
          default_upload_target: "public",
          search_key_configured: false,
          worker_id: null,
          worker_name: "Willie's MacBook Pro",
          workspace_id: null,
        }),
        headers: { Authorization: "Bearer device-session-token" },
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      token: "api-jwt",
      user: { id: "user-123", email: "user@example.org" },
      worker_id: "worker-123",
      workspace_id: null,
    });
    expect(mocks.registerOrTouchScoutDevice).toHaveBeenCalledWith({
      defaultUploadTarget: "public",
      id: undefined,
      searchKeyConfigured: false,
      userId: "user-123",
      workerName: "Willie's MacBook Pro",
      workspaceId: null,
    });
  });

  it("blocks revoked Scout workers before issuing a new API token", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user-123", email: "user@example.org" },
    });
    mocks.getToken.mockResolvedValue({ token: "api-jwt" });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue("org-123");
    const { ScoutDeviceRevokedError } = await import("@/domains/access/server/scout-devices");
    mocks.registerOrTouchScoutDevice.mockRejectedValue(new ScoutDeviceRevokedError("worker-123"));
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", {
        body: JSON.stringify({
          default_upload_target: "workspace",
          worker_id: "worker-123",
          worker_name: "Willie's MacBook Pro",
          workspace_id: "org-123",
        }),
        headers: { Authorization: "Bearer device-session-token" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("explains that Scout device metadata is required when the body is unusable", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-123", email: "user@example.org" } });
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", {
        body: "{not json",
        headers: { Authorization: "Bearer device-session-token" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Scout device metadata is required.",
    });
    expect(mocks.registerOrTouchScoutDevice).not.toHaveBeenCalled();
  });

  it("does not disguise an unexpected enrollment failure as a revocation", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-123", email: "user@example.org" } });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue("org-123");
    mocks.registerOrTouchScoutDevice.mockRejectedValue(new Error("database is offline"));
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    await expect(
      issueScoutTokenRequest(
        new Request("https://atlas.test/api/auth/scout/token", {
          body: JSON.stringify({
            default_upload_target: "workspace",
            worker_name: "Willie's MacBook Pro",
          }),
          headers: { Authorization: "Bearer device-session-token" },
          method: "POST",
        }),
      ),
    ).rejects.toThrow("database is offline");
  });

  it("reports a failure rather than an empty token when Better Auth mints none", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-123", email: "user@example.org" } });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue("org-123");
    mocks.getToken.mockResolvedValue(null);
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", {
        body: JSON.stringify({
          default_upload_target: "workspace",
          worker_name: "Willie's MacBook Pro",
        }),
        headers: { Authorization: "Bearer device-session-token" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Scout token could not be issued",
    });
  });

  it("returns an empty email when the account has none on file", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-123" } });
    mocks.resolvePrimaryWorkspaceId.mockResolvedValue(null);
    mocks.getToken.mockResolvedValue({ token: "api-jwt" });
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token", {
        body: JSON.stringify({
          default_upload_target: "public",
          worker_name: "Willie's MacBook Pro",
        }),
        headers: { Authorization: "Bearer device-session-token" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: "api-jwt",
      user: { email: "", id: "user-123" },
      worker_id: "worker-123",
      workspace_id: null,
    });
  });
});
