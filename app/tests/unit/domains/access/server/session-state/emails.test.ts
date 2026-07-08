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

describe("session-state email flows", () => {
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
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: false,
    });
    mocks.validateAuthRuntimeConfig.mockReturnValue(undefined);
  });

  it("rejects magic-link requests while auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "operator@atlas.test",
      }),
    ).rejects.toThrow("LOCAL_MODE");
  });

  it("hides auth misconfiguration behind a temporary sign-in error", async () => {
    mocks.validateAuthRuntimeConfig.mockImplementation(() => {
      throw new Error("missing config");
    });

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "operator@atlas.test",
      }),
    ).rejects.toThrow("AUTH_UNAVAILABLE");
  });

  it("returns success without touching auth for emails without workspace access", async () => {
    mocks.canEmailAccessAtlas.mockResolvedValue(false);

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "outside@atlas.test",
      }),
    ).resolves.toEqual({ ok: true, captureMailboxUrl: null });

    expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
  });

  it("starts the Better Auth magic-link flow for allowlisted or invited emails", async () => {
    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        callbackURL: "/account",
        email: "operator@atlas.test",
        name: "Operator",
      }),
    ).resolves.toEqual({ ok: true, captureMailboxUrl: null });

    expect(authApi.signInMagicLink).toHaveBeenCalledWith({
      body: {
        callbackURL: "/account",
        email: "operator@atlas.test",
        name: "Operator",
      },
      headers: browserSessionHeaders,
    });
  });

  it("returns success immediately when local mode requests verification email delivery", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      localMode: true,
    });

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).resolves.toEqual({ ok: true });
  });

  it("skips verification delivery for already-verified operators", async () => {
    authApi.getSession.mockResolvedValue(createBetterAuthSession());

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).resolves.toEqual({ ok: true });

    expect(authApi.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("sends verification email for unverified signed-in operators", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        emailVerified: false,
      }),
    );

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).resolves.toEqual({ ok: true });

    expect(authApi.sendVerificationEmail).toHaveBeenCalledWith({
      body: {
        callbackURL: "/account-setup",
        email: "operator@atlas.test",
      },
      headers: browserSessionHeaders,
    });
  });

  it("wraps verification-delivery failures as EMAIL_DELIVERY_FAILED", async () => {
    authApi.getSession.mockResolvedValue(
      createBetterAuthSession({
        emailVerified: false,
      }),
    );
    authApi.sendVerificationEmail.mockRejectedValue(new Error("smtp down"));

    const { sendVerificationEmailForCurrentSession } =
      await import("@/domains/access/server/session-state");
    await expect(sendVerificationEmailForCurrentSession()).rejects.toThrow("EMAIL_DELIVERY_FAILED");
  });

  it("wraps magic-link delivery failures as EMAIL_DELIVERY_FAILED", async () => {
    authApi.signInMagicLink.mockRejectedValue(new Error("smtp down"));

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "operator@atlas.test",
      }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
  });

  it("returns the capture mailbox url when ATLAS_EMAIL_CAPTURE_URL is set", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      captureUrl: "http://127.0.0.1:8025",
      localMode: false,
    });

    const { requestMagicLinkForEmail } = await import("@/domains/access/server/session-state");
    await expect(
      requestMagicLinkForEmail({
        email: "operator@atlas.test",
      }),
    ).resolves.toEqual({
      ok: true,
      captureMailboxUrl: "http://127.0.0.1:8025/messages",
    });
  });
});
