import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signJWT: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: () => Promise.resolve({ api: { signJWT: mocks.signJWT } }),
}));

describe("createAppActorHeaders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    mocks.signJWT.mockReset();
    mocks.signJWT.mockResolvedValue({ token: "signed.assertion.token" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs a one-minute assertion for the person the app acts for", async () => {
    const { APP_ACTOR_AUDIENCE, createAppActorHeaders } =
      await import("@/domains/access/server/app-actor-assertion");

    const headers = await createAppActorHeaders(
      { email: "editor@rebuildingus.org", id: "user_1" },
      { accountReady: true, organizationId: "org_1" },
    );

    expect(headers).toEqual({ "X-Atlas-Actor-Assertion": "signed.assertion.token" });
    const now = Math.floor(new Date("2026-10-02T12:00:00Z").getTime() / 1000);
    expect(mocks.signJWT).toHaveBeenCalledWith({
      body: {
        payload: {
          account_ready: true,
          aud: APP_ACTOR_AUDIENCE,
          email: "editor@rebuildingus.org",
          exp: now + 60,
          iat: now,
          org_id: "org_1",
          sub: "user_1",
        },
      },
    });
  });

  it("omits the workspace and says not ready when the session has neither", async () => {
    const { createAppActorHeaders } = await import("@/domains/access/server/app-actor-assertion");

    await createAppActorHeaders({ email: "a@b.org", id: "u" }, { accountReady: false });

    const call = mocks.signJWT.mock.calls[0]?.[0] as { body: { payload: Record<string, unknown> } };
    expect(call.body.payload.account_ready).toBe(false);
    expect(call.body.payload).not.toHaveProperty("org_id");
  });

  it("uses an audience no customer token can carry", async () => {
    const { APP_ACTOR_AUDIENCE } = await import("@/domains/access/server/app-actor-assertion");

    expect(APP_ACTOR_AUDIENCE).toBe("urn:atlas:app-actor");
  });
});
