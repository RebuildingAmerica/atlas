import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("session-state account lookup", () => {
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

  it("checkEmailAccountExists delegates to hasExistingAccount", async () => {
    mocks.hasExistingAccount.mockResolvedValue(true);

    const { checkEmailAccountExists } = await import("@/domains/access/server/session-state");
    await expect(checkEmailAccountExists("operator@atlas.test")).resolves.toBe(true);
    expect(mocks.hasExistingAccount).toHaveBeenCalledWith("operator@atlas.test");

    mocks.hasExistingAccount.mockResolvedValue(false);
    await expect(checkEmailAccountExists("missing@atlas.test")).resolves.toBe(false);
  });
});
