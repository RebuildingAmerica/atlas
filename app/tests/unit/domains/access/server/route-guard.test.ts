import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireAtlasSession,
  requireIncompleteAtlasSession,
  requireReadyAtlasSession,
} from "@/domains/access/server/route-guard";

const mocks = vi.hoisted(() => ({
  getAtlasSession: Object.assign(vi.fn(), { __executeServer: vi.fn() }),
  getAuthRuntimeConfig: vi.fn(() => ({ localMode: true })),
  getBrowserSessionHeaders: vi.fn(() => new Headers()),
  redirect: vi.fn((options: Record<string, unknown>) => {
    const err = new Error("Redirect") as Error & { options: Record<string, unknown> };
    err.options = options;
    throw err;
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/domains/access/server/request-headers", () => ({
  getBrowserSessionHeaders: mocks.getBrowserSessionHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: mocks.getAtlasSession,
}));

describe("route-guard", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAtlasSession.mockReset();
    mocks.redirect.mockClear();
  });

  it("redirects to sign-in when no session is present", async () => {
    mocks.getAtlasSession.mockResolvedValue(null);

    await expect(requireAtlasSession("/dashboard")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/sign-in",
        search: { redirect: "/dashboard" },
      }),
    );
  });

  it("returns the session when authenticated", async () => {
    const session = { accountReady: true };
    mocks.getAtlasSession.mockResolvedValue(session);

    const result = await requireAtlasSession("/dashboard");
    expect(result).toBe(session);
  });

  it("redirects to account-setup when the account is not ready", async () => {
    const session = { accountReady: false };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireReadyAtlasSession("/dashboard")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/account-setup",
      }),
    );
  });

  it("redirects a ready operator away from account-setup", async () => {
    const session = {
      accountReady: true,
      hasPasskey: true,
      workspace: { onboarding: { needsWorkspace: false, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/account-setup")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/account",
      }),
    );
  });

  it("redirects to organization when a workspace is needed", async () => {
    const session = {
      accountReady: true,
      hasPasskey: true,
      workspace: { onboarding: { needsWorkspace: true, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/account-setup")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/organization",
      }),
    );
  });

  it("keeps an email-verified-but-passkey-less operator on account-setup", async () => {
    const session = {
      accountReady: true,
      hasPasskey: false,
      workspace: { onboarding: { needsWorkspace: false, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/account-setup")).resolves.toEqual(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
