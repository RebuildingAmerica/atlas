import { beforeEach, describe, expect, it, vi } from "vitest";

const getAtlasSessionMock = vi.fn();

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: getAtlasSessionMock,
}));

describe("route-guard additional branches", () => {
  beforeEach(() => {
    vi.resetModules();
    getAtlasSessionMock.mockReset();
  });

  it("redirects unauthenticated operators away from ready-only routes", async () => {
    getAtlasSessionMock.mockResolvedValue(null);
    const { requireReadyAtlasSession } = await import("@/domains/access/server/route-guard");

    await expect(requireReadyAtlasSession("/discovery")).rejects.toMatchObject({
      status: 307,
    });
  });

  it("redirects unauthenticated operators away from incomplete-only routes", async () => {
    getAtlasSessionMock.mockResolvedValue(null);
    const { requireIncompleteAtlasSession } = await import("@/domains/access/server/route-guard");

    await expect(requireIncompleteAtlasSession("/account-setup")).rejects.toMatchObject({
      status: 307,
    });
  });

  it("normalizes absolute redirect targets back to app-local paths", async () => {
    getAtlasSessionMock.mockResolvedValue({
      accountReady: true,
      hasPasskey: true,
      passkeyCount: 1,
      session: { id: "session_123" },
      user: {
        email: "operator@atlas.test",
        emailVerified: true,
        id: "user_123",
        name: "Operator",
      },
      workspace: {
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: false,
        },
      },
    });

    const { requireIncompleteAtlasSession } = await import("@/domains/access/server/route-guard");

    try {
      await requireIncompleteAtlasSession(
        "/account-setup",
        "https://atlas.test/discovery?query=housing#map",
      );
      throw new Error("Expected requireIncompleteAtlasSession to redirect ready operators.");
    } catch (error) {
      const response = error as Response & {
        options?: {
          to?: string;
        };
      };
      expect(response.status).toBe(307);
      expect(response.options?.to).toBe("/discovery?query=housing#map");
    }
  });

  it("falls back to the account page for malformed redirect targets", async () => {
    getAtlasSessionMock.mockResolvedValue({
      accountReady: true,
      hasPasskey: true,
      passkeyCount: 1,
      session: { id: "session_123" },
      user: {
        email: "operator@atlas.test",
        emailVerified: true,
        id: "user_123",
        name: "Operator",
      },
      workspace: {
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: false,
        },
      },
    });

    const { requireIncompleteAtlasSession } = await import("@/domains/access/server/route-guard");

    try {
      await requireIncompleteAtlasSession("/account-setup", "not a url");
      throw new Error("Expected requireIncompleteAtlasSession to redirect ready operators.");
    } catch (error) {
      const response = error as Response & {
        options?: {
          to?: string;
        };
      };
      expect(response.status).toBe(307);
      expect(response.options?.to).toBe("/account");
    }
  });

  it("falls back to the account page when no redirect target is provided", async () => {
    getAtlasSessionMock.mockResolvedValue({
      accountReady: true,
      hasPasskey: true,
      passkeyCount: 1,
      session: { id: "session_123" },
      user: {
        email: "operator@atlas.test",
        emailVerified: true,
        id: "user_123",
        name: "Operator",
      },
      workspace: {
        onboarding: {
          hasPendingInvitations: false,
          needsWorkspace: false,
        },
      },
    });

    const { requireIncompleteAtlasSession } = await import("@/domains/access/server/route-guard");

    try {
      await requireIncompleteAtlasSession("/account-setup");
      throw new Error("Expected requireIncompleteAtlasSession to redirect ready operators.");
    } catch (error) {
      const response = error as Response & {
        options?: {
          to?: string;
        };
      };
      expect(response.status).toBe(307);
      expect(response.options?.to).toBe("/account");
    }
  });
});
