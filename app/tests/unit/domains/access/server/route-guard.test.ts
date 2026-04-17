import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasSessionFixture } from "../../../../fixtures/access/sessions";

const getAtlasSessionMock = vi.fn();

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: getAtlasSessionMock,
}));

describe("requireAtlasSession", () => {
  beforeEach(() => {
    getAtlasSessionMock.mockReset();
  });

  it("returns the session when one exists", async () => {
    const session = createAtlasSessionFixture();
    getAtlasSessionMock.mockResolvedValue(session);

    const { requireAtlasSession } = await import("@/domains/access/server/route-guard");

    await expect(requireAtlasSession("/discovery")).resolves.toEqual(session);
  });

  it("redirects to sign-in when the operator is not authenticated", async () => {
    getAtlasSessionMock.mockResolvedValue(null);
    const { requireAtlasSession } = await import("@/domains/access/server/route-guard");

    await expect(requireAtlasSession("/discovery")).rejects.toBeInstanceOf(Response);
    await expect(requireAtlasSession("/discovery")).rejects.toMatchObject({
      status: 307,
    });
  });
});

describe("requireReadyAtlasSession", () => {
  beforeEach(() => {
    getAtlasSessionMock.mockReset();
  });

  it("returns the session when account setup is complete", async () => {
    const session = createAtlasSessionFixture();
    getAtlasSessionMock.mockResolvedValue(session);

    const { requireReadyAtlasSession } = await import("@/domains/access/server/route-guard");

    await expect(requireReadyAtlasSession("/discovery")).resolves.toEqual(session);
  });

  it("redirects incomplete operators to account setup", async () => {
    getAtlasSessionMock.mockResolvedValue(
      createAtlasSessionFixture({
        accountReady: false,
        hasPasskey: false,
        passkeyCount: 0,
        user: {
          emailVerified: false,
        },
      }),
    );
    const { requireReadyAtlasSession } = await import("@/domains/access/server/route-guard");

    try {
      await requireReadyAtlasSession("/discovery");
      throw new Error("Expected requireReadyAtlasSession to redirect incomplete operators.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response & {
        options?: {
          search?: {
            redirect?: string;
          };
          to?: string;
        };
      };
      expect(response.status).toBe(307);
      expect(response.options?.search?.redirect).toBe("/discovery");
      expect(response.options?.to).toBe("/account-setup");
    }
  });
});

describe("requireIncompleteAtlasSession", () => {
  beforeEach(() => {
    getAtlasSessionMock.mockReset();
  });

  it("returns the session when setup is still incomplete", async () => {
    const session = createAtlasSessionFixture({
      accountReady: false,
      hasPasskey: false,
      passkeyCount: 0,
      user: {
        emailVerified: false,
      },
    });
    getAtlasSessionMock.mockResolvedValue(session);

    const { requireIncompleteAtlasSession } = await import("@/domains/access/server/route-guard");

    await expect(requireIncompleteAtlasSession("/account-setup")).resolves.toEqual(session);
  });

  it("redirects ready operators away from account setup", async () => {
    getAtlasSessionMock.mockResolvedValue(createAtlasSessionFixture());
    const { requireIncompleteAtlasSession } = await import("@/domains/access/server/route-guard");

    try {
      await requireIncompleteAtlasSession("/account-setup", "/account");
      throw new Error("Expected requireIncompleteAtlasSession to redirect ready operators.");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
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
