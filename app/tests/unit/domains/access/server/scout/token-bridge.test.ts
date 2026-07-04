import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getSession: vi.fn(),
  getToken: vi.fn(),
  resolvePrimaryWorkspaceId: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

vi.mock("@/domains/access/server/workspace-lookup", () => ({
  resolvePrimaryWorkspaceId: mocks.resolvePrimaryWorkspaceId,
}));

describe("issueScoutTokenRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.ensureAuthReady.mockReset();
    mocks.getSession.mockReset();
    mocks.getToken.mockReset();
    mocks.resolvePrimaryWorkspaceId.mockReset();
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        getSession: mocks.getSession,
        getToken: mocks.getToken,
      },
    });
  });

  it("rejects missing bearer sessions", async () => {
    mocks.getSession.mockResolvedValue(null);
    const { issueScoutTokenRequest } = await import("@/domains/access/server/scout-token");

    const response = await issueScoutTokenRequest(
      new Request("https://atlas.test/api/auth/scout/token"),
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
        headers: { Authorization: "Bearer device-session-token" },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      token: "api-jwt",
      user: { id: "user-123", email: "user@example.org" },
      workspace_id: "org-123",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
