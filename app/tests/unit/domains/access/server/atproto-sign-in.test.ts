import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeAtprotoSignIn: vi.fn(),
  ensureAuthReady: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

describe("createAtprotoSessionForUser", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.completeAtprotoSignIn.mockReset();
    mocks.ensureAuthReady.mockReset();
  });

  it("asks Better Auth to create a session only through its server-only endpoint", async () => {
    const sessionResponse = new Response(null, {
      headers: { "set-cookie": "better-auth.session_token=opaque; HttpOnly" },
      status: 204,
    });
    mocks.completeAtprotoSignIn.mockResolvedValue(sessionResponse);
    mocks.ensureAuthReady.mockResolvedValue({
      api: { completeAtprotoSignIn: mocks.completeAtprotoSignIn },
    });
    const { createAtprotoSessionForUser } = await import("@/domains/access/server/atproto-sign-in");

    await expect(createAtprotoSessionForUser("user_1")).resolves.toBe(sessionResponse);
    expect(mocks.completeAtprotoSignIn).toHaveBeenCalledWith({
      asResponse: true,
      body: { userId: "user_1" },
    });
  });
});
