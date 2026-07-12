import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  redirectIfLocalSession,
  requireAtlasSession,
  requireIncompleteAtlasSession,
  requireReadyAtlasSession,
} from "@/domains/access/server/route-guard";

const mocks = vi.hoisted(() => ({
  getAtlasDeployMode: vi.fn(),
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
  getAtlasDeployMode: mocks.getAtlasDeployMode,
  getAtlasSession: mocks.getAtlasSession,
}));

describe("route-guard", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAtlasDeployMode.mockReset();
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

  it("redirects to setup when the account is not ready", async () => {
    const session = { accountReady: false };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireReadyAtlasSession("/dashboard")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/setup",
      }),
    );
  });

  it("redirects to setup when the account has no passkey", async () => {
    const session = { accountReady: true, hasPasskey: false };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireReadyAtlasSession("/dashboard")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        search: { redirect: "/dashboard" },
        to: "/setup",
      }),
    );
  });

  it("redirects a ready operator away from setup", async () => {
    const session = {
      accountReady: true,
      hasPasskey: true,
      workspace: { onboarding: { needsWorkspace: false, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/setup")).rejects.toThrow("Redirect");
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

    await expect(requireIncompleteAtlasSession("/setup")).rejects.toThrow("Redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/organization",
      }),
    );
  });

  it("keeps an email-verified-but-passkey-less operator on setup", async () => {
    const session = {
      accountReady: true,
      hasPasskey: false,
      workspace: { onboarding: { needsWorkspace: false, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/setup")).resolves.toEqual(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the session when ready and accountReady is true", async () => {
    const session = { accountReady: true, hasPasskey: true };
    mocks.getAtlasSession.mockResolvedValue(session);

    const result = await requireReadyAtlasSession("/dashboard");
    expect(result).toBe(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves an already-app-local redirect target as-is", async () => {
    const session = {
      accountReady: true,
      hasPasskey: true,
      workspace: { onboarding: { needsWorkspace: false, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/setup", "/saved/path")).rejects.toThrow(
      "Redirect",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.objectContaining({ to: "/saved/path" }));
  });

  it("falls back when the setup redirect target is protocol-relative", async () => {
    const session = {
      accountReady: true,
      hasPasskey: true,
      workspace: { onboarding: { needsWorkspace: false, hasPendingInvitations: false } },
    };
    mocks.getAtlasSession.mockResolvedValue(session);

    await expect(requireIncompleteAtlasSession("/setup", "//evil.example")).rejects.toThrow(
      "Redirect",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(expect.objectContaining({ to: "/account" }));
  });

  describe("redirectIfLocalSession", () => {
    it("redirects when the deploy mode is local", async () => {
      mocks.getAtlasDeployMode.mockResolvedValue({ localMode: true });

      await expect(redirectIfLocalSession("/discovery")).rejects.toThrow("Redirect");
      expect(mocks.redirect).toHaveBeenCalledWith({ to: "/discovery" });
    });

    it("resolves without redirecting when not in local mode", async () => {
      mocks.getAtlasDeployMode.mockResolvedValue({ localMode: false });

      await expect(redirectIfLocalSession("/discovery")).resolves.toBeUndefined();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });
});
