import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAtlasSession: vi.fn(),
  loadOidcRpLogoutRedirect: vi.fn(),
  requestMagicLinkForEmail: vi.fn(),
  requireAtlasSessionState: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
  sendVerificationEmailForCurrentSession: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/rp-logout", () => ({
  loadOidcRpLogoutRedirect: mocks.loadOidcRpLogoutRedirect,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  loadAtlasSession: mocks.loadAtlasSession,
  requestMagicLinkForEmail: mocks.requestMagicLinkForEmail,
  requireAtlasSessionState: mocks.requireAtlasSessionState,
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
  sendVerificationEmailForCurrentSession: mocks.sendVerificationEmailForCurrentSession,
}));

describe("session.functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadAtlasSession.mockReset();
    mocks.loadOidcRpLogoutRedirect.mockReset();
    mocks.requestMagicLinkForEmail.mockReset();
    mocks.requireAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.sendVerificationEmailForCurrentSession.mockReset();
  });

  it("returns the current Atlas session", async () => {
    const session = {
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
    };
    mocks.loadAtlasSession.mockResolvedValue(session);

    const { getAtlasSession } = await import("@/domains/access/session.functions");
    const response = await getAtlasSession.__executeServer({ method: "GET", data: undefined });

    expect(response).toMatchObject({
      error: undefined,
      result: session,
    });
  });

  it("returns the authenticated Atlas session requirement", async () => {
    const session = {
      accountReady: false,
      hasPasskey: false,
      passkeyCount: 0,
      session: { id: "session_123" },
      user: {
        email: "operator@atlas.test",
        emailVerified: false,
        id: "user_123",
        name: "Operator",
      },
    };
    mocks.requireAtlasSessionState.mockResolvedValue(session);

    const { ensureAtlasSession } = await import("@/domains/access/session.functions");
    const response = await ensureAtlasSession.__executeServer({ method: "GET", data: undefined });

    expect(response).toMatchObject({
      error: undefined,
      result: session,
    });
  });

  it("returns the ready Atlas session requirement", async () => {
    const session = {
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
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue(session);

    const { ensureReadyAtlasSession } = await import("@/domains/access/session.functions");
    const response = await ensureReadyAtlasSession.__executeServer({
      method: "GET",
      data: undefined,
    });

    expect(response).toMatchObject({
      error: undefined,
      result: session,
    });
  });

  it("forwards magic-link requests to the session state runtime", async () => {
    mocks.requestMagicLinkForEmail.mockResolvedValue({ ok: true });

    const { requestMagicLink } = await import("@/domains/access/session.functions");
    const response = await requestMagicLink.__executeServer({
      method: "POST",
      data: {
        callbackURL: "/account",
        email: "operator@atlas.test",
        name: "Operator",
      },
    });

    expect(response).toMatchObject({
      error: undefined,
      result: { ok: true },
    });
    expect(mocks.requestMagicLinkForEmail).toHaveBeenCalledWith({
      callbackURL: "/account",
      email: "operator@atlas.test",
      name: "Operator",
    });
  });

  it("forwards verification email requests to the session state runtime", async () => {
    mocks.sendVerificationEmailForCurrentSession.mockResolvedValue({ ok: true });

    const { sendVerificationEmail } = await import("@/domains/access/session.functions");
    const response = await sendVerificationEmail.__executeServer({
      method: "POST",
      data: undefined,
    });

    expect(response).toMatchObject({
      error: undefined,
      result: { ok: true },
    });
  });

  it("returns the RP-Initiated Logout URL when the IdP advertises one", async () => {
    mocks.loadOidcRpLogoutRedirect.mockResolvedValue("https://idp.example/logout?id_token_hint=t");

    const { getRpLogoutRedirect } = await import("@/domains/access/session.functions");
    const response = await getRpLogoutRedirect.__executeServer({ method: "GET", data: undefined });

    expect(response).toMatchObject({
      error: undefined,
      result: { url: "https://idp.example/logout?id_token_hint=t" },
    });
  });

  it("returns null URL when no RP-Initiated Logout target is available", async () => {
    mocks.loadOidcRpLogoutRedirect.mockResolvedValue(null);

    const { getRpLogoutRedirect } = await import("@/domains/access/session.functions");
    const response = await getRpLogoutRedirect.__executeServer({ method: "GET", data: undefined });

    expect(response).toMatchObject({
      error: undefined,
      result: { url: null },
    });
  });
});
