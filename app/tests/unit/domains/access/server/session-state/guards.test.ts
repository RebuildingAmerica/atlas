import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBetterAuthSession } from "../../../../../fixtures/access/sessions";
import { createSessionStateAuthApi } from "../../../../../mocks/access/session-state-auth";

const mocks = vi.hoisted(() => ({
  canEmailAccessAtlas: vi.fn(),
  ensureAuthReady: vi.fn(),
  hasExistingAccount: vi.fn(),
  getBrowserSessionHeaders: vi.fn(),
  getAuthRuntimeConfig: vi.fn(),
  validateAuthRuntimeConfig: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  canEmailAccessAtlas: mocks.canEmailAccessAtlas,
  ensureAuthReady: mocks.ensureAuthReady,
  hasExistingAccount: mocks.hasExistingAccount,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
  validateAuthRuntimeConfig: mocks.validateAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveProducts: vi.fn().mockResolvedValue([]),
}));

describe("session-state guards", () => {
  const browserSessionHeaders = new Headers({
    cookie: "better-auth.session_token=test-token",
  });
  let authApi = createSessionStateAuthApi();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    authApi = createSessionStateAuthApi();

    mocks.canEmailAccessAtlas.mockResolvedValue(true);
    mocks.ensureAuthReady.mockResolvedValue({ api: authApi });
    mocks.getBrowserSessionHeaders.mockReturnValue(browserSessionHeaders);
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: false });
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
  });

  it("rejects unauthorized session requirements", async () => {
    authApi.getSession.mockResolvedValue(null);

    const { requireAtlasSessionState } = await import("@/domains/access/server/session-state");
    await expect(requireAtlasSessionState()).rejects.toThrow("Unauthorized");
  });

  it("rejects incomplete session requirements until account setup finishes", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        emailVerified: false,
      }),
    );
    authApi.listPasskeys.mockResolvedValue([]);

    const { requireReadyAtlasSessionState } = await import("@/domains/access/server/session-state");
    await expect(requireReadyAtlasSessionState()).rejects.toThrow(
      "Complete account setup before creating Atlas resources.",
    );
  });

  it("returns ready session requirements once account setup is complete", async () => {
    authApi.getSession.mockResolvedValue(createBetterAuthSession());
    authApi.listPasskeys.mockResolvedValue([{}]);

    const { requireReadyAtlasSessionState } = await import("@/domains/access/server/session-state");
    await expect(requireReadyAtlasSessionState()).resolves.toEqual(
      expect.objectContaining({
        accountReady: true,
      }),
    );
  });
});
